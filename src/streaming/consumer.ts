/**
 * Phase 3B — B1: Streaming Consumer
 *
 * Provides streamToText(), streamToBlocks(), and StreamConsumer class
 * for consuming AsyncIterable<StreamEvent> from LLMConnector.send().
 */
import type { StreamEvent, TokenUsage } from '../llm/types.js'
import type { StreamBlock, ToolUseBlock } from './types.js'

// ─── Utility Async Generators ────────────────────────────

/**
 * Filter a stream of StreamEvent to only yield text fragments.
 *
 * @param stream - The raw event stream from LLMConnector.send()
 * @returns An async iterable of text strings
 */
export async function* streamToText(stream: AsyncIterable<StreamEvent>): AsyncIterable<string> {
  for await (const event of stream) {
    if (event.type === 'text') {
      yield event.text
    }
    // Stop on error/done — the for await naturally ends
    if (event.type === 'error' || event.type === 'done') {
      break
    }
  }
}

/**
 * Aggregate a stream of StreamEvent into fully assembled StreamBlock items.
 *
 * Handles tool_use_start + tool_use_end pairs to produce complete
 * ToolUseBlock items. Text and thinking events pass through directly.
 *
 * @param stream - The raw event stream from LLMConnector.send()
 * @returns An async iterable of StreamBlock items
 */
export async function* streamToBlocks(stream: AsyncIterable<StreamEvent>): AsyncIterable<StreamBlock> {
  const pendingToolUses = new Map<string, StreamBlock & { type: 'tool_use' }>()

  for await (const event of stream) {
    switch (event.type) {
      case 'text':
        yield { type: 'text', text: event.text }
        break

      case 'thinking':
        yield { type: 'thinking', thinking: event.thinking }
        break

      case 'tool_use_start':
        pendingToolUses.set(event.id, {
          type: 'tool_use',
          id: event.id,
          name: event.name,
          input: event.input,
        })
        break

      case 'tool_use_end': {
        const block = pendingToolUses.get(event.id)
        if (block) {
          block.result = event.output
          block.isError = event.isError
          pendingToolUses.delete(event.id)
          yield block
        }
        break
      }

      // ping, retry, error, done — skip
      default:
        break
    }

    // Stop on done
    if (event.type === 'done') {
      break
    }
  }
}

// ─── StreamConsumer ───────────────────────────────────────

type EventHandler = (event: StreamEvent) => void

/**
 * A consumer that wraps an AsyncIterable<StreamEvent> and provides
 * multiple convenience APIs for consuming the stream.
 */
export class StreamConsumer {
  private handlers = new Map<string, Set<EventHandler>>()
  private consumed = false

  /**
   * @param stream - The raw event stream
   * @param signal - Optional AbortSignal for cancellation
   */
  constructor(
    private stream: AsyncIterable<StreamEvent>,
    private signal?: AbortSignal,
  ) {}

  /**
   * Stream only text fragments from the event stream.
   * Non-text events (thinking, tool_use, etc.) are filtered out.
   */
  async *toTextStream(): AsyncIterable<string> {
    yield* streamToText(this.wrapStream())
  }

  /**
   * Stream fully assembled blocks from the event stream.
   * Text, thinking, and tool_use blocks are yielded as they become available.
   */
  async *toBlockStream(): AsyncIterable<StreamBlock> {
    yield* streamToBlocks(this.wrapStream())
  }

  /**
   * Register a type-specific event handler.
   *
   * @param type - The event type to listen for (e.g., 'text', 'thinking')
   * @param callback - Handler function called for each matching event
   * @returns An unsubscribe function
   */
  on<K extends StreamEvent['type']>(type: K, callback: (event: Extract<StreamEvent, { type: K }>) => void): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set())
    }
    this.handlers.get(type)!.add(callback as EventHandler)
    return () => {
      this.handlers.get(type)?.delete(callback as EventHandler)
    }
  }

  /**
   * Register a handler that fires on every event.
   *
   * @param callback - Handler called for each event
   * @returns An unsubscribe function
   */
  onEvent(callback: (event: StreamEvent) => void): () => void {
    return this.on('*' as never, callback as never)
  }

  /**
   * Consume the entire stream and return the aggregated result.
   *
   * Convenient for simple use cases where you want the full text,
   * tool uses, and token usage in one call.
   */
  async toPromise(): Promise<{
    text: string
    toolUses: ToolUseBlock[]
    usage: TokenUsage
  }> {
    const textParts: string[] = []
    const pendingToolUses = new Map<string, ToolUseBlock>()
    const toolUses: ToolUseBlock[] = []
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 }

    const stream = this.wrapStream()
    for await (const event of stream) {
      switch (event.type) {
        case 'text':
          textParts.push(event.text)
          break

        case 'tool_use_start':
          pendingToolUses.set(event.id, {
            type: 'tool_use',
            id: event.id,
            name: event.name,
            input: event.input,
          })
          break

        case 'tool_use_end': {
          const block = pendingToolUses.get(event.id)
          if (block) {
            block.result = event.output
            block.isError = event.isError
            pendingToolUses.delete(event.id)
            toolUses.push(block)
          }
          break
        }

        case 'done':
          usage = event.usage
          break

        case 'error':
          return { text: textParts.join(''), toolUses, usage }
      }
    }

    return { text: textParts.join(''), toolUses, usage }
  }

  /**
   * Consume the stream and dispatch events to registered handlers.
   * Stops when stream ends, on error, or on done event.
   * Primarily used internally; called automatically by toTextStream/toBlockStream/toPromise.
   */
  async consume(): Promise<void> {
    const stream = this.wrapStream()
    for await (const event of stream) {
      // Dispatch type-specific handlers
      const typeHandlers = this.handlers.get(event.type)
      if (typeHandlers) {
        typeHandlers.forEach((cb) => cb(event))
      }

      // Dispatch wildcard handlers
      const allHandlers = this.handlers.get('*')
      if (allHandlers) {
        allHandlers.forEach((cb) => cb(event))
      }

      // Stop on error or done
      if (event.type === 'error' || event.type === 'done') {
        break
      }
    }
  }

  /**
   * Wraps the original stream with abort signal support.
   */
  private async *wrapStream(): AsyncIterable<StreamEvent> {
    for await (const event of this.stream) {
      if (this.signal?.aborted) {
        break
      }
      yield event
    }
  }
}

// ─── Factory Function ─────────────────────────────────────

/**
 * Create a StreamConsumer from an event stream.
 *
 * @param stream - The raw event stream from LLMConnector.send()
 * @param signal - Optional AbortSignal for cancellation
 * @returns A StreamConsumer instance
 */
export function createStreamConsumer(stream: AsyncIterable<StreamEvent>, signal?: AbortSignal): StreamConsumer {
  return new StreamConsumer(stream, signal)
}
