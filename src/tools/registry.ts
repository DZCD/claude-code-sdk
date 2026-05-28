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
    if (!schema?._def?.typeName) {
      return {}
    }

    const typeName: string = schema._def.typeName
    const description: string | undefined = schema._def?.description

    // Wrapper types: unwrap and recurse
    if (typeName === 'ZodOptional' || typeName === 'ZodNullable' || typeName === 'ZodDefault') {
      return this._zodSchemaToJSONSchema(schema._def.innerType)
    }

    if (typeName === 'ZodEffects') {
      return this._zodSchemaToJSONSchema(schema._def.schema)
    }

    if (typeName === 'ZodObject') {
      const shape = typeof schema.shape === 'function' ? schema.shape() : schema.shape
      const properties: Record<string, unknown> = {}
      const required: string[] = []

      for (const [key, fieldSchema] of Object.entries(shape) as Array<[string, any]>) {
        const fieldTypeName: string = fieldSchema?._def?.typeName ?? ''
        let jsonField = this._zodSchemaToJSONSchema(fieldSchema)

        // Only collect description from the field itself (not from unwrapped optional)
        const fieldDesc = fieldSchema?._def?.description
        if (fieldDesc && typeof jsonField === 'object' && !Array.isArray(jsonField) && jsonField !== null) {
          jsonField = { ...jsonField, description: fieldDesc }
        }

        properties[key] = jsonField

        // Field is required if it's not optional/nullable/default
        if (
          fieldTypeName !== 'ZodOptional' &&
          fieldTypeName !== 'ZodNullable' &&
          fieldTypeName !== 'ZodDefault'
        ) {
          required.push(key)
        }
      }

      const result: Record<string, unknown> = { type: 'object', properties }
      if (required.length > 0) {
        result.required = required
      }
      if (description) result.description = description
      return result
    }

    if (typeName === 'ZodString') {
      const result: Record<string, unknown> = { type: 'string' }
      if (description) result.description = description
      return result
    }

    if (typeName === 'ZodNumber') {
      const result: Record<string, unknown> = { type: 'number' }
      if (description) result.description = description
      return result
    }

    if (typeName === 'ZodBoolean') {
      const result: Record<string, unknown> = { type: 'boolean' }
      if (description) result.description = description
      return result
    }

    if (typeName === 'ZodArray') {
      const items = schema._def?.type
      const result: Record<string, unknown> = { type: 'array', items: items ? this._zodSchemaToJSONSchema(items) : {} }
      if (description) result.description = description
      return result
    }

    if (typeName === 'ZodEnum') {
      const values: string[] = Array.from(schema._def?.values ?? [])
      const result: Record<string, unknown> = { type: 'string', enum: values }
      if (description) result.description = description
      return result
    }

    // Fallback
    return { type: 'string' }
  }
}
