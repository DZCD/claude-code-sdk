/**
 * Phase 3B — B1: Streaming Types
 *
 * StreamBlock types represent fully assembled blocks from a streaming response.
 * These are consumed/aggregated versions of raw StreamEvent data.
 */
import type { Snowflake } from '../types/message.js'

// ─── StreamBlock ──────────────────────────────────────────

/** A fully assembled block from a stream */
export type StreamBlock = TextBlock | ToolUseBlock | ThinkingBlock

/** Text content block */
export interface TextBlock {
  type: 'text'
  text: string
}

/** Tool use block (aggregated from tool_use_start + tool_use_end) */
export interface ToolUseBlock {
  type: 'tool_use'
  id: Snowflake
  name: string
  input: Record<string, unknown>
  /** Tool execution output text, set when tool_use_end arrives */
  result?: string
  /** Whether the tool returned an error */
  isError?: boolean
}

/** Thinking block (extended thinking) */
export interface ThinkingBlock {
  type: 'thinking'
  thinking: string
}
