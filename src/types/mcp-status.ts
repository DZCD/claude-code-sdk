/**
 * MCP Server Status Types
 *
 * Expose MCP server connection state — connected, failed, pending, etc.
 * Based on McpServerStatusSchema from coreSchemas.ts.
 */

/**
 * Status values for an MCP server connection.
 */
export type McpServerStatusValue = 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'

/**
 * All valid MCP server status values.
 */
export const MCP_SERVER_STATUS_VALUES: readonly McpServerStatusValue[] = [
  'connected',
  'failed',
  'needs-auth',
  'pending',
  'disabled',
] as const

/**
 * Server info reported when an MCP server is connected.
 */
export interface McpServerInfo {
  /** Server name as reported by the MCP server */
  name: string
  /** Server version as reported by the MCP server */
  version: string
}

/**
 * Tool annotations for MCP tools.
 */
export interface McpToolAnnotations {
  /** Whether this tool is read-only */
  readOnly?: boolean
  /** Whether this tool performs destructive operations */
  destructive?: boolean
  /** Whether this tool may access external resources */
  openWorld?: boolean
}

/**
 * A tool exposed by an MCP server, as reported in status.
 */
export interface McpServerTool {
  /** Tool name */
  name: string
  /** Optional tool description */
  description?: string
  /** Optional tool annotations */
  annotations?: McpToolAnnotations
}

/**
 * Capabilities reported by an MCP server.
 */
export interface McpServerCapabilities {
  /** Experimental capabilities keyed by name */
  experimental?: Record<string, unknown>
}

/**
 * Full status information for a single MCP server connection.
 */
export interface McpServerStatus {
  /** Server name as configured */
  name: string

  /** Current connection status */
  status: McpServerStatusValue

  /** Server information (available when connected) */
  serverInfo?: McpServerInfo

  /** Error message (available when status is 'failed') */
  error?: string

  /** Server configuration as JSON-serializable object */
  config?: Record<string, unknown>

  /** Configuration scope (e.g., project, user, local, claudeai, managed) */
  scope?: string

  /** Tools provided by this server (available when connected) */
  tools?: McpServerTool[]

  /** Server capabilities (available when connected) */
  capabilities?: McpServerCapabilities
}

/**
 * Check if a status value indicates the server is connected.
 */
export function isMcpConnected(status: McpServerStatusValue): boolean {
  return status === 'connected'
}

/**
 * Check if a status value indicates the server has an error.
 */
export function isMcpErrored(status: McpServerStatusValue): boolean {
  return status === 'failed'
}

/**
 * Normalize an unknown input to a valid McpServerStatusValue.
 * Defaults to 'pending'.
 */
export function normalizeMcpServerStatus(value: unknown): McpServerStatusValue {
  if (typeof value === 'string' && (MCP_SERVER_STATUS_VALUES as readonly string[]).includes(value)) {
    return value as McpServerStatusValue
  }
  return 'pending'
}
