/**
 * Tests for MCPServerManager Phase 2 features
 *
 * Wave 3: MCP Resource support (listResources, readResource)
 * Wave 4: MCP Prompt template support (listPrompts, getPrompt)
 */
import { describe, expect, it, vi } from 'vitest'
import { MCPServerManager } from '../mcp/manager.js'
import type {
  MCPGetPromptResult,
  MCPPromptDefinition,
  MCPResourceContent,
  MCPResourceDefinition,
} from '../mcp/types.js'
import { MCPServerError } from '../mcp/types.js'

/**
 * Creates a mock MCP client with configurable capabilities.
 */
function createMockClient(capabilities: Record<string, boolean> = {}) {
  return {
    getServerCapabilities: vi.fn().mockReturnValue(capabilities),
    request: vi.fn(),
    getPrompt: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  }
}

/**
 * Helper: connect a manager to a mock server config for testing.
 */
async function connectMockServer(
  manager: MCPServerManager,
  name: string,
  capabilities: Record<string, boolean> = { tools: true },
  mockTools: Array<{
    name: string
    description?: string
    inputSchema: Record<string, unknown>
  }> = [],
): Promise<ReturnType<typeof createMockClient>> {
  const mockClient = createMockClient(capabilities)
  mockClient.request.mockImplementation(async (req: any) => {
    if (req.method === 'tools/list') {
      return { tools: mockTools }
    }
    return {}
  })

  // We need to bypass the actual connection and inject our mock
  // Use the internal method via type assertion
  const server: any = {
    config: { name, type: 'stdio' as const, commandOrUrl: 'echo' },
    client: mockClient,
    tools: [],
    connection: {
      serverName: name,
      tools: mockTools,
      capabilities: Object.keys(capabilities),
    },
  }

  // Access private _servers through any
  ;(manager as any)._servers.set(name, server)
  ;(manager as any)._connected = true

  return mockClient
}

describe('MCPServerManager Phase 2 — Resources', () => {
  describe('listResources()', () => {
    it('should return empty array when no servers connected', async () => {
      const manager = new MCPServerManager()
      const resources = await manager.listResources()
      expect(resources).toEqual([])
    })

    it('should list resources from all connected servers', async () => {
      const manager = new MCPServerManager()
      const mockClient = await connectMockServer(manager, 'test-server', {
        tools: true,
        resources: true,
      })

      mockClient.request.mockImplementation(async (req: any) => {
        if (req.method === 'resources/list') {
          return {
            resources: [
              {
                uri: 'file:///data/doc1.md',
                name: 'Document 1',
                mimeType: 'text/markdown',
              },
              {
                uri: 'file:///data/doc2.txt',
                name: 'Document 2',
                mimeType: 'text/plain',
              },
            ],
          }
        }
        return {}
      })

      const resources = await manager.listResources()
      expect(resources).toHaveLength(2)
      expect(resources[0]).toMatchObject({
        uri: 'file:///data/doc1.md',
        name: 'Document 1',
        server: 'test-server',
      })
      expect(resources[1]).toMatchObject({
        uri: 'file:///data/doc2.txt',
        name: 'Document 2',
        server: 'test-server',
      })
    })

    it('should filter resources by server name', async () => {
      const manager = new MCPServerManager()

      const mockClient1 = await connectMockServer(manager, 'server-a', {
        tools: true,
        resources: true,
      })
      const mockClient2 = createMockClient({ tools: true, resources: true })
      const serverB: any = {
        config: {
          name: 'server-b',
          type: 'stdio' as const,
          commandOrUrl: 'echo',
        },
        client: mockClient2,
        tools: [],
        connection: {
          serverName: 'server-b',
          tools: [],
          capabilities: ['tools', 'resources'],
        },
      }
      ;(manager as any)._servers.set('server-b', serverB)

      mockClient1.request.mockImplementation(async (req: any) => {
        if (req.method === 'resources/list') {
          return {
            resources: [{ uri: 'file:///a.md', name: 'A', server: 'server-a' }],
          }
        }
        return {}
      })
      mockClient2.request.mockImplementation(async (req: any) => {
        if (req.method === 'resources/list') {
          return {
            resources: [{ uri: 'file:///b.md', name: 'B', server: 'server-b' }],
          }
        }
        return {}
      })

      const resources = await manager.listResources('server-a')
      expect(resources).toHaveLength(1)
      expect(resources[0].uri).toBe('file:///a.md')
    })

    it('should return empty array for non-existent server', async () => {
      const manager = new MCPServerManager()
      await connectMockServer(manager, 'real-server', {
        tools: true,
        resources: true,
      })

      const resources = await manager.listResources('nonexistent-server')
      expect(resources).toEqual([])
    })

    it('should return empty if server does not support resources', async () => {
      const manager = new MCPServerManager()
      await connectMockServer(manager, 'no-resources', { tools: true })

      const resources = await manager.listResources('no-resources')
      expect(resources).toEqual([])
    })

    it('should handle one server failure without blocking others', async () => {
      const manager = new MCPServerManager()
      const mockClient1 = await connectMockServer(manager, 'failing-server', {
        tools: true,
        resources: true,
      })
      const mockClient2 = createMockClient({ tools: true, resources: true })
      const serverB: any = {
        config: {
          name: 'working-server',
          type: 'stdio' as const,
          commandOrUrl: 'echo',
        },
        client: mockClient2,
        tools: [],
        connection: {
          serverName: 'working-server',
          tools: [],
          capabilities: ['tools', 'resources'],
        },
      }
      ;(manager as any)._servers.set('working-server', serverB)

      mockClient1.request.mockRejectedValue(new Error('Connection lost'))
      mockClient2.request.mockImplementation(async (req: any) => {
        if (req.method === 'resources/list') {
          return {
            resources: [
              {
                uri: 'file:///working.md',
                name: 'Working Doc',
                server: 'working-server',
              },
            ],
          }
        }
        return {}
      })

      const resources = await manager.listResources()
      // Should still get resources from the working server
      expect(resources).toHaveLength(1)
      expect(resources[0].name).toBe('Working Doc')
    })

    it('should add server name to each resource', async () => {
      const manager = new MCPServerManager()
      const mockClient = await connectMockServer(manager, 'my-server', {
        tools: true,
        resources: true,
      })

      mockClient.request.mockImplementation(async (req: any) => {
        if (req.method === 'resources/list') {
          return {
            resources: [
              {
                uri: 'file:///data.md',
                name: 'Data',
                mimeType: 'text/markdown',
              },
            ],
          }
        }
        return {}
      })

      const resources = await manager.listResources()
      expect(resources[0].server).toBe('my-server')
    })
  })

  describe('readResource()', () => {
    it('should throw if no servers connected', async () => {
      const manager = new MCPServerManager()
      await expect(manager.readResource('any-server', 'file:///test.md')).rejects.toThrow(/not found/i)
    })

    it('should throw if server does not exist', async () => {
      const manager = new MCPServerManager()
      await connectMockServer(manager, 'real-server', { tools: true })

      await expect(manager.readResource('nonexistent', 'file:///test.md')).rejects.toThrow(/not found/i)
    })

    it('should throw if server does not support resources', async () => {
      const manager = new MCPServerManager()
      await connectMockServer(manager, 'no-resources', { tools: true })

      await expect(manager.readResource('no-resources', 'file:///test.md')).rejects.toThrow(
        /does not support resources/i,
      )
    })

    it('should read a text resource successfully', async () => {
      const manager = new MCPServerManager()
      const mockClient = await connectMockServer(manager, 'docs-server', {
        tools: true,
        resources: true,
      })

      mockClient.request.mockImplementation(async (req: any) => {
        if (req.method === 'resources/read') {
          return {
            contents: [
              {
                uri: 'file:///readme.md',
                mimeType: 'text/markdown',
                text: '# Hello World\nThis is content.',
              },
            ],
          }
        }
        return {}
      })

      const contents = await manager.readResource('docs-server', 'file:///readme.md')
      expect(contents).toHaveLength(1)
      expect(contents[0].uri).toBe('file:///readme.md')
      expect(contents[0].text).toContain('Hello World')
    })

    it('should read a binary blob resource', async () => {
      const manager = new MCPServerManager()
      const mockClient = await connectMockServer(manager, 'img-server', {
        tools: true,
        resources: true,
      })

      mockClient.request.mockImplementation(async (req: any) => {
        if (req.method === 'resources/read') {
          return {
            contents: [
              {
                uri: 'file:///image.png',
                mimeType: 'image/png',
                blob: Buffer.from('fake-png-data').toString('base64'),
              },
            ],
          }
        }
        return {}
      })

      const contents = await manager.readResource('img-server', 'file:///image.png')
      expect(contents).toHaveLength(1)
      expect(contents[0].uri).toBe('file:///image.png')
      expect(contents[0].blob).toBeDefined()
    })

    it('should propagate MCP protocol errors', async () => {
      const manager = new MCPServerManager()
      const mockClient = await connectMockServer(manager, 'err-server', {
        tools: true,
        resources: true,
      })

      mockClient.request.mockRejectedValue(new Error('Resource not found: file:///missing.md'))

      await expect(manager.readResource('err-server', 'file:///missing.md')).rejects.toThrow(/Resource not found/i)
    })
  })
})

describe('MCPServerManager Phase 2 — Prompts', () => {
  describe('listPrompts()', () => {
    it('should return empty array when no servers connected', async () => {
      const manager = new MCPServerManager()
      const prompts = await manager.listPrompts()
      expect(prompts).toEqual([])
    })

    it('should list prompts from all connected servers', async () => {
      const manager = new MCPServerManager()
      const mockClient = await connectMockServer(manager, 'prompt-server', {
        tools: true,
        prompts: true,
      })

      mockClient.request.mockImplementation(async (req: any) => {
        if (req.method === 'prompts/list') {
          return {
            prompts: [
              { name: 'greet', description: 'Generate a greeting' },
              {
                name: 'summarize',
                description: 'Summarize text',
                arguments: [
                  {
                    name: 'text',
                    description: 'Text to summarize',
                    required: true,
                  },
                ],
              },
            ],
          }
        }
        return {}
      })

      const prompts = await manager.listPrompts()
      expect(prompts).toHaveLength(2)
      expect(prompts[0]).toMatchObject({
        name: 'greet',
        description: 'Generate a greeting',
        server: 'prompt-server',
      })
      expect(prompts[1].arguments).toHaveLength(1)
      expect(prompts[1].arguments![0].name).toBe('text')
    })

    it('should filter prompts by server name', async () => {
      const manager = new MCPServerManager()
      const mockClient = await connectMockServer(manager, 'prompt-a', {
        tools: true,
        prompts: true,
      })

      mockClient.request.mockImplementation(async (req: any) => {
        if (req.method === 'prompts/list') {
          return {
            prompts: [{ name: 'greet', description: 'Greeting prompt' }],
          }
        }
        return {}
      })

      const prompts = await manager.listPrompts('prompt-a')
      expect(prompts).toHaveLength(1)
      expect(prompts[0].name).toBe('greet')

      const noPrompts = await manager.listPrompts('nonexistent')
      expect(noPrompts).toEqual([])
    })

    it('should return empty if server does not support prompts', async () => {
      const manager = new MCPServerManager()
      await connectMockServer(manager, 'no-prompts', { tools: true })

      const prompts = await manager.listPrompts('no-prompts')
      expect(prompts).toEqual([])
    })

    it('should handle server failure gracefully', async () => {
      const manager = new MCPServerManager()
      const mockClient1 = await connectMockServer(manager, 'failing-server', {
        tools: true,
        prompts: true,
      })
      const mockClient2 = createMockClient({ tools: true, prompts: true })
      const serverB: any = {
        config: {
          name: 'working-server',
          type: 'stdio' as const,
          commandOrUrl: 'echo',
        },
        client: mockClient2,
        tools: [],
        connection: {
          serverName: 'working-server',
          tools: [],
          capabilities: ['tools', 'prompts'],
        },
      }
      ;(manager as any)._servers.set('working-server', serverB)

      mockClient1.request.mockRejectedValue(new Error('Failure'))
      mockClient2.request.mockImplementation(async (req: any) => {
        if (req.method === 'prompts/list') {
          return {
            prompts: [{ name: 'working-prompt', description: 'This works!' }],
          }
        }
        return {}
      })

      // One failing server shouldn't prevent getting results from another
      const prompts = await manager.listPrompts()
      expect(prompts).toHaveLength(1)
      expect(prompts[0].name).toBe('working-prompt')
    })
  })

  describe('getPrompt()', () => {
    it('should throw if no servers connected', async () => {
      const manager = new MCPServerManager()
      await expect(manager.getPrompt('any-server', 'test-prompt')).rejects.toThrow(/not found/i)
    })

    it('should throw if server does not exist', async () => {
      const manager = new MCPServerManager()
      await connectMockServer(manager, 'real-server', { tools: true })

      await expect(manager.getPrompt('nonexistent', 'test-prompt')).rejects.toThrow(/not found/i)
    })

    it('should throw if server does not support prompts', async () => {
      const manager = new MCPServerManager()
      await connectMockServer(manager, 'no-prompts', { tools: true })

      await expect(manager.getPrompt('no-prompts', 'test-prompt')).rejects.toThrow(/does not support prompts/i)
    })

    it('should get a prompt template with arguments', async () => {
      const manager = new MCPServerManager()
      const mockClient = await connectMockServer(manager, 'prompt-server', {
        tools: true,
        prompts: true,
      })

      mockClient.getPrompt.mockResolvedValue({
        description: 'A greeting',
        messages: [{ role: 'user', content: { type: 'text', text: 'Hello!' } }],
      })

      const result = await manager.getPrompt('prompt-server', 'greet', {
        name: 'World',
      })
      expect(result.description).toBe('A greeting')
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].role).toBe('user')

      // Verify the MCP client was called with correct parameters
      expect(mockClient.getPrompt).toHaveBeenCalledWith({
        name: 'greet',
        arguments: { name: 'World' },
      })
    })

    it('should get a prompt template without arguments', async () => {
      const manager = new MCPServerManager()
      const mockClient = await connectMockServer(manager, 'simple-server', {
        tools: true,
        prompts: true,
      })

      mockClient.getPrompt.mockResolvedValue({
        description: 'Simple prompt',
        messages: [{ role: 'assistant', content: { type: 'text', text: 'Response' } }],
      })

      const result = await manager.getPrompt('simple-server', 'simple-prompt')
      expect(result.messages).toHaveLength(1)
      expect(mockClient.getPrompt).toHaveBeenCalledWith({
        name: 'simple-prompt',
        arguments: undefined,
      })
    })

    it('should propagate errors from MCP server', async () => {
      const manager = new MCPServerManager()
      const mockClient = await connectMockServer(manager, 'err-server', {
        tools: true,
        prompts: true,
      })

      mockClient.getPrompt.mockRejectedValue(new Error('Prompt not found: unknown-prompt'))

      await expect(manager.getPrompt('err-server', 'unknown-prompt')).rejects.toThrow(/Prompt not found/i)
    })
  })
})
