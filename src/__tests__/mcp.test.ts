/**
 * Tests for MCP protocol types and module exports.
 */
import { describe, expect, it } from 'vitest'
import { MCPServerManager } from '../mcp/manager.js'
import { adaptMCPTool } from '../mcp/tool-adapter.js'
import { MCPServerError } from '../mcp/types.js'
import type { MCPServerConfig, MCPToolDefinition } from '../mcp/types.js'
import type { ToolRegistry } from '../tools/registry.js'

describe('MCP Types', () => {
  it('MCPServerError has correct name and serializes server name', () => {
    const err = new MCPServerError('Connection failed', 'test-server', new Error('timeout'))
    expect(err.name).toBe('MCPServerError')
    expect(err.message).toContain('test-server')
    expect(err.message).toContain('Connection failed')
    expect(err.serverName).toBe('test-server')
    expect(err.cause).toBeInstanceOf(Error)
  })

  it('MCPServerError can be created without cause', () => {
    const err = new MCPServerError('simple error', 'my-server')
    expect(err.serverName).toBe('my-server')
    expect(err.cause).toBeUndefined()
  })
})

describe('MCPServerManager', () => {
  it('starts with no connections', () => {
    const manager = new MCPServerManager()
    expect(manager.isConnected).toBe(false)
    expect(manager.connectedServers).toEqual([])
    expect(manager.getConnectionInfo()).toEqual([])
  })

  it('getAllTools returns empty when no servers connected', () => {
    const manager = new MCPServerManager()
    expect(manager.getAllTools()).toEqual([])
  })

  it('handles empty config gracefully', async () => {
    const manager = new MCPServerManager()
    await manager.connectAll([])
    expect(manager.isConnected).toBe(false)
  })

  it('disconnectAll is safe when not connected', async () => {
    const manager = new MCPServerManager()
    await manager.disconnectAll()
    expect(manager.isConnected).toBe(false)
  })

  it('registerAllTools on empty manager returns 0', () => {
    const manager = new MCPServerManager()
    // Create a mock registry
    const registry = {
      has: () => false,
      register: () => {},
    } as unknown as ToolRegistry
    const count = manager.registerAllTools(registry)
    expect(count).toBe(0)
  })
})

describe('Tool Adapter', () => {
  it('creates a Tool from MCP tool definition', () => {
    const mcpTool: MCPToolDefinition = {
      name: 'test_tool',
      description: 'A test tool',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'integer' },
        },
        required: ['query'],
      },
    }

    let calledName = ''
    let calledArgs: Record<string, unknown> = {}

    const tool = adaptMCPTool(mcpTool, async (name, args) => {
      calledName = name
      calledArgs = args
      return {
        content: [{ type: 'text', text: 'result: success' }],
      }
    })

    expect(tool.name).toBe('test_tool')
    expect(tool.description).toBe('A test tool')
    expect(typeof tool.execute).toBe('function')
    expect(typeof tool.isReadOnly).toBe('function')
    expect(typeof tool.isConcurrencySafe).toBe('function')
  })

  it('executes an MCP tool and returns result', async () => {
    const mcpTool: MCPToolDefinition = {
      name: 'calculator',
      description: 'A calculator',
      inputSchema: {
        type: 'object',
        properties: {
          a: { type: 'number' },
          b: { type: 'number' },
        },
      },
    }

    const tool = adaptMCPTool(mcpTool, async (name, args) => {
      expect(name).toBe('calculator')
      expect(args).toEqual({ a: 1, b: 2 })
      return {
        content: [{ type: 'text', text: '3' }],
      }
    })

    const result = await tool.execute({ a: 1, b: 2 }, { signal: new AbortController().signal })
    expect(result.content).toBe('3')
    expect(result.isError).toBeFalsy()
    expect(result.data).toBeDefined()
  })

  it('handles MCP tool execution errors gracefully', async () => {
    const mcpTool: MCPToolDefinition = {
      name: 'broken_tool',
      description: 'A broken tool',
      inputSchema: { type: 'object' },
    }

    const tool = adaptMCPTool(mcpTool, async () => {
      throw new Error('Something went wrong')
    })

    const result = await tool.execute({}, { signal: new AbortController().signal })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Something went wrong')
  })

  it('handles MCP tool error responses', async () => {
    const mcpTool: MCPToolDefinition = {
      name: 'error_tool',
      description: 'An error tool',
      inputSchema: { type: 'object' },
    }

    const tool = adaptMCPTool(mcpTool, async () => ({
      content: [{ type: 'text', text: 'Error occurred' }],
      isError: true,
    }))

    const result = await tool.execute({}, { signal: new AbortController().signal })
    expect(result.isError).toBe(true)
    expect(result.content).toBe('Error occurred')
  })

  it('handles empty content in MCP tool response', async () => {
    const mcpTool: MCPToolDefinition = {
      name: 'empty_tool',
      inputSchema: { type: 'object' },
    }

    const tool = adaptMCPTool(mcpTool, async () => ({
      content: [],
    }))

    const result = await tool.execute({}, { signal: new AbortController().signal })
    expect(result.isError).toBeFalsy()
    expect(typeof result.content).toBe('string')
  })
})
