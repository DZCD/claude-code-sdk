/**
 * ClaudeCode SDK — Conversation Manager
 *
 * Manages a single conversation session with message history,
 * streaming, and automatic tool-calling loop.
 * Phase 2 extended with compact, micro-compact, and token tracking.
 */
import type { LLMConnector, StreamEvent, TokenUsage } from '../llm/types.js'
import type { ToolRegistry } from '../tools/registry.js'
import type { Message, Snowflake } from '../types/message.js'
import { createAssistantMessage, createUserMessage } from '../types/message.js'
import { AutoCompactor, type CompactOptions, type CompactResult, type SummaryLLM } from './auto-compact.js'
import { type LoopOptions, conversationLoop } from './loop.js'
import { type MicroCompactOptions, MicroCompactor } from './micro-compact.js'
import { TokenBudget } from './token-budget.js'
import { TokenTracker, estimateContextTokens } from './token-tracker.js'

export type { CompactOptions, CompactResult, MicroCompactOptions }

export class ConversationManager {
  private readonly _messages: Message[] = []
  private _tokenUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 }
  private readonly _tokenTracker = new TokenTracker()
  private _tokenBudget?: TokenBudget
  private _microCompactor?: MicroCompactor
  private _autoCompactor?: AutoCompactor
  private _compactionHistory: CompactResult[] = []
  private _summaryLLM?: SummaryLLM | null

  constructor(
    private readonly _llm: LLMConnector,
    private readonly _tools: ToolRegistry,
    private readonly _systemPrompt?: string,
  ) {}

  /**
   * Send a user message and get a streaming response.
   * Automatically handles the tool-calling loop.
   * Applies micro-compact and auto-compact if configured.
   */
  async *send(message: string, options?: LoopOptions): AsyncIterable<StreamEvent> {
    // Step 1: Micro-compact existing messages (if configured)
    if (this._microCompactor) {
      const compacted = this._microCompactor.compactAll(this._messages)
      this._messages.length = 0
      this._messages.push(...compacted)
    }

    // Step 2: Auto-compact check (if configured)
    if (this._autoCompactor) {
      const result = await this._autoCompactor.compact(this._messages, this._summaryLLM ?? null)
      if (result.compacted) {
        this._compactionHistory.push(result)
        // Apply in-memory compaction: replace candidates with summary
        const candidates = this._autoCompactor.getCompactCandidates(this._messages)
        if (candidates.length > 0) {
          // Find the index of the first compact candidate
          const firstIdx = this._messages.indexOf(candidates[0]!)
          if (firstIdx !== -1) {
            // Remove candidates and insert summary
            this._messages.splice(firstIdx, candidates.length, {
              id: `${Date.now()}-compact-summary`,
              role: 'user',
              content: result.summary ?? `[Compacted: ${candidates.length} previous messages]`,
              createdAt: new Date().toISOString(),
            } as Message)
          }
        }
      }
    }

    // Step 3: Add user message to history
    const userMsg = createUserMessage(message)
    this._messages.push(userMsg)

    // Step 4: Run the conversation loop
    for await (const event of conversationLoop(this._llm, this._systemPrompt, this._messages, this._tools, options)) {
      if (event.type === 'done') {
        // Track token usage
        const usage = event.usage ?? { inputTokens: 0, outputTokens: 0 }
        this._tokenUsage = {
          inputTokens: this._tokenUsage.inputTokens + (usage.inputTokens ?? 0),
          outputTokens: this._tokenUsage.outputTokens + (usage.outputTokens ?? 0),
        }
        this._tokenTracker.updateFromUsage(usage)

        // Track against budget if configured
        this._tokenBudget?.recordUsage(usage)
      }
      yield event
    }
  }

  /** Get the conversation history */
  getHistory(): Message[] {
    return [...this._messages]
  }

  /** Reset the conversation */
  reset(): void {
    this._messages.length = 0
    this._tokenUsage = { inputTokens: 0, outputTokens: 0 }
    this._tokenTracker.reset()
    this._tokenBudget?.reset()
    this._compactionHistory = []
  }

  /** Get current token usage */
  getTokenUsage(): TokenUsage {
    return { ...this._tokenUsage }
  }

  /** Manually add a message to the history */
  addMessage(msg: Message): void {
    this._messages.push(msg)
  }

  /** Get the number of messages in the conversation */
  get messageCount(): number {
    return this._messages.length
  }

  // ─── Phase 2 Extensions ─────────────────────────────────

  /**
   * Configure auto-compact options.
   * Enables automatic context compression when enabled.
   */
  setCompactOptions(options: CompactOptions): void {
    this._autoCompactor = new AutoCompactor(options)
  }

  /**
   * Configure micro-compact options.
   * Enables per-message compression when configured.
   */
  setMicroCompactOptions(options: MicroCompactOptions): void {
    this._microCompactor = new MicroCompactor(options)
  }

  /**
   * Set a token budget for the conversation.
   * When set, tracks usage against the budget.
   */
  setTokenBudget(budget: number): void {
    this._tokenBudget = new TokenBudget(budget)
  }

  /**
   * Set an optional LLM summarizer for auto-compact.
   * If not set, auto-compact uses simple truncation.
   */
  setSummaryLLM(llm: SummaryLLM | null): void {
    this._summaryLLM = llm
  }

  /**
   * Get the estimated context window size in tokens.
   * Based on the last API response usage plus estimates for new messages.
   */
  getEstimatedContextSize(): number {
    return this._tokenTracker.estimateContextSize(this._messages)
  }

  /**
   * Get remaining token budget, or null if no budget is set.
   */
  getRemainingBudget(): number | null {
    return this._tokenBudget?.remaining ?? null
  }

  /**
   * Get the history of auto-compaction events.
   */
  getCompactionHistory(): CompactResult[] {
    return [...this._compactionHistory]
  }
}
