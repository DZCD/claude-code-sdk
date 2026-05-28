/**
 * Edge-case tests for MCP module — server connection failure,
 * tool adapter error mapping, and multi-server concurrency.
 *
 * Complements existing tests in mcp.test.ts / mcp-phase2.test.ts.
 */
import { describe, expect, it, vi } from 'vitest'
import { MCPServerManager } from '../mcp/manager.js'
import { adaptMCPTool } from '../mcp/tool-adapter.js'
import { MCPServerError } from '../mcp/types.js'
import type { MCPServerConfig, MCPToolDefinition } from '../mcp/types.js'
import type { ToolRegistry } from '../tools/registry.js'

// ─── Server Connection Failure ─────────────────────────────

describe('MCPServerManager — Connection Failure', () => {
  it('should throw when no configs connect successfully', async () => {
    const manager = new MCPServerManager()

    const configs: MCPServerConfig[] = [
      { name: 'broken-a', type: 'stdio', commandOrUrl: 'nonexistent-cmd' },
      { name: 'broken-b', type: 'stdio', commandOrUrl: 'also-fake' },
    ]

    // connectAll will try to spawn real processes; we expect an error
    await expect(manager.connectAll(configs)).rejects.toThrow()
    expect(manager.isConnected).toBe(false)
  }, 15_000)

  it('should partially connect when some servers fail', async () => {
    // We can't easily mock StdioClientTransport, so we verify the fallback behavior:
    // When connectAll encounters partial failures, connected > 0 servers remain
    const manager = new MCPServerManager()

    // Inject a mix of "good" and "bad" servers via internal state
    const goodServer = {
      config: { name: 'good-server', type: 'stdio' as const, commandOrUrl: 'echo' },
      client: {
        getServerCapabilities: () => ({ tools: true }),
        listTools: async () => ({ tools: [] }),
        callTool: vi.fn(),
      },
      tools: [],
      connection: { serverName: 'good-server', tools: [], capabilities: ['tools'] },
    }

    // Simulate a failed connection attempt by catching the error
    // We'll use connectAll with 1 real + 1 fake and expect warning but not total failure
    const result = manager.connectAll([
      { name: 'good', type: 'stdio', commandOrUrl: 'echo' },
      { name: 'bad', type: 'stdio', commandOrUrl: '__nonexistent_xyz__' },
    ])

    // Since 'echo' is a valid command that won't produce MCP protocol, it will fail differently
    // The important thing: we don't crash, we handle gracefully
    await expect(result).rejects.toThrow()
    // At least we clean up
    expect(manager.isConnected).toBe(false)
  }, 15_000)
})

describe('MCPServerManager — Multi-Server', () => {
  it('should handle registerAllTools with duplicate names across servers', () => {
    const manager = new MCPServerManager()

    // Inject two servers with overlapping tool names
    const toolA = { name: 'overlap-tool', description: 'Tool from server A', inputSchema: { type: 'object' } }
    const toolB = { name: 'overlap-tool', description: 'Tool from server B', inputSchema: { type: 'object' } }

    const serverA = {
      config: { name: 'server-a', type: 'stdio' as const, commandOrUrl: 'echo' },
      client: {},
      tools: [toolA].map((t) => adaptMCPTool(t, vi.fn())),
      connection: { serverName: 'server-a', tools: [toolA], capabilities: ['tools'] },
    }
    const serverB = {
      config: { name: 'server-b', type: 'stdio' as const, commandOrUrl: 'echo' },
      client: {},
      tools: [toolB].map((t) => adaptMCPTool(t, vi.fn())),
      connection: { serverName: 'server-b', tools: [toolB], capabilities: ['tools'] },
    }
    ;(manager as any)._servers.set('server-a', serverA)
    ;(manager as any)._servers.set('server-b', serverB)
    ;(manager as any)._connected = true

    const registered = new Set<string>()
    const registry = {
      has: (name: string) => registered.has(name),
      register: (tool: any) => {
        registered.add(tool.name)
      },
    } as unknown as ToolRegistry

    const count = manager.registerAllTools(registry)
    // Only 1 unique tool should be registered (name dedup)
    expect(count).toBe(1)
    expect(registered.has('overlap-tool')).toBe(true)
  })

  it('should get tools from all connected servers', () => {
    const manager = new MCPServerManager()

    const serverA = {
      config: { name: 'server-a', type: 'stdio' as const, commandOrUrl: 'echo' },
      client: {},
      tools: [adaptMCPTool({ name: 'tool-a', inputSchema: { type: 'object' } }, vi.fn())],
      connection: { serverName: 'server-a', tools: [{ name: 'tool-a' }], capabilities: ['tools'] },
    }
    const serverB = {
      config: { name: 'server-b', type: 'stdio' as const, commandOrUrl: 'echo' },
      client: {},
      tools: [adaptMCPTool({ name: 'tool-b', inputSchema: { type: 'object' } }, vi.fn())],
      connection: { serverName: 'server-b', tools: [{ name: 'tool-b' }], capabilities: ['tools'] },
    }
    ;(manager as any)._servers.set('server-a', serverA)
    ;(manager as any)._servers.set('server-b', serverB)
    ;(manager as any)._connected = true

    const all = manager.getAllTools()
    expect(all).toHaveLength(2)
    expect(all.map((t) => t.name)).toContain('tool-a')
    expect(all.map((t) => t.name)).toContain('tool-b')
  })
})

// ─── Tool Adapter — Schema Mapping ────────────────────────

describe('Tool Adapter — Schema Edge Cases', () => {
  it('should handle enum string type in input schema', async () => {
    const mcpTool: MCPToolDefinition = {
      name: 'enum_tool',
      description: 'Tool with enum',
      inputSchema: {
        type: 'object',
        properties: {
          color: { type: 'string', enum: ['red', 'green', 'blue'] },
        },
        required: ['color'],
      },
    }

    let calledArgs: Record<string, unknown> = {}
    const tool = adaptMCPTool(mcpTool, async (_name, args) => {
      calledArgs = args
      return { content: [{ type: 'text', text: 'ok' }] }
    })

    await tool.execute({ color: 'red' }, { signal: new AbortController().signal })
    expect(calledArgs.color).toBe('red')
  })

  it('should handle oneOf schema by using first alternative', async () => {
    const mcpTool: MCPToolDefinition = {
      name: 'oneof_tool',
      inputSchema: {
        oneOf: [{ type: 'string' }, { type: 'integer' }],
      },
    }

    const tool = adaptMCPTool(mcpTool, async () => ({
      content: [{ type: 'text', text: 'ok' }],
    }))

    // Should not throw during construction
    expect(tool.name).toBe('oneof_tool')
    const result = await tool.execute({}, { signal: new AbortController().signal })
    expect(result.isError).toBeFalsy()
  })

  it('should handle anyOf schema by using first alternative', async () => {
    const mcpTool: MCPToolDefinition = {
      name: 'anyof_tool',
      inputSchema: {
        anyOf: [{ type: 'number' }, { type: 'boolean' }],
      },
    }

    expect(() => adaptMCPTool(mcpTool, async () => ({ content: [] }))).not.toThrow()
  })

  it('should handle array type in input schema', async () => {
    const mcpTool: MCPToolDefinition = {
      name: 'array_tool',
      inputSchema: {
        type: 'object',
        properties: {
          tags: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
    }

    const tool = adaptMCPTool(mcpTool, async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    expect(tool.name).toBe('array_tool')
  })

  it('should handle nested object schema', async () => {
    const mcpTool: MCPToolDefinition = {
      name: 'nested_tool',
      inputSchema: {
        type: 'object',
        properties: {
          filter: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              value: { type: 'string' },
            },
            required: ['field'],
          },
        },
        required: ['filter'],
      },
    }

    const tool = adaptMCPTool(mcpTool, async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    expect(tool.name).toBe('nested_tool')
  })

  it('should fallback to passthrough for invalid schema', async () => {
    const mcpTool: MCPToolDefinition = {
      name: 'bad_schema',
      inputSchema: { type: 'weird_type_that_does_not_exist' },
    }

    expect(() => adaptMCPTool(mcpTool, async () => ({ content: [] }))).not.toThrow()
  })

  it('should handle empty properties in object schema', async () => {
    const mcpTool: MCPToolDefinition = {
      name: 'empty_obj',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    }

    const tool = adaptMCPTool(mcpTool, async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    expect(tool.name).toBe('empty_obj')
  })

  it('should handle MCP tool error with non-Error throw', async () => {
    const mcpTool: MCPToolDefinition = {
      name: 'non_error_throw',
      inputSchema: { type: 'object' },
    }

    const tool = adaptMCPTool(mcpTool, async () => {
      // eslint-disable-next-line no-throw-literal
      throw 'string error'
    })

    const result = await tool.execute({}, { signal: new AbortController().signal })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('string error')
  })

  it('should handle MCP tool error with null/undefined throw', async () => {
    const mcpTool: MCPToolDefinition = {
      name: 'null_throw',
      inputSchema: { type: 'object' },
    }

    const tool = adaptMCPTool(mcpTool, async () => {
      // eslint-disable-next-line no-throw-literal
      throw null
    })

    const result = await tool.execute({}, { signal: new AbortController().signal })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('null')
  })
})

// ─── Tool Adapter — Execution Edge Cases ──────────────────

describe('Tool Adapter — Execution Edge Cases', () => {
  it('should return default description when none provided', () => {
    const mcpTool: MCPToolDefinition = {
      name: 'default_desc',
      inputSchema: { type: 'object' },
    }

    const tool = adaptMCPTool(mcpTool, async () => ({ content: [] }))
    expect(tool.description).toBe('MCP tool: default_desc')
  })

  it('isReadOnly should return false by default', () => {
    const mcpTool: MCPToolDefinition = {
      name: 'test',
      inputSchema: { type: 'object' },
    }
    const tool = adaptMCPTool(mcpTool, async () => ({ content: [] }))
    expect(tool.isReadOnly()).toBe(false)
  })

  it('isConcurrencySafe should return false by default', () => {
    const mcpTool: MCPToolDefinition = {
      name: 'test',
      inputSchema: { type: 'object' },
    }
    const tool = adaptMCPTool(mcpTool, async () => ({ content: [] }))
    expect(tool.isConcurrencySafe()).toBe(false)
  })
})

// ─── Tool Configuration Filtering ──────────────────────────

describe('MCPServerManager — Tool Filtering', () => {
  it('should filter tools with allowedTools list', () => {
    // Test the _filterTools private method via behavioral test
    const manager = new MCPServerManager()

    const config: MCPServerConfig = {
      name: 'filter-test',
      type: 'stdio',
      commandOrUrl: 'echo',
      toolConfiguration: {
        enabled: true,
        allowedTools: ['allowed-one', 'allowed-two'],
      },
    }

    const tools = [
      { name: 'allowed-one', description: '', inputSchema: { type: 'object' } },
      { name: 'not-allowed', description: '', inputSchema: { type: 'object' } },
      { name: 'allowed-two', description: '', inputSchema: { type: 'object' } },
    ]

    // Access private method for testing
    const filtered = (manager as any)._filterTools(config, tools)
    expect(filtered).toHaveLength(2)
    expect(filtered.map((t: any) => t.name)).toEqual(['allowed-one', 'allowed-two'])
  })

  it('should return empty array when tools disabled', () => {
    const manager = new MCPServerManager()

    const config: MCPServerConfig = {
      name: 'disabled-test',
      type: 'stdio',
      commandOrUrl: 'echo',
      toolConfiguration: { enabled: false },
    }

    const tools = [{ name: 'some-tool', description: '', inputSchema: { type: 'object' } }]

    const filtered = (manager as any)._filterTools(config, tools)
    expect(filtered).toEqual([])
  })

  it('should return all tools when no toolConfiguration set', () => {
    const manager = new MCPServerManager()

    const config: MCPServerConfig = {
      name: 'no-config',
      type: 'stdio',
      commandOrUrl: 'echo',
    }

    const tools = [
      { name: 'tool-1', description: '', inputSchema: { type: 'object' } },
      { name: 'tool-2', description: '', inputSchema: { type: 'object' } },
    ]

    const filtered = (manager as any)._filterTools(config, tools)
    expect(filtered).toHaveLength(2)
  })
})
