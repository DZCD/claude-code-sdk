/**
 * ClaudeCode SDK — Streamlined Message Type
 *
 * Streamlined messages strip conversation entries down to role + content +
 * tool calls for context window optimization and token budget management.
 *
 * Based on Claude Code's SDKStreamlinedTextMessageSchema and
 * SDKStreamlinedToolUseSummaryMessageSchema.
 */
import type { ContentBlock, Message } from './message.js'

// ─── Types ────────────────────────────────────────────

/** Compressed tool use reference for streamlined messages */
export interface StreamlinedToolUse {
  id: string
  name: string
  input: Record<string, unknown>
}

/**
 * A streamlined message for context window optimization.
 * Keeps only role + text content + tool_uses, dropping:
 * - Full ContentBlock structure
 * - Timestamps
 * - IDs (unless specified)
 * - Thinking blocks (not needed in context window)
 */
export interface StreamlinedMessage {
  type: 'streamlined_text'
  role: 'user' | 'assistant'
  text: string
  /** Tool calls present in the original message (assistant role only) */
  toolUses?: StreamlinedToolUse[]
  /** Optional session identifier */
  session_id?: string
  /** Optional message UUID */
  uuid?: string
}

/**
 * Summary of tool use activity from compacted messages.
 * Replaces individual tool_use blocks in streamlined output.
 */
export interface StreamlinedToolSummary {
  type: 'streamlined_tool_use_summary'
  /** Summary string (e.g., "Read 2 files, wrote 1 file") */
  toolSummary: string
  /** Optional session identifier */
  session_id?: string
  /** Optional message UUID */
  uuid?: string
}

/** Union of all streamlined message variants */
export type StreamlinedEntry = StreamlinedMessage | StreamlinedToolSummary

// ─── Type Guards ──────────────────────────────────────

/** Check if an object is a StreamlinedMessage */
export function isStreamlinedMessage(obj: unknown): obj is StreamlinedMessage {
  if (!obj || typeof obj !== 'object') return false
  const o = obj as Record<string, unknown>
  return o.type === 'streamlined_text' && typeof o.text === 'string' && (o.role === 'user' || o.role === 'assistant')
}

/** Check if an object is a StreamlinedToolSummary */
export function isStreamlinedToolSummary(obj: unknown): obj is StreamlinedToolSummary {
  if (!obj || typeof obj !== 'object') return false
  const o = obj as Record<string, unknown>
  return o.type === 'streamlined_tool_use_summary' && typeof o.toolSummary === 'string'
}

// ─── Streamlining Functions ───────────────────────────

/**
 * Extract text content from a message's content field.
 */
function extractText(msg: Message): string {
  if (typeof msg.content === 'string') {
    return msg.content
  }
  const texts: string[] = []
  for (const block of msg.content) {
    if (block.type === 'text' && 'text' in block) {
      texts.push(block.text)
    }
  }
  return texts.join('\n')
}

/**
 * Extract tool_use blocks from message content.
 */
function extractToolUses(msg: Message): StreamlinedToolUse[] | undefined {
  if (typeof msg.content === 'string') return undefined
  const toolUses: StreamlinedToolUse[] = []
  for (const block of msg.content) {
    if (block.type === 'tool_use' && 'id' in block && 'name' in block && 'input' in block) {
      toolUses.push({
        id: block.id,
        name: block.name as string,
        input: block.input as Record<string, unknown>,
      })
    }
  }
  return toolUses.length > 0 ? toolUses : undefined
}

/**
 * Convert a single Message to its streamlined form.
 *
 * - User/assistant text → StreamlinedMessage
 * - Tool result messages are represented as user role StreamlinedMessage
 * - Thinking blocks are dropped
 */
export function streamlineMessage(msg: Message): StreamlinedEntry {
  const role = msg.role === 'assistant' ? 'assistant' : 'user'
  const text = extractText(msg)
  const toolUses = msg.role === 'assistant' ? extractToolUses(msg) : undefined

  return {
    type: 'streamlined_text',
    role,
    text: text || '[tool result]',
    toolUses,
  }
}

/**
 * Convert all messages in an array to streamlined format.
 * Useful for context window optimization before sending to LLM.
 */
export function streamlineAll(messages: Message[]): StreamlinedEntry[] {
  return messages.map(streamlineMessage)
}

// ─── Factory Functions ────────────────────────────────

/**
 * Create a StreamlinedMessage directly.
 */
export function createStreamlinedTextMessage(
  role: 'user' | 'assistant',
  text: string,
  toolUses?: StreamlinedToolUse[],
  session_id?: string,
  uuid?: string,
): StreamlinedMessage {
  const msg: StreamlinedMessage = {
    type: 'streamlined_text',
    role,
    text,
  }
  if (toolUses && toolUses.length > 0) {
    msg.toolUses = toolUses
  }
  if (session_id) msg.session_id = session_id
  if (uuid) msg.uuid = uuid
  return msg
}

/**
 * Create a StreamlinedToolSummary message.
 */
export function createStreamlinedToolSummaryMessage(
  toolSummary: string,
  session_id?: string,
  uuid?: string,
): StreamlinedToolSummary {
  const msg: StreamlinedToolSummary = {
    type: 'streamlined_tool_use_summary',
    toolSummary,
  }
  if (session_id) msg.session_id = session_id
  if (uuid) msg.uuid = uuid
  return msg
}

// ─── Content Reconstruction ───────────────────────────

/**
 * Reconstruct a human-readable text string from a streamlined entry.
 * Used when displaying streamlined content to users or in logs.
 */
export function reconstructMessageContent(entry: StreamlinedEntry): string {
  if (entry.type === 'streamlined_tool_use_summary') {
    return `[Compacted: ${entry.toolSummary}]`
  }

  // streamlined_text
  let result = entry.text
  if (entry.toolUses && entry.toolUses.length > 0) {
    const toolNames = entry.toolUses.map((t) => `[Tool: ${t.name}]`).join(' ')
    result = result ? `${result} ${toolNames}` : toolNames
  }
  return result
}
