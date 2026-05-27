/**
 * ClaudeCode SDK — Session Engine
 *
 * High-level session management. Provides both streaming and
 * non-streaming APIs for interacting with the model through tools.
 * Supports MCP (Model Context Protocol) for connecting to external
 * tool servers.
 */
import type { SDKConfig } from '../types/config.js'
import type { LLMConfig, LLMConnector, StreamEvent, TokenUsage } from '../llm/types.js'
import type { Tool, ToolResult, ToolContext } from '../types/tool.js'
import type { PermissionMode, PermissionRule } from '../types/permission.js'
import type { MCPServerConfig, MCPConnection } from '../mcp/types.js'
import { createLLMConnector } from '../llm/client.js'
import { ToolRegistry } from '../tools/registry.js'
import { ConversationManager } from '../conversation/manager.js'
import { PermissionManager } from '../permission/manager.js'
import { ContextBuilder } from '../context/builder.js'
import { ConfigManager } from '../config/manager.js'
import { MCPServerManager } from '../mcp/manager.js'

export interface SessionResponse {
  content: string
  usage: TokenUsage
  toolCalls: Array<{
    toolName: string
    input: Record<string, unknown>
    output: unknown
  }>
}

export class ClaudeCodeSDK {
  private readonly _llm: LLMConnector
  private readonly _tools: ToolRegistry
  private readonly _permissions: PermissionManager
  private readonly _contextBuilder: ContextBuilder
  private readonly _configManager: ConfigManager
  private readonly _systemPrompt: string
  private readonly _mcpManager: MCPServerManager
  private _conversation: ConversationManager
  private _mcpServersInitialized = false

  constructor(config: SDKConfig) {
    this._configManager = new ConfigManager(config)
    this._configManager.mergeFromEnv()

    const resolvedConfig = this._configManager.getConfig()

    this._llm = createLLMConnector(resolvedConfig.llm)
    this._tools = new ToolRegistry()
    this._permissions = new PermissionManager(
      resolvedConfig.permissionMode,
      resolvedConfig.permissionRules,
    )
    this._contextBuilder = new ContextBuilder()
    this._mcpManager = new MCPServerManager()
    this._systemPrompt = 'You are Claude, a helpful AI assistant powered by Anthropic. You have access to a set of tools you can use to help the user.'
    this._conversation = this._createConversation()
  }

  /** Create a ClaudeCodeSDK instance */
  static create(config: SDKConfig): ClaudeCodeSDK {
    return new ClaudeCodeSDK(config)
  }

  /** Register one or more tools */
  use(...tools: Tool[]): this {
    this._tools.register(...tools)
    return this
  }

  /** Set the permission mode */
  withPermissionMode(mode: PermissionMode): this {
    this._permissions.setMode(mode)
    return this
  }

  /** Add permission rules */
  withPermissionRules(rules: PermissionRule[]): this {
    this._permissions.addRules(rules)
    return this
  }

  /** Send a message and get a complete (non-streaming) response */
  async send(message: string): Promise<SessionResponse> {
    await this.initMCPServers()
    const contentParts: string[] = []
    const toolCalls: SessionResponse['toolCalls'] = []
    let finalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 }

    for await (const event of this._conversation.send(message)) {
      switch (event.type) {
        case 'text':
          contentParts.push(event.text)
          break
        case 'tool_use_start':
          toolCalls.push({
            toolName: event.name,
            input: event.input,
            output: undefined,
          })
          break
        case 'done':
          if (event.usage) {
            finalUsage = event.usage
          }
          break
        case 'error':
          throw event.error
      }
    }

    return {
      content: contentParts.join(''),
      usage: finalUsage,
      toolCalls,
    }
  }

  /** Send a message and stream the events */
  stream(message: string): AsyncIterable<StreamEvent> {
    const iterable = this._conversation.send(message)
    const self = this
    return {
      async *[Symbol.asyncIterator]() {
        await self.initMCPServers()
        yield* iterable
      },
    }
  }

  /** Get the conversation history */
  getHistory() {
    return this._conversation.getHistory()
  }

  /** Reset the current conversation */
  resetConversation(): void {
    this._conversation.reset()
  }

  /** Start a new conversation (same SDK instance) */
  newConversation(): void {
    this._conversation = this._createConversation()
  }

  /** Get the current token usage */
  getTokenUsage(): TokenUsage {
    return this._conversation.getTokenUsage()
  }

  /** Get the underlying tool registry */
  getTools(): ToolRegistry {
    return this._tools
  }

  /** Get the permission manager */
  getPermissions(): PermissionManager {
    return this._permissions
  }

  /** Get the config manager */
  getConfig(): ConfigManager {
    return this._configManager
  }

  /** Get the LLM connector */
  getLLM(): LLMConnector {
    return this._llm
  }

  /** Get the MCP server manager */
  getMCPServerManager(): MCPServerManager {
    return this._mcpManager
  }

  /** Get MCP connection info */
  getMCPConnections(): MCPConnection[] {
    return this._mcpManager.getConnectionInfo()
  }

  /** Check if MCP servers are connected */
  isMCPConnected(): boolean {
    return this._mcpManager.isConnected
  }

  /**
   * Initialize MCP servers from configuration.
   * Called automatically on first send/stream if not called manually.
   */
  async initMCPServers(): Promise<void> {
    if (this._mcpServersInitialized) return
    this._mcpServersInitialized = true

    const config = this._configManager.getConfig()
    const mcpServers = config.mcpServers

    if (!mcpServers || mcpServers.length === 0) return

    await this._mcpManager.connectAll(mcpServers)
    const count = this._mcpManager.registerAllTools(this._tools)
    if (count > 0) {
      this._conversation = this._createConversation()
    }
  }

  /**
   * Explicitly connect to MCP servers programmatically.
   * Can be called before send/stream or in addition to config-based servers.
   */
  async connectMCPServers(...servers: MCPServerConfig[]): Promise<void> {
    await this._mcpManager.connectAll(servers)
    const count = this._mcpManager.registerAllTools(this._tools)
    if (count > 0) {
      this._conversation = this._createConversation()
    }
  }

  /**
   * Disconnect all MCP servers.
   */
  async disconnectMCPServers(): Promise<void> {
    await this._mcpManager.disconnectAll()
    this._mcpServersInitialized = false
  }

  /** Create a new conversation manager */
  private _createConversation(): ConversationManager {
    return new ConversationManager(
      this._llm,
      this._tools,
      this._systemPrompt,
    )
  }
}
