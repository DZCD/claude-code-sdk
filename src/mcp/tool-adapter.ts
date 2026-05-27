import { z } from 'zod'
/**
 * ClaudeCode SDK — MCP Tool Adapter
 *
 * Adapts MCP server tool definitions into the SDK's Tool interface,
 * enabling MCP tools to be used alongside built-in tools in the
 * conversation loop.
 */
import type { AnyZodObject, Tool, ToolContext, ToolResult } from '../types/tool.js'
import type { MCPToolDefinition } from './types.js'

/**
 * Convert an MCP tool definition's JSON Schema input schema into a Zod schema.
 * Handles basic JSON Schema types: string, number, boolean, object, array.
 */
function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodType<unknown> {
  const type = schema.type as string | undefined

  if (schema.oneOf || schema.anyOf) {
    const alternatives = (schema.oneOf || schema.anyOf) as Record<string, unknown>[]
    if (alternatives.length > 0) {
      // Use the first alternative that has a type
      return jsonSchemaToZod(alternatives[0] ?? {})
    }
  }

  switch (type) {
    case 'string': {
      const enumValues = schema.enum as string[] | undefined
      if (enumValues && enumValues.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return z.enum(enumValues as [string, ...string[]]) as any
      }
      return z.string()
    }
    case 'number':
      return z.number()
    case 'integer':
      return z.number().int()
    case 'boolean':
      return z.boolean()
    case 'array': {
      const items = schema.items as Record<string, unknown> | undefined
      return z.array(items ? jsonSchemaToZod(items) : z.unknown())
    }
    case 'object': {
      const props = schema.properties as Record<string, Record<string, unknown>> | undefined
      const required = (schema.required as string[]) ?? []
      if (!props) return z.record(z.unknown())

      const shape: Record<string, z.ZodType<unknown>> = {}
      for (const [key, propSchema] of Object.entries(props)) {
        shape[key] = jsonSchemaToZod(propSchema)
      }
      const zodObj = z.object(shape)
      // Make non-required fields optional
      const optionalKeys = Object.keys(shape).filter((k) => !required.includes(k))
      if (optionalKeys.length === 0) return zodObj
      // Create a partial version for optional keys
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return zodObj.partial(optionalKeys as any)
    }
    default:
      return z.unknown()
  }
}

/**
 * @internal Internal type for MCP client callTool result.
 * We inline the minimal interface to avoid direct dependency on
 * @modelcontextprotocol/sdk in user-facing types.
 */
interface MCPCallToolResult {
  content: Array<{ type: string; text?: string; data?: string }>
  isError?: boolean
}

/**
 * Wraps an MCP tool definition and a call-tool function into an SDK Tool.
 */
export function adaptMCPTool(
  mcpTool: MCPToolDefinition,
  callToolFn: (name: string, args: Record<string, unknown>) => Promise<MCPCallToolResult>,
): Tool {
  const zodSchema = (() => {
    try {
      return jsonSchemaToZod(mcpTool.inputSchema)
    } catch {
      return z.object({}).passthrough() as unknown as AnyZodObject
    }
  })()

  return {
    name: mcpTool.name,
    description: mcpTool.description ?? `MCP tool: ${mcpTool.name}`,
    inputSchema: zodSchema as unknown as AnyZodObject,

    async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      try {
        const result = await callToolFn(mcpTool.name, input)

        // Extract text from content blocks
        const textParts = result.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text ?? '')
          .filter(Boolean)

        return {
          data: result,
          content: textParts.join('\n') || JSON.stringify(result),
          isError: result.isError,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          data: null,
          content: `MCP tool "${mcpTool.name}" error: ${message}`,
          isError: true,
        }
      }
    },

    isReadOnly() {
      // Default to non-readonly; specific tools can override
      return false
    },

    isConcurrencySafe() {
      return false
    },
  }
}

export type { MCPCallToolResult as _MCPCallToolResult }
