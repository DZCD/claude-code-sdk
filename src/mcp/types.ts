/**
 * ClaudeCode SDK — MCP Protocol Types
 *
 * Type definitions for MCP (Model Context Protocol) server configuration
 * and integration with the SDK. Uses @modelcontextprotocol/sdk internally,
 * but exposes simplified configuration types for SDK users.
 */

/**
 * Configuration for connecting to a single MCP server.
 * Supports stdio (local process) and URL-based (remote) servers.
 */
export interface MCPServerConfig {
  /** Unique name for this server connection */
  name: string

  /**
   * Server type.
   * - 'stdio': Launch a local process (e.g., npx, python)
   * - 'url': Connect to a remote HTTP/SSE endpoint
   */
  type: 'stdio' | 'url'

  /**
   * For 'stdio' type: the command to execute (e.g., 'npx', 'python')
   * For 'url' type: the server endpoint URL (e.g., 'https://mcp.example.com')
   */
  commandOrUrl: string

  /** Arguments for stdio command (ignored for URL type) */
  args?: string[]

  /** Environment variables for stdio process (ignored for URL type) */
  env?: Record<string, string>

  /** Authorization token for remote servers (used with 'url' type) */
  authorizationToken?: string

  /** Optional tool configuration — controls which tools are accessible */
  toolConfiguration?: MCPServerToolConfiguration
}

/** Controls which tools from a server are accessible */
export interface MCPServerToolConfiguration {
  /** Whether to enable tools from this server (default: true) */
  enabled?: boolean
  /** List of specific tool names to allow (empty = allow all) */
  allowedTools?: string[]
}

/** Internal representation of a connected MCP server */
export interface MCPConnection {
  serverName: string
  tools: MCPToolDefinition[]
  capabilities: string[]
}

/** MCP tool definition (simplified from MCP protocol) */
export interface MCPToolDefinition {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}

/** Error throw by MCP operations */
export class MCPServerError extends Error {
  constructor(
    message: string,
    public readonly serverName: string,
    public override readonly cause?: unknown,
  ) {
    super(`MCP Server "${serverName}": ${message}`)
    this.name = 'MCPServerError'
  }
}
