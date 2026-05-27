/**
 * ClaudeCode SDK — Standalone TypeScript SDK for Claude Code
 *
 * This SDK provides the core capabilities of Claude Code (LLM communication,
 * tool system, conversation management, file operations, etc.) as a standalone
 * library that does NOT depend on the Claude Code runtime.
 *
 * @public
 */

export const VERSION = "0.2.0";

// Config Management
export { ConfigManager } from "./config/index.js";
export type {
	ContextOptions,
	FileStatusResult,
	GitDiffResult,
	GitDiffStats,
	GitRepoState,
	MemoryFileInfo,
	MemoryType,
	PerFileStats,
} from "./context/index.js";
// Context Building
export {
	ContextBuilder,
	fetchGitDiff,
	findGitRoot,
	getBranch,
	getFileStatus,
	getGitState,
	getHead,
	getRemoteUrl,
	MemoryFileLoader,
} from "./context/index.js";
export type {
	CompactOptions,
	CompactResult,
	LoopOptions,
	MicroCompactOptions,
	SummaryLLM,
} from "./conversation/index.js";
// Conversation
export {
	AutoCompactor,
	CircularBuffer,
	ConversationManager,
	conversationLoop,
	estimateContextTokens,
	getBudgetContinuationMessage,
	getTokenUsageFromMessage,
	getTotalTokensFromUsage,
	MicroCompactor,
	parseTokenBudget,
	TokenBudget,
	TokenTracker,
} from "./conversation/index.js";
export type {
	AnthropicConfig,
	BedrockConfig,
	FoundryConfig,
	LLMConfig,
	LLMConnector,
	LLMProvider,
	SendOptions,
	StreamEvent,
	TokenUsage,
	VertexConfig,
} from "./llm/index.js";
// LLM Layer
export {
	AnthropicConnector,
	BedrockConnector,
	createLLMConnector,
	FoundryConnector,
	getSupportedProviders,
	VertexConnector,
} from "./llm/index.js";
export type {
	MCPConnection,
	MCPServerConfig,
	MCPServerToolConfiguration,
	MCPToolDefinition,
} from "./mcp/index.js";
// MCP Protocol
export { MCPServerManager } from "./mcp/index.js";
// Permission System
export { PermissionManager } from "./permission/index.js";
export type {
	AttributionMetadata,
	AttributionMode,
	AttributionSnapshot,
	AttributionStats,
	AttributionTexts,
	InterruptionResult,
	MessageSource,
	SerializedMessage,
	SessionConfig,
	SessionListEntry,
	SessionMetadata,
	SessionResponse,
	SessionSnapshot,
	SessionStatus,
} from "./session/index.js";
// Session Engine (main entry point)
export {
	AttributionManager,
	ClaudeCodeSDK,
	SessionPersistence,
} from "./session/index.js";
// Tool System
export { BaseTool, createTool, ToolRegistry } from "./tools/index.js";
export type { SDKConfig } from "./types/config.js";

// Core Types
export type {
	AssistantMessage,
	ContentBlock,
	Message,
	Snowflake,
	SystemMessage,
	TextBlock,
	ThinkingBlock,
	ToolResultBlock,
	ToolResultMessage,
	ToolUseBlock,
	UserMessage,
} from "./types/message.js";

export type {
	PermissionDecision,
	PermissionMode,
	PermissionRequest,
	PermissionResult,
	PermissionRule,
} from "./types/permission.js";
export type {
	AnyZodObject,
	Tool,
	ToolCallRecord,
	ToolContext,
	ToolDefinition,
	ToolResult,
} from "./types/tool.js";
