/**
 * ClaudeCode SDK — Conversation Module Index
 */

export { ConversationManager } from './manager.js'
export { conversationLoop } from './loop.js'
export type { LoopOptions, LoopState } from './loop.js'
export { CircularBuffer } from './circular-buffer.js'
export {
  TokenTracker,
  getTokenUsageFromMessage,
  getTotalTokensFromUsage,
  estimateContextTokens,
} from './token-tracker.js'
export {
  TokenBudget,
  parseTokenBudget,
  findTokenBudgetPositions,
  getBudgetContinuationMessage,
} from './token-budget.js'
export { MicroCompactor } from './micro-compact.js'
export type { MicroCompactOptions } from './micro-compact.js'
export { AutoCompactor } from './auto-compact.js'
export type {
  CompactOptions,
  CompactResult,
  SummaryLLM,
} from './auto-compact.js'
