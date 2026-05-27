/**
 * ClaudeCode SDK — Azure Foundry LLM Connector
 *
 * Implements the LLMConnector interface for Azure AI Foundry.
 * Uses @anthropic-ai/foundry-sdk for communication with Azure's Anthropic API.
 */
import { AnthropicFoundry } from '@anthropic-ai/foundry-sdk'
import type { Stream } from '@anthropic-ai/sdk/streaming.js'
import type { Tool as SdkTool } from '@anthropic-ai/sdk/resources/messages.js'
import type {
  FoundryConfig,
  LLMConnector,
  LLMProvider,
  StreamEvent,
  ToolDefinition,
  SendOptions,
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

type FoundryStreamEvent =
  | ContentBlockStart
  | ContentBlockDelta
  | MessageDeltaEvent
  | MessageStop
  | { type: 'ping' }
  | { type: 'message_start'; message: unknown }

/**
 * Azure AI Foundry LLM connector.
 *
 * Uses @anthropic-ai/foundry-sdk which handles Azure authentication
 * (API key or Azure AD token) and provides the same Messages API interface.
 *
 * The base URL is constructed from the resource name:
 * `https://{resource}.services.ai.azure.com/anthropic/v1/messages`
 *
 * @example
 * ```ts
 * const connector = new FoundryConnector({
 *   provider: 'foundry',
 *   model: 'claude-sonnet-4',
 *   resourceName: 'my-azure-resource',
 *   apiKey: 'my-api-key',
 * })
 * ```
 */
export class FoundryConnector implements LLMConnector {
  readonly provider: LLMProvider = 'foundry'
  private readonly _client: AnthropicFoundry
  private readonly _model: string
  private readonly _maxTokens: number

  constructor(private readonly _config: FoundryConfig) {
    this._client = new AnthropicFoundry({
      resource: _config.resourceName,
      apiKey: _config.apiKey,
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
    const foundryMessages = messages.map((msg) => ({
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
        messages: foundryMessages,
        tools: tools.length > 0 ? (tools as unknown as SdkTool[]) : undefined,
        stream: true,
      })) as unknown as Stream<FoundryStreamEvent>

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
      // Foundry SDK supports countTokens via the messages resource
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

/** Check if a config is for Azure Foundry */
export function isFoundryConfig(
  config: { provider: string },
): config is FoundryConfig {
  return config.provider === 'foundry'
}
