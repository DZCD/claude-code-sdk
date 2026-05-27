/**
 * Micro-Compact — Individual message-level compression strategies.
 *
 * Provides truncation, merging, and content clipping for individual messages
 * to keep context within bounds at the micro level.
 */
import type { Message } from '../types/message.js'
import type { ContentBlock, ToolResultBlock } from '../types/message.js'

export interface MicroCompactOptions {
  /** Maximum character length for a single message (default: 4000) */
  maxMessageLength?: number
  /** Maximum character length for tool results (default: 2000) */
  maxToolResultLength?: number
  /** Whether to merge adjacent user text messages (default: true) */
  mergeAdjacentUserMessages?: boolean
}

const DEFAULT_OPTIONS: Required<MicroCompactOptions> = {
  maxMessageLength: 4000,
  maxToolResultLength: 2000,
  mergeAdjacentUserMessages: true,
}

const TRUNCATION_SUFFIX = '[...truncated]'

export class MicroCompactor {
  private readonly _options: Required<MicroCompactOptions>

  constructor(options?: MicroCompactOptions) {
    this._options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Truncate content to a maximum length, appending a truncation marker.
   */
  truncateContent(content: string, maxLen: number): string {
    if (content.length <= maxLen) return content
    return content.slice(0, maxLen) + TRUNCATION_SUFFIX
  }

  /**
   * Compact a single message based on its type.
   */
  compactMessage(msg: Message): Message {
    if (typeof msg.content === 'string') {
      // User or assistant text message
      return {
        ...msg,
        content: this.truncateContent(msg.content, this._options.maxMessageLength),
      }
    }

    // Content blocks — may contain tool results or other blocks
    const blocks = msg.content as ContentBlock[]
    const compactedBlocks = blocks.map(block => {
      if (block.type === 'tool_result') {
        const tr = block as ToolResultBlock
        return {
          ...tr,
          content: this.truncateContent(tr.content, this._options.maxToolResultLength),
        }
      }
      if (block.type === 'text') {
        return {
          ...block,
          text: this.truncateContent(block.text, this._options.maxMessageLength),
        }
      }
      return block
    })

    return { ...msg, content: compactedBlocks as unknown as ContentBlock[] } as Message
  }

  /**
   * Merge adjacent user messages into a single message.
   * Only merges user messages with string content.
   */
  mergeAdjacentUserMessages(messages: Message[]): Message[] {
    if (messages.length <= 1) return [...messages]

    const result: Message[] = []

    for (const msg of messages) {
      const last = result[result.length - 1]

      if (
        last &&
        last.role === 'user' &&
        msg.role === 'user' &&
        typeof last.content === 'string' &&
        typeof msg.content === 'string'
      ) {
        // Merge: combine content with separator
        result[result.length - 1] = {
          ...last,
          content: `${last.content}\n---\n${msg.content}`,
        }
      } else {
        result.push({ ...msg })
      }
    }

    return result
  }

  /**
   * Apply all compaction strategies to a list of messages.
   * 1. Merge adjacent user messages (if enabled)
   * 2. Truncate long messages
   */
  compactAll(messages: Message[]): Message[] {
    let result = messages

    if (this._options.mergeAdjacentUserMessages) {
      result = this.mergeAdjacentUserMessages(result)
    }

    return result.map(msg => this.compactMessage(msg))
  }
}
