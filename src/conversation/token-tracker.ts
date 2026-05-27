/**
 * Token Tracker — Token usage extraction, estimation, and tracking.
 *
 * Based on Claude Code's src/utils/tokens.ts.
 * Handles token counting from API responses and context window estimation.
 */
import type { Message } from '../types/message.js'
import type { TokenUsage } from '../llm/types.js'

/**
 * Extract TokenUsage from an assistant message if it has usage data attached.
 * Returns undefined for user messages or assistant messages without usage.
 */
export function getTokenUsageFromMessage(message: Message): TokenUsage | undefined {
  if (message.role === 'assistant' && 'usage' in message && message.usage) {
    const usage = message.usage as TokenUsage
    return {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheCreationInputTokens: usage.cacheCreationInputTokens ?? 0,
      cacheReadInputTokens: usage.cacheReadInputTokens ?? 0,
    }
  }
  return undefined
}

/**
 * Calculate total context window tokens from usage data.
 * Includes input_tokens + cache tokens + output_tokens.
 */
export function getTotalTokensFromUsage(usage: TokenUsage): number {
  return (
    (usage.inputTokens ?? 0) +
    (usage.cacheCreationInputTokens ?? 0) +
    (usage.cacheReadInputTokens ?? 0) +
    (usage.outputTokens ?? 0)
  )
}

/**
 * Get context window size from the last API response's usage.
 * Walks from the end of messages to find the last message with usage data.
 */
export function getContextSizeFromLastResponse(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    const usage = msg ? getTokenUsageFromMessage(msg) : undefined
    if (usage) {
      return getTotalTokensFromUsage(usage)
    }
  }
  return 0
}

/**
 * Get only the output_tokens from the last API response.
 * Useful for measuring generation cost.
 */
export function getOutputTokensFromLastResponse(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    const usage = msg ? getTokenUsageFromMessage(msg) : undefined
    if (usage) {
      return usage.outputTokens ?? 0
    }
  }
  return 0
}

/**
 * Get the current usage from the most recent usage-bearing message.
 */
export function getCurrentUsage(messages: Message[]): TokenUsage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    const usage = msg ? getTokenUsageFromMessage(msg) : undefined
    if (usage) {
      return usage
    }
  }
  return null
}

/**
 * Rough token estimation based on character count (~4 chars per token).
 */
function roughTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Rough token estimation for a message.
 */
function estimateMessageTokens(msg: Message): number {
  let text = ''
  if (typeof msg.content === 'string') {
    text = msg.content
  } else if (Array.isArray(msg.content)) {
    text = msg.content.map(b => {
      if ('text' in b && b.type === 'text') return b.text
      if ('thinking' in b && b.type === 'thinking') return b.thinking
      if ('content' in b && b.type === 'tool_result') return b.content
      return ''
    }).join(' ')
  }
  return roughTokenCount(text) + 10 // overhead for message metadata
}

/**
 * Get the current context window size in tokens.
 *
 * This is the CANONICAL function for measuring context size when checking
 * thresholds (auto-compact, etc.). Uses the last API response's token count
 * plus rough estimates for any messages added since.
 */
export function estimateContextTokens(messages: Message[]): number {
  if (messages.length === 0) return 0

  // Find the last message with usage data
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    const usage = msg ? getTokenUsageFromMessage(msg) : undefined
    if (msg && usage) {
      // Return usage total + rough estimate for all messages after this one
      const usageTotal = getTotalTokensFromUsage(usage)
      let estimate = 0
      for (let j = i + 1; j < messages.length; j++) {
        estimate += estimateMessageTokens(messages[j]!)
      }
      return usageTotal + estimate
    }
  }

  // No usage data found — rough estimate for all messages
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0)
}

/**
 * TokenTracker — manages running token usage statistics.
 */
export class TokenTracker {
  private _accumulatedInput = 0
  private _accumulatedOutput = 0

  /**
   * Update accumulated usage from a done event or assistant message.
   */
  updateFromUsage(usage: TokenUsage): void {
    this._accumulatedInput += usage.inputTokens ?? 0
    this._accumulatedOutput += usage.outputTokens ?? 0
  }

  /**
   * Estimate current context size from messages.
   */
  estimateContextSize(messages: Message[]): number {
    if (messages.length === 0) return 0
    return estimateContextTokens(messages)
  }

  /**
   * Get accumulated usage across all turns.
   */
  getAccumulatedUsage(): TokenUsage {
    return {
      inputTokens: this._accumulatedInput,
      outputTokens: this._accumulatedOutput,
    }
  }

  /**
   * Reset accumulated usage.
   */
  reset(): void {
    this._accumulatedInput = 0
    this._accumulatedOutput = 0
  }
}
