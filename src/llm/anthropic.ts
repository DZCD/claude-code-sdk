/**
 * ClaudeCode SDK - Anthropic LLM Connector
 *
 * Implements the LLMConnector interface for Anthropic's Direct API.
 * Uses @anthropic-ai/sdk for communication.
 */
import Anthropic from '@anthropic-ai/sdk'
import type { Stream } from '@anthropic-ai/sdk/streaming.js'
import { withRetry } from './retry.js'
import type { AnthropicConfig, LLMConnector, LLMProvider, SendOptions, StreamEvent, ToolDefinition } from './types.js'

/**
 * Raw content block start event from the Anthropic SDK.
 * We define this locally because the SDK types may vary by version.
 */
interface ContentBlockStart {
  type: 'content_block_start'
  index: number
  content_block: { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown }
}

interface ContentBlockDelta {
  type: 'content_block_delta'
  index: number
  delta:
    | { type: 'text_delta'; text: string }
    | { type: 'input_json_delta'; partial_json: string }
    | { type: 'thinking_delta'; thinking: string }
}

interface MessageDelta {
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

interface MessageStart {
  type: 'message_start'
  message: { usage: { input_tokens: number; output_tokens: number } }
}

type StreamEvent_ = ContentBlockStart | ContentBlockDelta | MessageDelta | MessageStop | { type: 'ping' } | MessageStart

export class AnthropicConnector implements LLMConnector {
  readonly provider: LLMProvider = 'anthropic'
  private readonly _client: Anthropic
  private readonly _model: string
  private readonly _maxTokens: number

  constructor(private readonly _config: AnthropicConfig) {
    this._client = new Anthropic({
      apiKey: _config.apiKey,
      baseURL: _config.baseUrl,
      maxRetries: 0, // We handle retries ourselves via withRetry
    })
    this._model = _config.model
    this._maxTokens = _config.maxTokens ?? 8192
  }

  async *send(
    systemPrompt: string | undefined,
    messages: Array<{ role: string; content: string | Record<string, unknown>[] }>,
    tools: ToolDefinition[],
    options?: SendOptions,
  ): AsyncIterable<StreamEvent> {
    const anthropicMessages = messages.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    }))

    // Handle empty messages gracefully
    if (messages.length === 0) {
      yield { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } }
      return
    }

    // Buffer for retry events (populated during withRetry, yielded before stream processing)
    const retryEvents: StreamEvent[] = []
    let inputTokens = 0
    let outputTokens = 0

    try {
      const stream = await withRetry(
        async (attempt) => {
          return (await this._client.messages.create({
            model: this._model,
            max_tokens: options?.maxTokens ?? this._maxTokens,
            system: systemPrompt ? [{ type: 'text' as const, text: systemPrompt }] : undefined,
            messages: anthropicMessages as Anthropic.Messages.MessageParam[],
            tools: tools.length > 0 ? (tools as Anthropic.Messages.Tool[]) : undefined,
            stream: true,
          })) as unknown as Stream<StreamEvent_>
        },
        {
          maxRetries: options?.maxRetries ?? 3,
          signal: options?.signal,
          onRetry: (event) => {
            retryEvents.push({
              type: 'retry',
              attempt: event.attempt,
              delayMs: event.delayMs,
              error: event.error,
              status: event.status,
            })
          },
        },
      )

      // Yield any buffered retry events first
      for (const evt of retryEvents) {
        yield evt
      }

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
          // Capture usage from message_delta
          if (event.usage) {
            inputTokens = event.usage.input_tokens ?? inputTokens
            outputTokens = event.usage.output_tokens ?? outputTokens
          }
          if (event.delta.stop_reason === 'tool_use' && toolUseId) {
            yield {
              type: 'tool_use_end',
              id: toolUseId,
              output: toolUseInput,
            }
          }
        } else if (event.type === 'message_start') {
          // Capture usage from message_start
          inputTokens = event.message.usage.input_tokens ?? inputTokens
        } else if (event.type === 'message_stop') {
          yield {
            type: 'done',
            usage: {
              inputTokens,
              outputTokens,
            },
          }
        }
      }
    } catch (err) {
      // If the error was already an abort, don't yield error event
      const error = err instanceof Error ? err : new Error(String(err))
      yield { type: 'error', error }
    }
  }

  async countTokens(messages: Array<{ role: string; content: string | Record<string, unknown>[] }>): Promise<number> {
    try {
      const response = await (
        this._client.messages as unknown as {
          countTokens: (params: {
            model: string
            messages: Array<{ role: string; content: string | Record<string, unknown>[] }>
          }) => Promise<{ input_tokens: number }>
        }
      ).countTokens({
        model: this._model,
        messages: messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      })
      return response.input_tokens
    } catch {
      // Fallback: estimate from text length
      return messages.reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0)
    }
  }
}

/** Check if a config is for Anthropic */
export function isAnthropicConfig(config: {
  provider: string
}): config is AnthropicConfig {
  return config.provider === 'anthropic'
}
