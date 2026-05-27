/**
 * ClaudeCode SDK — Google Vertex AI LLM Connector
 *
 * Implements the LLMConnector interface for Google Vertex AI.
 * Uses @anthropic-ai/vertex-sdk for communication with Vertex AI's Anthropic API.
 */
import { AnthropicVertex } from '@anthropic-ai/vertex-sdk'
import type { Stream } from '@anthropic-ai/sdk/streaming.js'
import type { Tool as SdkTool } from '@anthropic-ai/sdk/resources/messages.js'
import type {
  LLMConnector,
  LLMProvider,
  StreamEvent,
  ToolDefinition,
  SendOptions,
  VertexConfig,
} from './types.js'

/**
 * Raw content block start event from the Anthropic SDK stream.
 */
interface ContentBlockStart {
  type: 'content_block_start'
  index: number
  content_block:
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
}

interface ContentBlockDelta {
  type: 'content_block_delta'
  index: number
  delta:
    | { type: 'text_delta'; text: string }
    | { type: 'input_json_delta'; partial_json: string }
    | { type: 'thinking_delta'; thinking: string }
}

interface MessageDeltaEvent {
  type: 'message_delta'
  delta: {
    stop_reason: string | null
    stop_sequence: string | null
  }
  usage: { input_tokens: number; output_tokens: number }
}

interface MessageStop {
  type: 'message_stop'
}

type VertexStreamEvent =
  | ContentBlockStart
  | ContentBlockDelta
  | MessageDeltaEvent
  | MessageStop
  | { type: 'ping' }
  | { type: 'message_start'; message: unknown }

/**
 * Google Vertex AI LLM connector.
 *
 * Uses @anthropic-ai/vertex-sdk which handles Google Cloud authentication
 * via google-auth-library and provides the same Messages API interface.
 *
 * @example
 * ```ts
 * const connector = new VertexConnector({
 *   provider: 'vertex',
 *   model: 'claude-sonnet-4@20250514',
 *   projectId: 'my-gcp-project',
 *   region: 'us-east5',
 * })
 * ```
 */
export class VertexConnector implements LLMConnector {
  readonly provider: LLMProvider = 'vertex'
  private readonly _client: AnthropicVertex
  private readonly _model: string
  private readonly _maxTokens: number

  constructor(private readonly _config: VertexConfig) {
    this._client = new AnthropicVertex({
      region: _config.region,
      projectId: _config.projectId,
      maxRetries: 3,
    })
    this._model = _config.model
    this._maxTokens = _config.maxTokens ?? 8192
  }

  async *send(
    systemPrompt: string | undefined,
    messages: Array<{ role: string; content: string }>,
    tools: ToolDefinition[],
    options?: SendOptions,
  ): AsyncIterable<StreamEvent> {
    const vertexMessages = messages.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    }))

    try {
      const stream = (await this._client.messages.create({
        model: this._model,
        max_tokens: options?.maxTokens ?? this._maxTokens,
        system: systemPrompt
          ? [{ type: 'text' as const, text: systemPrompt }]
          : undefined,
        messages: vertexMessages,
        tools: tools.length > 0 ? (tools as unknown as SdkTool[]) : undefined,
        stream: true,
      })) as unknown as Stream<VertexStreamEvent>

      let toolUseId = ''
      let toolUseName = ''
      let toolUseInput = ''

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          const block = event.content_block
          if (block.type === 'text') {
            yield { type: 'text', text: block.text }
          } else if (block.type === 'tool_use') {
            toolUseId = block.id
            toolUseName = block.name
            toolUseInput = JSON.stringify(block.input)
            yield {
              type: 'tool_use_start',
              id: toolUseId,
              name: toolUseName,
              input: block.input as Record<string, unknown>,
            }
          }
        } else if (event.type === 'content_block_delta') {
          const delta = event.delta
          if (delta.type === 'text_delta') {
            yield { type: 'text', text: delta.text }
          } else if (delta.type === 'input_json_delta') {
            toolUseInput += delta.partial_json
          } else if (delta.type === 'thinking_delta') {
            yield { type: 'thinking', thinking: delta.thinking }
          }
        } else if (event.type === 'message_delta') {
          if (event.delta.stop_reason === 'tool_use' && toolUseId) {
            yield {
              type: 'tool_use_end',
              id: toolUseId,
              output: toolUseInput,
            }
          }
        } else if (event.type === 'message_stop') {
          yield {
            type: 'done',
            usage: {
              inputTokens: 0,
              outputTokens: 0,
            },
          }
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      yield { type: 'error', error }
    }
  }

  async countTokens(
    messages: Array<{ role: string; content: string }>,
  ): Promise<number> {
    try {
      // Vertex SDK supports countTokens via the messages resource
      const response = await (this._client.messages as unknown as {
        countTokens: (params: {
          model: string
          messages: Array<{ role: string; content: string }>
        }) => Promise<{ input_tokens: number }>
      }).countTokens({
        model: this._model,
        messages: messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      })
      return response.input_tokens
    } catch {
      // Fallback: estimate from text length
      return messages.reduce(
        (acc, m) => acc + Math.ceil(m.content.length / 4),
        0,
      )
    }
  }
}

/** Check if a config is for Google Vertex AI */
export function isVertexConfig(
  config: { provider: string },
): config is VertexConfig {
  return config.provider === 'vertex'
}
