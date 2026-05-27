/**
 * ClaudeCode SDK — Tool Registry
 *
 * Central registry for tool management. Handles registration,
 * lookup, execution, and conversion to API schema format.
 */
import type { Tool, ToolContext, ToolDefinition, ToolResult, Tools } from '../types/tool.js'

export class ToolRegistry {
  private readonly _tools = new Map<string, Tool>()

  /** Register one or more tools */
  register(...tools: Tool[]): void {
    for (const tool of tools) {
      if (this._tools.has(tool.name)) {
        throw new Error(`Tool "${tool.name}" is already registered`)
      }
      this._tools.set(tool.name, tool)
    }
  }

  /** Get a tool by name */
  get(name: string): Tool | undefined {
    return this._tools.get(name)
  }

  /** Get all registered tools */
  getAll(): Tool[] {
    return Array.from(this._tools.values())
  }

  /** Get tools as a read-only array */
  getTools(): Tools {
    return Object.freeze([...this._tools.values()])
  }

  /** Check if a tool exists */
  has(name: string): boolean {
    return this._tools.has(name)
  }

  /** Remove a tool by name */
  unregister(name: string): boolean {
    return this._tools.delete(name)
  }

  /** Clear all registered tools */
  clear(): void {
    this._tools.clear()
  }

  /** Get the number of registered tools */
  get size(): number {
    return this._tools.size
  }

  /** Convert all tools to API schema format */
  toAPISchemas(): ToolDefinition[] {
    return this.getAll().map((tool) => {
      const jsonSchema = this._zodSchemaToJSONSchema(tool.inputSchema)
      return {
        name: tool.name,
        description: tool.description,
        input_schema: {
          type: 'object' as const,
          ...jsonSchema,
        },
      }
    })
  }

  /** Execute a tool by name with validated input */
  async execute(name: string, input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const tool = this._tools.get(name)
    if (!tool) {
      return {
        data: null,
        content: `Error: Unknown tool "${name}". Available tools: ${Array.from(this._tools.keys()).join(', ')}`,
        isError: true,
      }
    }

    // Validate input against schema
    const parsed = tool.inputSchema.safeParse(input)
    if (!parsed.success) {
      return {
        data: null,
        content: `Error: Invalid input for tool "${name}": ${parsed.error.message}`,
        isError: true,
      }
    }

    try {
      return await tool.execute(parsed.data, context)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        data: null,
        content: `Error executing tool "${name}": ${message}`,
        isError: true,
      }
    }
  }

  /** Convert Zod schema to JSON Schema format for the API */
  private _zodSchemaToJSONSchema(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema: any,
  ): Record<string, unknown> {
    // For Zod 3.x, we can use the internal description
    // Fall back to a simple object schema if we can't introspect
    try {
      if (typeof schema?.describe === 'function') {
        const description = schema.describe()
        if (description?.type) {
          return description as Record<string, unknown>
        }
      }
    } catch {
      // Fallback
    }
    return { type: 'object' }
  }
}
