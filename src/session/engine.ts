/**
 * ClaudeCode SDK — Session Engine
 *
 * High-level session management. Provides both streaming and
 * non-streaming APIs for interacting with the model through tools.
 * Supports MCP (Model Context Protocol) for connecting to external
 * tool servers.
 *
 * Phase 2-E extensions:
 * - Attribution: message source tracking, turn counting, attribution texts
 * - Persistence: save/load session state to disk
 * - Extended config: maxTurns, timeout, session metadata
 */
import { randomUUID } from 'node:crypto'
import { ConfigManager } from '../config/manager.js'
import { ContextBuilder } from '../context/builder.js'
import { ConversationManager } from '../conversation/manager.js'
import { HookRegistry } from '../hooks/registry.js'
import { createLLMConnector } from '../llm/client.js'
import type { LLMConfig, LLMConnector, StreamEvent, TokenUsage } from '../llm/types.js'
import { MCPServerManager } from '../mcp/manager.js'
import type { MCPConnection, MCPServerConfig } from '../mcp/types.js'
import { PermissionManager } from '../permission/manager.js'
import { ToolRegistry } from '../tools/registry.js'
import type { SDKConfig, SessionConfig } from '../types/config.js'
import type { PermissionMode, PermissionRule } from '../types/permission.js'
import type { Tool, ToolContext, ToolResult } from '../types/tool.js'
import {
  AttributionManager,
  type AttributionMetadata,
  type AttributionMode,
  type AttributionStats,
  type AttributionTexts,
} from './attribution.js'
import { type SessionListEntry, SessionPersistence, type SessionSnapshot } from './persistence.js'

export interface SessionResponse {
  content: string
  usage: TokenUsage
  toolCalls: Array<{
    toolName: string
    input: Record<string, unknown>
    output: unknown
  }>
}

export type { SessionConfig, SessionListEntry }

export class ClaudeCodeSDK {
  private readonly _llm: LLMConnector
  private readonly _tools: ToolRegistry
  private readonly _permissions: PermissionManager
  private readonly _contextBuilder: ContextBuilder
  private readonly _configManager: ConfigManager
  private readonly _systemPrompt: string
  private readonly _mcpManager: MCPServerManager
  private readonly _sessionId: string
  private readonly _attribution: AttributionManager
  private readonly _persistence?: SessionPersistence
  private readonly _hooks: HookRegistry

  private _conversation: ConversationManager
  private _mcpServersInitialized = false
  private _sessionStatus: 'active' | 'paused' | 'completed' | 'archived' = 'active'
  private _turnCount = 0
  private _lastActivityTime = Date.now()

  constructor(config: SDKConfig) {
    this._configManager = new ConfigManager(config)
    this._configManager.mergeFromEnv()

    const resolvedConfig = this._configManager.getConfig()
    const sessionCfg = resolvedConfig.session ?? {}

    this._sessionId = randomUUID()
    this._llm = createLLMConnector(resolvedConfig.llm)
    this._tools = new ToolRegistry()
    this._permissions = new PermissionManager(resolvedConfig.permissionMode, resolvedConfig.permissionRules)
    this._contextBuilder = new ContextBuilder()
    this._mcpManager = new MCPServerManager()
    this._systemPrompt =
      'You are Claude, a helpful AI assistant powered by Anthropic. You have access to a set of tools you can use to help the user.'

    // Phase 2-E: Attribution
    this._attribution = new AttributionManager({
      mode: sessionCfg.attributionMode ?? 'simple',
      modelName: sessionCfg.modelName ?? resolvedConfig.llm.model,
    })

    // Phase 2-E: Persistence (only if storageDir is configured)
    if (sessionCfg.storageDir) {
      this._persistence = new SessionPersistence(sessionCfg.storageDir)
    }

    // Phase 3C: Hook System
    this._hooks = new HookRegistry()

    this._conversation = this._createConversation()
  }

  /** Create a ClaudeCodeSDK instance */
  static create(config: SDKConfig): ClaudeCodeSDK {
    return new ClaudeCodeSDK(config)
  }

  // ─── Tool Registration ─────────────────────────────────

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

  /** Add a hook registry */
  withHooks(hooks: HookRegistry): this {
    // Copy all hooks from the given registry
    for (const { phase, name } of hooks.getSummary()) {
      const handler = hooks.getHooks(phase as any).get(name)
      if (handler) {
        this._hooks.register(phase as any, name, handler as any)
      }
    }
    return this
  }

  // ─── Send / Stream ─────────────────────────────────────

  /** Send a message and get a complete (non-streaming) response */
  async send(message: string): Promise<SessionResponse> {
    await this.initMCPServers()
    this._checkSessionLimits()

    // Record attribution for user message
    this._attribution.recordMessage('user')
    this._turnCount++
    this._lastActivityTime = Date.now()

    const contentParts: string[] = []
    const toolCalls: SessionResponse['toolCalls'] = []
    let finalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 }

    for await (const event of this._conversation.send(message, { hooks: this._hooks })) {
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
          // Record tool usage attribution
          this._attribution.recordMessage('tool', { toolName: event.name })
          break
        case 'done':
          // Record assistant response attribution
          this._attribution.recordMessage('assistant')
          if (event.usage) {
            finalUsage = event.usage
          }
          break
        case 'error':
          // Record assistant error attribution
          this._attribution.recordMessage('assistant')
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
    this._checkSessionLimits()

    // Record attribution for user message
    this._attribution.recordMessage('user')
    this._turnCount++
    this._lastActivityTime = Date.now()

    const conversation = this._conversation
    const attribution = this._attribution
    const iterable = conversation.send(message, { hooks: this._hooks })
    const self = this

    return {
      async *[Symbol.asyncIterator]() {
        await self.initMCPServers()
        for await (const event of iterable) {
          if (event.type === 'tool_use_start') {
            attribution.recordMessage('tool', { toolName: event.name })
          } else if (event.type === 'done') {
            attribution.recordMessage('assistant')
          } else if (event.type === 'error') {
            attribution.recordMessage('assistant')
          }
          yield event
        }
      },
    }
  }

  // ─── Conversation Management ───────────────────────────

  /** Get the conversation history */
  getHistory() {
    return this._conversation.getHistory()
  }

  /** Reset the current conversation */
  resetConversation(): void {
    this._conversation.reset()
    this._attribution.reset()
    this._turnCount = 0
  }

  /** Start a new conversation (same SDK instance) */
  newConversation(): void {
    this._conversation = this._createConversation()
    this._attribution.reset()
    this._turnCount = 0
  }

  /** Get the current token usage */
  getTokenUsage(): TokenUsage {
    return this._conversation.getTokenUsage()
  }

  // ─── Accessor Methods ──────────────────────────────────

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

  /** Get the hook registry */
  getHooks(): HookRegistry {
    return this._hooks
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

  // ─── MCP Server Management ─────────────────────────────

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

  // ─── Phase 2-E: Session Configuration ──────────────────

  /**
   * Get the resolved session configuration.
   */
  getSessionConfig(): SessionConfig {
    const config = this._configManager.getConfig()
    return (
      config.session ?? {
        maxTurns: 0,
        timeout: 0,
        idleTimeout: 0,
        attributionMode: 'simple',
        autoSave: false,
        autoSaveInterval: 60_000,
      }
    )
  }

  /**
   * Get the unique session ID.
   */
  getSessionId(): string {
    return this._sessionId
  }

  /**
   * Get the current session status.
   */
  getSessionStatus(): 'active' | 'paused' | 'completed' | 'archived' {
    return this._sessionStatus
  }

  /**
   * Get the current turn count.
   */
  getTurnCount(): number {
    return this._turnCount
  }

  // ─── Phase 2-E: Attribution ────────────────────────────

  /**
   * Get the attribution manager.
   */
  getAttribution(): AttributionManager {
    return this._attribution
  }

  /**
   * Get attribution texts for commit/PR attribution.
   */
  getAttributionTexts(): AttributionTexts {
    return this._attribution.getAttributionTexts()
  }

  /**
   * Get attribution statistics.
   */
  getAttributionStats(): AttributionStats | undefined {
    return this._attribution.getStats()
  }

  // ─── Phase 2-E: Session Persistence ────────────────────

  /**
   * Save current session state to disk.
   * Returns the session ID used for saving.
   */
  async saveSession(label?: string): Promise<string> {
    if (!this._persistence) {
      throw new Error('Session persistence is not configured. Set session.storageDir in SDKConfig.')
    }

    const config = this._configManager.getConfig()
    const sessionCfg = config.session ?? {}

    const snapshot = this._persistence.buildSnapshot(
      this._conversation.getHistory(),
      this._conversation.getTokenUsage(),
      {
        id: this._sessionId,
        label: label ?? sessionCfg.sessionLabel,
        tags: sessionCfg.sessionTags,
        modelName: sessionCfg.modelName ?? config.llm.model,
        systemPrompt: this._systemPrompt,
      },
    )

    // Attach attribution data
    snapshot.attribution = this._attribution.serialize()

    return await this._persistence.save(snapshot)
  }

  /**
   * Load a saved session and create a new ClaudeCodeSDK with its state.
   * Note: The returned SDK will have the conversation history restored
   * but the LLM connector, tools, and permissions must be reconfigured.
   */
  static async loadSession(
    sessionId: string,
    config: SDKConfig,
  ): Promise<{ sdk: ClaudeCodeSDK; snapshot: SessionSnapshot } | null> {
    // Extract storage directory from config
    const storageDir = config.session?.storageDir
    if (!storageDir) {
      throw new Error('Session persistence requires session.storageDir in SDKConfig.')
    }

    const persistence = new SessionPersistence(storageDir)
    const snapshot = await persistence.load(sessionId)

    if (!snapshot) {
      return null
    }

    // Create SDK instance
    const sdk = new ClaudeCodeSDK(config)

    // Restore messages to conversation
    const messages = persistence.restoreMessages(snapshot)
    for (const msg of messages) {
      sdk._conversation.addMessage(msg)
    }

    // Restore attribution if available
    if (snapshot.attribution) {
      const restoredAttr = AttributionManager.deserialize({
        totalTurns: snapshot.attribution.totalTurns,
        userMessageCount: snapshot.attribution.userMessageCount,
        assistantMessageCount: snapshot.attribution.assistantMessageCount,
        toolCallCount: snapshot.attribution.toolCallCount,
        uniqueTools: snapshot.attribution.uniqueTools,
        startTime: snapshot.createdAt,
        lastActivityTime: snapshot.updatedAt,
        modelName: sdk._attribution._modelName ?? 'Claude',
        mode: config.session?.attributionMode ?? 'simple',
      })
      // Replace the attribution manager
      Object.defineProperty(sdk, '_attribution', { value: restoredAttr })
    }

    return { sdk, snapshot }
  }

  /**
   * List all saved sessions.
   */
  async listSavedSessions(): Promise<SessionListEntry[]> {
    if (!this._persistence) {
      throw new Error('Session persistence is not configured. Set session.storageDir in SDKConfig.')
    }
    return await this._persistence.listSessions()
  }

  /**
   * Delete a saved session.
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    if (!this._persistence) {
      throw new Error('Session persistence is not configured. Set session.storageDir in SDKConfig.')
    }
    return await this._persistence.delete(sessionId)
  }

  // ─── Private Helpers ───────────────────────────────────

  /** Create a new conversation manager */
  private _createConversation(): ConversationManager {
    return new ConversationManager(this._llm, this._tools, this._systemPrompt)
  }

  /**
   * Check session limits before processing a message.
   * Throws if:
   * - Session has reached maxTurns
   * - Session has timed out
   * - Session is paused/completed
   */
  private _checkSessionLimits(): void {
    const config = this._configManager.getConfig().session ?? {}

    // Check session status
    if (this._sessionStatus === 'paused') {
      throw new Error('Session is paused. Resume it before sending messages.')
    }
    if (this._sessionStatus === 'completed' || this._sessionStatus === 'archived') {
      throw new Error(`Session is ${this._sessionStatus}. Start a new conversation to continue.`)
    }

    // Check max turns
    const maxTurns = config.maxTurns ?? 0
    if (maxTurns > 0 && this._turnCount >= maxTurns) {
      throw new Error(`Session has reached maximum turns (${maxTurns}). Start a new conversation.`)
    }

    // Check timeout
    const timeout = config.timeout ?? 0
    if (timeout > 0) {
      const elapsed = Date.now() - this._lastActivityTime
      if (elapsed > timeout) {
        throw new Error(`Session timed out after ${timeout}ms of inactivity.`)
      }
    }
  }
}
