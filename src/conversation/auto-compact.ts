/**
 * Auto-Compact — Context-aware automatic conversation compression.
 *
 * When the conversation context window approaches its limit, auto-compact
 * summarizes or truncates older messages to keep context within bounds.
 *
 * Based on Claude Code's context window management pattern from context.ts
 * and conversationRecovery.ts.
 */
import type { Message } from '../types/message.js'
import { estimateContextTokens } from './token-tracker.js'

export interface CompactOptions {
  /** Percentage threshold to trigger compaction (default: 0.8 = 80%) */
  threshold?: number
  /** Number of most recent messages to keep intact (default: 10) */
  keepRecentMessages?: number
  /** Maximum output tokens for compact summary (default: 20000) */
  maxCompactTokens?: number
  /** Context window size in tokens (default: 200000) */
  contextWindowSize?: number
}

export interface CompactResult {
  /** Whether compaction was performed */
  compacted: boolean
  /** Number of messages before compaction */
  originalCount: number
  /** Number of messages after compaction */
  finalCount: number
  /** Generated summary text (if LLM summarization was used) */
  summary?: string
}

export interface SummaryLLM {
  /** Generate a summary of the given messages */
  summarize(messages: Message[]): Promise<string>
}

const DEFAULT_OPTIONS: Required<CompactOptions> = {
  threshold: 0.8,
  keepRecentMessages: 10,
  maxCompactTokens: 20000,
  contextWindowSize: 200_000,
}

/**
 * AutoCompactor — manages automatic compaction of conversation history.
 */
export class AutoCompactor {
  private readonly _options: Required<CompactOptions>
  private _compactCount = 0

  constructor(options?: CompactOptions) {
    this._options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Check if the conversation needs compaction based on context size vs threshold.
   */
  needsCompact(messages: Message[], contextSize: number): boolean {
    if (messages.length === 0) return false
    const estimatedTokens = estimateContextTokens(messages)
    const thresholdTokens = contextSize * this._options.threshold
    return estimatedTokens > thresholdTokens
  }

  /**
   * Get candidate messages for compaction (oldest messages excluding recent and system).
   */
  getCompactCandidates(messages: Message[]): Message[] {
    if (messages.length <= this._options.keepRecentMessages) return []

    // Find the split point — keep the most recent N non-system messages
    const candidates: Message[] = []
    const keepCount = this._options.keepRecentMessages

    for (let i = 0; i < messages.length - keepCount; i++) {
      const msg = messages[i]!
      // Skip system messages — they shouldn't be compacted
      if (msg.role === 'system') continue
      candidates.push(msg)
    }

    return candidates
  }

  /**
   * Execute compaction on the messages array.
   *
   * If an LLM summarizer is provided, it will generate a summary of old messages.
   * Otherwise, performs simple truncation-style compaction.
   *
   * Returns the compaction result (but does NOT modify the original array).
   */
  async compact(messages: Message[], llm: SummaryLLM | null): Promise<CompactResult> {
    if (messages.length === 0) {
      return { compacted: false, originalCount: 0, finalCount: 0 }
    }

    const contextSize = this._options.contextWindowSize
    if (!this.needsCompact(messages, contextSize)) {
      return {
        compacted: false,
        originalCount: messages.length,
        finalCount: messages.length,
      }
    }

    const candidates = this.getCompactCandidates(messages)
    if (candidates.length === 0) {
      return {
        compacted: false,
        originalCount: messages.length,
        finalCount: messages.length,
      }
    }

    let summary: string | undefined

    if (llm) {
      // Use LLM to generate a summary of the candidate messages
      summary = await llm.summarize(candidates)
    } else {
      // Fallback: simple truncation — summarize as a count
      summary = `[Earlier conversation history trimmed: ${candidates.length} messages removed for context management]`
    }

    this._compactCount++

    return {
      compacted: true,
      originalCount: messages.length,
      finalCount: messages.length - candidates.length + 1, // +1 for summary message
      summary,
    }
  }

  /** Get the number of compactions performed */
  get compactCount(): number {
    return this._compactCount
  }
}
