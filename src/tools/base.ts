/**
 * ClaudeCode SDK — Base Tool
 *
 * Abstract base class and helper for building SDK tools.
 * Tools accept typed input via Zod schema and return structured results.
 */
import type { z } from 'zod'
import type { AnyZodObject, Tool, ToolContext, ToolResult } from '../types/tool.js'

/**
 * Abstract base class for all tools.
 * Provides default implementations for optional methods.
 */
export abstract class BaseTool<Input extends AnyZodObject = AnyZodObject, Output = unknown> {
  /** Unique tool name (used by the model to call this tool) */
  abstract readonly name: string

  /** One-line description for the model */
  abstract readonly description: string

  /** Zod schema for input validation */
  abstract readonly inputSchema: Input

  /** Execute the tool with validated input */
  abstract execute(input: z.infer<Input>, context: ToolContext): Promise<ToolResult<Output>>

  /** Whether this is a read-only operation */
  isReadOnly(_input: z.infer<Input>): boolean {
    return false
  }

  /** Whether this tool is concurrency-safe */
  isConcurrencySafe(): boolean {
    return false
  }

  /** Human-readable name for display */
  userFacingName(_input?: Partial<z.infer<Input>>): string {
    return this.name
  }

  /** Convert to the Tool interface type for the API */
  toTool(): Tool<Input, Output> {
    return {
      name: this.name,
      description: this.description,
      inputSchema: this.inputSchema,
      execute: (input, context) => this.execute(input, context),
      isReadOnly: (input) => this.isReadOnly(input),
      isConcurrencySafe: () => this.isConcurrencySafe(),
      userFacingName: (input) => this.userFacingName(input),
    }
  }
}

/**
 * Create a simple tool from a plain object definition.
 * Useful for quick tool definitions or wrapping existing functions.
 */
export function createTool<Input extends AnyZodObject, Output>(def: {
  name: string
  description: string
  inputSchema: Input
  execute: (input: z.infer<Input>, context: ToolContext) => Promise<ToolResult<Output>>
  isReadOnly?: (input: z.infer<Input>) => boolean
  isConcurrencySafe?: () => boolean
}): Tool<Input, Output> {
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    execute: def.execute,
    isReadOnly: def.isReadOnly ?? (() => false),
    isConcurrencySafe: def.isConcurrencySafe ?? (() => false),
  }
}
