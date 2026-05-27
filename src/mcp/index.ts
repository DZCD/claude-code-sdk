/**
 * ClaudeCode SDK — MCP Module Index
 *
 * Provides MCP (Model Context Protocol) integration for connecting
 * to external tool servers. MCP allows the SDK to discover and use
 * tools from any MCP-compatible server.
 *
 * @module
 */

export { MCPServerManager } from './manager.js'
export { adaptMCPTool } from './tool-adapter.js'
export type {
  MCPServerConfig,
  MCPServerToolConfiguration,
  MCPConnection,
  MCPToolDefinition,
} from './types.js'
export { MCPServerError } from './types.js'
