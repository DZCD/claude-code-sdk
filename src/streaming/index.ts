/**
 * Phase 3B — B1: Streaming Module
 *
 * High-level streaming APIs for consuming LLM streaming responses.
 */

export {
  streamToText,
  streamToBlocks,
  StreamConsumer,
  createStreamConsumer,
} from './consumer.js'

export type {
  StreamBlock,
  TextBlock,
  ToolUseBlock,
  ThinkingBlock,
} from './types.js'
