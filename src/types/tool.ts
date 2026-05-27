/**
 * ClaudeCode SDK - Tool Type System
 *
 * Core types for the tool system, defining the contract between
 * tools and the conversation loop.
 */
import type { z } from 'zod'
import type { Message, Snowflake } from './message.js'

// ─── Tool Types ──────────────────────────────────────────

export type AnyZodObject = z.ZodType<Record<string, unknown>>

export interface ToolContext {
  signal: AbortSignal
  logger?: (msg: string) => void
  [key: string]: unknown
}

export interface ToolResult<Output = unknown> {
  data: Output
  content: string
  isError?: boolean
  newMessages?: Message[]
}

export interface Tool<Input extends AnyZodObject = AnyZodObject, Output = unknown> {
  name: string
  description: string
  inputSchema: Input
  execute(input: z.infer<Input>, context: ToolContext): Promise<ToolResult<Output>>
  isReadOnly?(input: z.infer<Input>): boolean
  isConcurrencySafe?(): boolean
  userFacingName?(input?: Partial<z.infer<Input>>): string
}

export type Tools = readonly Tool[]

/** Tool definition for Anthropic API schema */
export interface ToolDefinition {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties?: Record<string, unknown>
    required?: string[]
    [k: string]: unknown
  }
}

// ─── Tool Call Tracking ──────────────────────────────────

export interface ToolCallRecord {
  id: Snowflake
  toolName: string
  input: Record<string, unknown>
  output: unknown
  duration: number
  isError: boolean
}
