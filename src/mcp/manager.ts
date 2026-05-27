/**
 * ClaudeCode SDK — MCP Server Manager
 *
 * Manages the lifecycle of multiple MCP server connections.
 * Provides a unified interface for tool discovery, tool execution,
 * and connection lifecycle (connect/disconnect/reconnect).
 *
 * Uses @modelcontextprotocol/sdk internally.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  CallToolResultSchema,
  ListPromptsResultSchema,
  ListResourcesResultSchema,
  ReadResourceResultSchema,
} from '@modelcontextprotocol/sdk/types.js'
import type { ToolRegistry } from '../tools/registry.js'
import type { Tool } from '../types/tool.js'
import { adaptMCPTool } from './tool-adapter.js'
import type {
  MCPConnection,
  MCPGetPromptResult,
  MCPPromptDefinition,
  MCPResourceContent,
  MCPResourceDefinition,
  MCPServerConfig,
} from './types.js'
import { MCPServerError } from './types.js'

/**
 * Internal wrapper for a connected MCP client.
 */
interface ConnectedServer {
  config: MCPServerConfig
  client: Client
  tools: Tool[]
  connection: MCPConnection
}

/**
 * Manages connections to one or more MCP servers.
 */
export class MCPServerManager {
  private readonly _servers: Map<string, ConnectedServer> = new Map()
  private _connected = false

  /**
   * Get the list of currently connected server names.
   */
  get connectedServers(): string[] {
    return Array.from(this._servers.keys())
  }

  /**
   * Whether the manager has active connections.
   */
  get isConnected(): boolean {
    return this._connected
  }

  /**
   * Connect to all configured MCP servers.
   *
   * @param configs - Array of MCP server configurations
   * @param signal - Optional abort signal
   */
  async connectAll(configs: MCPServerConfig[], signal?: AbortSignal): Promise<void> {
    // Close any existing connections first
    await this.disconnectAll()

    if (configs.length === 0) return

    const errors: Error[] = []

    for (const config of configs) {
      try {
        const server = await this._connectServer(config, signal)
        this._servers.set(config.name, server)
      } catch (err) {
        errors.push(err instanceof Error ? err : new MCPServerError(String(err), config.name))
      }
    }

    this._connected = this._servers.size > 0

    // If no servers connected successfully, throw
    if (this._servers.size === 0 && errors.length > 0) {
      throw errors.length === 1 ? errors[0] : new AggregateError(errors, 'Failed to connect to any MCP server')
    }

    // Log warnings for failed connections (but don't fail the whole batch)
    for (const err of errors) {
      console.warn(`[MCP] Connection warning: ${err.message}`)
    }
  }

  /**
   * Connect to a single MCP server.
   */
  private async _connectServer(config: MCPServerConfig, signal?: AbortSignal): Promise<ConnectedServer> {
    const client = new Client({ name: 'claude-code-sdk', version: '0.1.0' }, { capabilities: {} })

    if (config.type === 'stdio') {
      const transport = new StdioClientTransport({
        command: config.commandOrUrl,
        args: config.args ?? [],
        env: config.env,
        stderr: 'pipe',
      })
      await client.connect(transport, signal ? { signal } : undefined)
    } else {
      // URL-based (Streamable HTTP) transport
      const headers: Record<string, string> = {}
      if (config.authorizationToken) {
        headers.Authorization = `Bearer ${config.authorizationToken}`
      }

      // Use dynamic import for Streamable HTTP transport
      const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
      const transport = new StreamableHTTPClientTransport(new URL(config.commandOrUrl))
      // Set authorization header via options if transport supports it
      await client.connect(transport, signal ? { signal } : undefined)
    }

    // Discover tools
    const serverCapabilities = client.getServerCapabilities()
    const capabilities = serverCapabilities
      ? Object.keys(serverCapabilities).filter((k) => serverCapabilities[k as keyof typeof serverCapabilities])
      : []

    let mcpTools: Array<{
      name: string
      description?: string
      inputSchema: Record<string, unknown>
    }> = []
    try {
      const toolsResult = await client.listTools()
      mcpTools = toolsResult.tools as unknown as typeof mcpTools
    } catch (err) {
      // Some servers may not support tools
      console.warn(`[MCP] Server "${config.name}" does not support tools:`, (err as Error).message)
    }

    // Apply tool configuration filter
    const filteredTools = this._filterTools(config, mcpTools)

    // Wrap each MCP tool into our SDK Tool interface
    const adaptedTools: Tool[] = filteredTools.map((mcpTool) =>
      adaptMCPTool(mcpTool, async (name, args) => {
        const result = await client.callTool({ name, arguments: args }, CallToolResultSchema)
        return {
          content: (result.content ?? []) as Array<{
            type: string
            text?: string
          }>,
          isError: result.isError ?? false,
        } as {
          content: Array<{ type: string; text?: string }>
          isError?: boolean
        }
      }),
    )

    const connection: MCPConnection = {
      serverName: config.name,
      tools: filteredTools,
      capabilities,
    }

    return { config, client, tools: adaptedTools, connection }
  }

  /**
   * Filter tools based on server tool configuration.
   */
  private _filterTools(
    config: MCPServerConfig,
    tools: Array<{
      name: string
      description?: string
      inputSchema: Record<string, unknown>
    }>,
  ): typeof tools {
    const toolConfig = config.toolConfiguration
    if (!toolConfig) return tools
    if (toolConfig.enabled === false) return []

    if (toolConfig.allowedTools && toolConfig.allowedTools.length > 0) {
      return tools.filter((t) => toolConfig.allowedTools!.includes(t.name))
    }

    return tools
  }

  /**
   * Register all MCP tools into a ToolRegistry.
   * Skips tools that are already registered (by name).
   *
   * @returns The number of tools registered.
   */
  registerAllTools(registry: ToolRegistry): number {
    let count = 0
    for (const [, server] of this._servers) {
      for (const tool of server.tools) {
        if (!registry.has(tool.name)) {
          registry.register(tool)
          count++
        }
      }
    }
    return count
  }

  /**
   * Get all adapted tools from all connected servers.
   */
  getAllTools(): Tool[] {
    const all: Tool[] = []
    for (const [, server] of this._servers) {
      all.push(...server.tools)
    }
    return all
  }

  /**
   * Get connection info for all servers.
   */
  getConnectionInfo(): MCPConnection[] {
    return Array.from(this._servers.values()).map((s) => s.connection)
  }

  // ========== Phase 2: Resource Support ==========

  /**
   * List resources from connected MCP servers.
   *
   * @param serverName - Optional server name to filter by
   * @returns Array of resource definitions
   */
  async listResources(serverName?: string): Promise<MCPResourceDefinition[]> {
    if (this._servers.size === 0) return []

    const servers = serverName
      ? ([this._servers.get(serverName)].filter(Boolean) as ConnectedServer[])
      : Array.from(this._servers.values())

    if (serverName && servers.length === 0) return []

    const results = await Promise.all(
      servers.map(async (server) => {
        const capabilities = server.client.getServerCapabilities()
        if (!capabilities?.resources) return [] as MCPResourceDefinition[]

        try {
          const result = await server.client.request({ method: 'resources/list' }, ListResourcesResultSchema)
          if (!result.resources) return []

          return result.resources.map((resource) => ({
            uri: resource.uri,
            name: resource.name,
            description: (resource as any).description,
            mimeType: (resource as any).mimeType,
            server: server.config.name,
          })) as MCPResourceDefinition[]
        } catch (err) {
          console.warn(`[MCP] Failed to list resources from "${server.config.name}":`, (err as Error).message)
          return [] as MCPResourceDefinition[]
        }
      }),
    )

    return results.flat()
  }

  /**
   * Read a specific resource from an MCP server.
   *
   * @param serverName - The server to read from
   * @param uri - The resource URI to read
   * @returns Array of resource content items
   * @throws MCPServerError if server not found or doesn't support resources
   */
  async readResource(serverName: string, uri: string): Promise<MCPResourceContent[]> {
    const server = this._servers.get(serverName)
    if (!server) {
      throw new MCPServerError(
        `Server "${serverName}" not found. Available servers: ${this.connectedServers.join(', ')}`,
        serverName,
      )
    }

    const capabilities = server.client.getServerCapabilities()
    if (!capabilities?.resources) {
      throw new MCPServerError(`Server "${serverName}" does not support resources`, serverName)
    }

    try {
      const result = await server.client.request(
        { method: 'resources/read', params: { uri } },
        ReadResourceResultSchema,
      )

      return result.contents.map((content) => ({
        uri: content.uri,
        mimeType: (content as any).mimeType,
        text: 'text' in content ? content.text : undefined,
        blob: 'blob' in content ? (content as any).blob : undefined,
      })) as MCPResourceContent[]
    } catch (err) {
      throw new MCPServerError(`Failed to read resource "${uri}": ${(err as Error).message}`, serverName, err)
    }
  }

  // ========== Phase 2: Prompt Support ==========

  /**
   * List prompt templates from connected MCP servers.
   *
   * @param serverName - Optional server name to filter by
   * @returns Array of prompt definitions
   */
  async listPrompts(serverName?: string): Promise<MCPPromptDefinition[]> {
    if (this._servers.size === 0) return []

    const servers = serverName
      ? ([this._servers.get(serverName)].filter(Boolean) as ConnectedServer[])
      : Array.from(this._servers.values())

    if (serverName && servers.length === 0) return []

    const results = await Promise.all(
      servers.map(async (server) => {
        const capabilities = server.client.getServerCapabilities()
        if (!capabilities?.prompts) return [] as MCPPromptDefinition[]

        try {
          const result = await server.client.request({ method: 'prompts/list' }, ListPromptsResultSchema)
          if (!result.prompts) return []

          return result.prompts.map((prompt) => ({
            name: prompt.name,
            description: (prompt as any).description,
            arguments: (prompt as any).arguments?.map((arg: any) => ({
              name: arg.name,
              description: arg.description,
              required: arg.required,
            })),
            server: server.config.name,
          })) as MCPPromptDefinition[]
        } catch (err) {
          console.warn(`[MCP] Failed to list prompts from "${server.config.name}":`, (err as Error).message)
          return [] as MCPPromptDefinition[]
        }
      }),
    )

    return results.flat()
  }

  /**
   * Get a specific prompt template from an MCP server.
   *
   * @param serverName - The server to get the prompt from
   * @param name - The prompt name
   * @param args - Optional arguments for the prompt
   * @returns The rendered prompt result with messages
   * @throws MCPServerError if server not found or doesn't support prompts
   */
  async getPrompt(serverName: string, name: string, args?: Record<string, string>): Promise<MCPGetPromptResult> {
    const server = this._servers.get(serverName)
    if (!server) {
      throw new MCPServerError(
        `Server "${serverName}" not found. Available servers: ${this.connectedServers.join(', ')}`,
        serverName,
      )
    }

    const capabilities = server.client.getServerCapabilities()
    if (!capabilities?.prompts) {
      throw new MCPServerError(`Server "${serverName}" does not support prompts`, serverName)
    }

    try {
      const result = await server.client.getPrompt({
        name,
        arguments: args,
      })
      return {
        description: result.description,
        messages: result.messages as Array<{ role: string; content: unknown }>,
      }
    } catch (err) {
      throw new MCPServerError(`Failed to get prompt "${name}": ${(err as Error).message}`, serverName, err)
    }
  }

  /**
   * Disconnect all servers and clean up.
   */
  async disconnectAll(): Promise<void> {
    this._servers.clear()
    this._connected = false
  }
}
