/**
 * ClaudeCode SDK — Session Module Index
 */

export { ClaudeCodeSDK } from './engine.js'
export type {
  SessionResponse,
  SessionConfig,
  SessionListEntry,
} from './engine.js'
export { AttributionManager } from './attribution.js'
export type {
  MessageSource,
  AttributionMode,
  AttributionMetadata,
  AttributionStats,
  AttributionTexts,
  AttributionSnapshot,
} from './attribution.js'
export { SessionPersistence } from './persistence.js'
export type {
  SessionSnapshot,
  SessionMetadata,
  SessionStatus,
  InterruptionResult,
  SerializedMessage,
} from './persistence.js'
