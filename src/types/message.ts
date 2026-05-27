/**
 * ClaudeCode SDK — Core Message Types
 *
 * Type definitions for the message system, supporting multi-turn
 * conversations with tool calls, streaming, and context management.
 */

// ─── Type Helpers ────────────────────────────────────────

/** Snowflake-style unique identifier */
export type Snowflake = string

// ─── Content Blocks ──────────────────────────────────────

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ToolUseBlock {
  type: 'tool_use'
  id: Snowflake
  name: string
  input: Record<string, unknown>
}

export interface ToolResultBlock {
  type: 'tool_result'
  toolUseId: Snowflake
  content: string
  isError?: boolean
}

export interface ThinkingBlock {
  type: 'thinking'
  thinking: string
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock

/** Token usage tracking */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
}

// ─── Messages ────────────────────────────────────────────

export interface BaseMessage {
  id: Snowflake
  createdAt: string
}

export interface UserMessage extends BaseMessage {
  role: 'user'
  content: string | ContentBlock[]
}

export interface AssistantMessage extends BaseMessage {
  role: 'assistant'
  content: string | ContentBlock[]
  /** Token usage from API response, attached after receiving streaming events */
  usage?: { inputTokens: number; outputTokens: number; cacheCreationInputTokens?: number; cacheReadInputTokens?: number }
}

export interface ToolResultMessage extends BaseMessage {
  role: 'user'
  content: ToolResultBlock[]
}

export interface SystemMessage {
  role: 'system'
  content: string
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage | SystemMessage

// ─── Message Helpers ─────────────────────────────────────

let _nextId = 0

/** Generate a unique Snowflake ID */
export function generateId(): Snowflake {
  return `${Date.now()}-${++_nextId}-${Math.random().toString(36).slice(2, 8)}`
}

/** Create a user message from a text string */
export function createUserMessage(text: string): UserMessage {
  return {
    id: generateId(),
    role: 'user',
    content: text,
    createdAt: new Date().toISOString(),
  }
}

/** Create an assistant message from content blocks */
export function createAssistantMessage(content: string | ContentBlock[]): AssistantMessage {
  return {
    id: generateId(),
    role: 'assistant',
    content,
    createdAt: new Date().toISOString(),
  }
}

/** Create a tool result message */
export function createToolResultMessage(results: ToolResultBlock[]): ToolResultMessage {
  return {
    id: generateId(),
    role: 'user',
    content: results,
    createdAt: new Date().toISOString(),
  }
}

/** Create a system message */
export function createSystemMessage(content: string): SystemMessage {
  return {
    role: 'system',
    content,
  }
}

/** Convert string content to TextBlock array */
export function toContentBlocks(text: string): TextBlock[] {
  return [{ type: 'text', text }]
}
