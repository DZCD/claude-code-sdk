/**
 * ClaudeCode SDK - Standalone TypeScript SDK for Claude Code
 *
 * This SDK provides the core capabilities of Claude Code (LLM communication,
 * tool system, conversation management, file operations, etc.) as a standalone
 * library that does NOT depend on the Claude Code runtime.
 *
 * @module claude-code-sdk
 */

export const VERSION = '0.1.0'

// Session Engine (main entry point)
export { ClaudeCodeSDK, AttributionManager, SessionPersistence } from './session/index.js'
export type {
  SessionResponse,
  SessionConfig,
  SessionListEntry,
  MessageSource,
  AttributionMode,
  AttributionMetadata,
  AttributionStats,
  AttributionTexts,
  AttributionSnapshot,
  SessionSnapshot,
  SessionMetadata,
  SessionStatus,
  InterruptionResult,
  SerializedMessage,
} from './session/index.js'

// Tool System
export { BaseTool, createTool, ToolRegistry } from './tools/index.js'
export type { Tool, ToolResult, ToolContext, ToolDefinition, ToolCallRecord, AnyZodObject } from './types/tool.js'

// LLM Layer
export { createLLMConnector, AnthropicConnector, BedrockConnector, VertexConnector, FoundryConnector, getSupportedProviders } from './llm/index.js'
export type {
  LLMConfig,
  AnthropicConfig,
  BedrockConfig,
  VertexConfig,
  FoundryConfig,
  LLMConnector,
  LLMProvider,
  StreamEvent,
  TokenUsage,
  SendOptions,
} from './llm/index.js'

// Conversation
export { ConversationManager, conversationLoop, CircularBuffer, TokenTracker, TokenBudget, MicroCompactor, AutoCompactor, getTokenUsageFromMessage, getTotalTokensFromUsage, estimateContextTokens, parseTokenBudget, getBudgetContinuationMessage } from './conversation/index.js'
export type { LoopOptions, CompactOptions, CompactResult, MicroCompactOptions, SummaryLLM } from './conversation/index.js'

// Context Building
export { ContextBuilder, findGitRoot, getGitState, getFileStatus, getBranch, getHead, getRemoteUrl, fetchGitDiff, MemoryFileLoader } from './context/index.js'
export type { ContextOptions, GitRepoState, FileStatusResult, GitDiffResult, GitDiffStats, PerFileStats, MemoryFileInfo, MemoryType } from './context/index.js'

// Permission System
export { PermissionManager } from './permission/index.js'

// Config Management
export { ConfigManager } from './config/index.js'

// MCP Protocol
export { MCPServerManager } from './mcp/index.js'
export type {
  MCPServerConfig,
  MCPServerToolConfiguration,
  MCPConnection,
  MCPToolDefinition,
} from './mcp/index.js'

// Core Types
export type {
  Message,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  SystemMessage,
  ContentBlock,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  ThinkingBlock,
  Snowflake,
} from './types/message.js'

export type {
  PermissionMode,
  PermissionRequest,
  PermissionDecision,
  PermissionResult,
  PermissionRule,
} from './types/permission.js'

export type { SDKConfig } from './types/config.js'
