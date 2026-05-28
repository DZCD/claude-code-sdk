/**
 * Supplement tests for MCP module — server management, tool adapter
 * error recovery, and config-driven connection scenarios.
 *
 * Complements mcp.test.ts, mcp-edge-cases.test.ts, mcp-phase2.test.ts.
 */
import { describe, expect, it, vi } from 'vitest'
import { MCPServerManager } from '../mcp/manager.js'
import { adaptMCPTool } from '../mcp/tool-adapter.js'
import { MCPServerError } from '../mcp/types.js'
import type { MCPServerConfig, MCPToolDefinition } from '../mcp/types.js'
import type { ToolRegistry } from '../tools/registry.js'

// ─── MCPServerManager — Server Management ──────────────────

describe('MCPServerManager — Server Management', () => {
  it('should handle connectAll with URL-type config gracefully (no real connection)', async () => {
    const manager = new MCPServerManager()
    const configs: MCPServerConfig[] = [
      { name: 'url-server', type: 'url', commandOrUrl: 'https://invalid.example.com/mcp' },
    ]
    // URL-type servers will fail to connect (no real server), but should not crash
    await expect(manager.connectAll(configs)).rejects.toThrow()
    expect(manager.isConnected).toBe(false)
  }, 15_000)

  it('should handle connectAll with auth token config gracefully', async () => {
    const manager = new MCPServerManager()
    const configs: MCPServerConfig[] = [
      {
        name: 'auth-server',
        type: 'url',
        commandOrUrl: 'https://auth.invalid.example.com/mcp',
        authorizationToken: 'test-token-123',
      },
    ]
    // Should attempt connection with token but fail gracefully
    await expect(manager.connectAll(configs)).rejects.toThrow()
  }, 15_000)

  it('should handle connectAll with abort signal (cancellation)', async () => {
    const manager = new MCPServerManager()
    const ac = new AbortController()
    ac.abort() // Already aborted

    const configs: MCPServerConfig[] = [
      { name: 'canceled', type: 'stdio', commandOrUrl: 'echo' },
    ]

    // Pre-aborted signal should cause connection to fail
    await expect(manager.connectAll(configs, ac.signal)).rejects.toThrow()
  })

  it('should return empty connection info after disconnectAll', async () => {
    const manager = new MCPServerManager()

    // Inject a mock server
    const server = {
      config: { name: 'test-server', type: 'stdio' as const, commandOrUrl: 'echo' },
      client: { close: vi.fn().mockResolvedValue(undefined) },
      tools: [],
      connection: { serverName: 'test-server', tools: [], capabilities: ['tools'] },
    }
    ;(manager as any)._servers.set('test-server', server)
    ;(manager as any)._connected = true

    await manager.disconnectAll()
    expect(manager.isConnected).toBe(false)
    expect(manager.connectedServers).toEqual([])
    expect(manager.getConnectionInfo()).toEqual([])
  })

  it('should handle tool filtering with allowedTools returning empty subset', () => {
    const manager = new MCPServerManager()
    const config: MCPServerConfig = {
      name: 'filter-test',
      type: 'stdio',
      commandOrUrl: 'echo',
      toolConfiguration: { allowedTools: ['tool-a', 'tool-b'] },
    }

    const tools = [
      { name: 'tool-a', description: 'A', inputSchema: { type: 'object' } },
      { name: 'tool-b', description: 'B', inputSchema: { type: 'object' } },
      { name: 'tool-c', description: 'C', inputSchema: { type: 'object' } },
    ]

    const filtered = (manager as any)._filterTools(config, tools)
    expect(filtered).toHaveLength(2)
    expect(filtered.map((t: any) => t.name).sort()).toEqual(['tool-a', 'tool-b'])
  })
})

// ─── Tool Adapter — Error Recovery ─────────────────────────

describe('Tool Adapter — Error Recovery', () => {
  it('should handle MCP tool execution with empty content array and no error', async () => {
    const mcpTool: MCPToolDefinition = {
      name: 'no-content',
      inputSchema: { type: 'object' },
    }

    const tool = adaptMCPTool(mcpTool, async () => ({
      content: [],
    }))

    const result = await tool.execute({}, { signal: new AbortController().signal })
    expect(result.isError).toBeFalsy()
    // Should fall back to JSON.stringify of the empty result
    expect(typeof result.content).toBe('string')
  })

  it('should handle MCP tool response with non-text content blocks', async () => {
    const mcpTool: MCPToolDefinition = {
      name: 'mixed-content',
      inputSchema: { type: 'object' },
    }

    const tool = adaptMCPTool(mcpTool, async () => ({
      content: [
        { type: 'text', text: 'Text result' },
        { type: 'image', data: 'base64data' },
        { type: 'resource', resource: { uri: 'file:///test.txt' } },
      ],
    }))

    const result = await tool.execute({}, { signal: new AbortController().signal })
    expect(result.isError).toBeFalsy()
    // Should extract only text blocks
    expect(result.content).toContain('Text result')
    expect(typeof result.content).toBe('string')
  })

  it('should handle MCP tool response with isError flag and no text content', async () => {
    const mcpTool: MCPToolDefinition = {
      name: 'error-no-text',
      inputSchema: { type: 'object' },
    }

    const tool = adaptMCPTool(mcpTool, async () => ({
      content: [{ type: 'resource', resource: { uri: 'error://code' } }],
      isError: true,
    }))

    const result = await tool.execute({}, { signal: new AbortController().signal })
    expect(result.isError).toBe(true)
    // Should stringify the entire result since there's no text content
    expect(typeof result.content).toBe('string')
  })

  it('should handle callToolFn that returns malformed result', async () => {
    const mcpTool: MCPToolDefinition = {
      name: 'malformed',
      inputSchema: { type: 'object' },
    }

    const tool = adaptMCPTool(mcpTool, async () => {
      // Simulate malformed result where content is undefined
      return { content: undefined } as any
    })

    const result = await tool.execute({}, { signal: new AbortController().signal })
    // Should not crash, just produce some result
    expect(typeof result.content).toBe('string')
  })

  it('should handle integer type in input schema correctly', async () => {
    const mcpTool: MCPToolDefinition = {
      name: 'int-tool',
      inputSchema: {
        type: 'object',
        properties: {
          count: { type: 'integer' },
          name: { type: 'string' },
        },
        required: ['count'],
      },
    }

    let receivedArgs: Record<string, unknown> = {}
    const tool = adaptMCPTool(mcpTool, async (_name, args) => {
      receivedArgs = args
      return { content: [{ type: 'text', text: 'ok' }] }
    })

    await tool.execute({ count: 5, name: 'test' }, { signal: new AbortController().signal })
    expect(receivedArgs.count).toBe(5)
    expect(receivedArgs.name).toBe('test')
  })

  it('should handle boolean type in input schema', async () => {
    const mcpTool: MCPToolDefinition = {
      name: 'bool-tool',
      inputSchema: {
        type: 'object',
        properties: {
          verbose: { type: 'boolean' },
        },
      },
    }

    let receivedArgs: Record<string, unknown> = {}
    const tool = adaptMCPTool(mcpTool, async (_name, args) => {
      receivedArgs = args
      return { content: [{ type: 'text', text: 'ok' }] }
    })

    await tool.execute({ verbose: true }, { signal: new AbortController().signal })
    expect(receivedArgs.verbose).toBe(true)
  })

  it('should handle number type with default description', async () => {
    const mcpTool: MCPToolDefinition = {
      name: 'num-tool',
      inputSchema: {
        type: 'object',
        properties: {
          value: { type: 'number' },
        },
      },
    }

    const tool = adaptMCPTool(mcpTool, async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    expect(tool.description).toBe('MCP tool: num-tool')
  })
})

// ─── MCPServerManager — registerAllTools Edge Cases ────────

describe('MCPServerManager — registerAllTools Edge Cases', () => {
  it('should skip tools that are already registered', () => {
    const manager = new MCPServerManager()

    const serverA = {
      config: { name: 'server-a', type: 'stdio' as const, commandOrUrl: 'echo' },
      client: {},
      tools: [
        adaptMCPTool({ name: 'shared-tool', inputSchema: { type: 'object' } }, vi.fn()),
        adaptMCPTool({ name: 'unique-a', inputSchema: { type: 'object' } }, vi.fn()),
      ],
      connection: { serverName: 'server-a', tools: [], capabilities: ['tools'] },
    }
    ;(manager as any)._servers.set('server-a', serverA)
    ;(manager as any)._connected = true

    const registeredSet = new Set<string>()
    const registry = {
      has: (name: string) => registeredSet.has(name),
      register: (tool: any) => { registeredSet.add(tool.name) },
    } as unknown as ToolRegistry

    // First pass: register both
    expect(manager.registerAllTools(registry)).toBe(2)

    // Second pass: should skip shared-tool and unique-a
    const serverB = {
      config: { name: 'server-b', type: 'stdio' as const, commandOrUrl: 'echo' },
      client: {},
      tools: [
        adaptMCPTool({ name: 'shared-tool', inputSchema: { type: 'object' } }, vi.fn()),
        adaptMCPTool({ name: 'unique-b', inputSchema: { type: 'object' } }, vi.fn()),
      ],
      connection: { serverName: 'server-b', tools: [], capabilities: ['tools'] },
    }
    ;(manager as any)._servers.set('server-b', serverB)

    // shared-tool already registered, only unique-b is new
    expect(manager.registerAllTools(registry)).toBe(1)
    expect(registeredSet.has('unique-b')).toBe(true)
  })
})
