/**
 * ClaudeCode SDK - LLM Types
 *
 * Type definitions for the LLM communication layer.
 * Supports multiple providers with a unified streaming interface.
 */
import type { Snowflake } from '../types/message.js'

// ─── Provider Types ──────────────────────────────────────

export type LLMProvider = 'anthropic' | 'bedrock' | 'vertex' | 'foundry'

export interface BaseLLMConfig {
  model: string
  maxTokens?: number
  temperature?: number
  thinkingBudget?: number
}

export interface AnthropicConfig extends BaseLLMConfig {
  provider: 'anthropic'
  apiKey: string
  baseUrl?: string
}

export interface BedrockConfig extends BaseLLMConfig {
  provider: 'bedrock'
  region?: string
  accessKeyId?: string
  secretAccessKey?: string
}

export interface VertexConfig extends BaseLLMConfig {
  provider: 'vertex'
  projectId: string
  region?: string
}

export interface FoundryConfig extends BaseLLMConfig {
  provider: 'foundry'
  resourceName: string
  apiKey?: string
}

export type LLMConfig = AnthropicConfig | BedrockConfig | VertexConfig | FoundryConfig

// ─── Streaming Events ────────────────────────────────────

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
}

export type StreamEvent =
  | { type: 'text'; text: string }
  | {
      type: 'tool_use_start'
      id: Snowflake
      name: string
      input: Record<string, unknown>
    }
  | { type: 'tool_use_end'; id: Snowflake; output: string; isError?: boolean }
  | { type: 'thinking'; thinking: string }
  | { type: 'error'; error: Error }
  | {
      type: 'retry'
      attempt: number
      delayMs: number
      error: string
      status?: number
    }
  | { type: 'done'; usage: TokenUsage }
  | { type: 'ping' }

// ─── Tool Definition (API format) ────────────────────────

export interface ToolDefinition {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties?: Record<string, unknown>
    required?: string[]
    [k: string]: unknown
  }
}

// ─── LLM Connector Interface ─────────────────────────────

export interface LLMConnector {
  readonly provider: LLMProvider

  /** Send messages and get a streaming response */
  send(
    systemPrompt: string | undefined,
    messages: Array<{ role: string; content: string | Record<string, unknown>[] }>,
    tools: ToolDefinition[],
    options?: SendOptions,
  ): AsyncIterable<StreamEvent>

  /** Count tokens in a set of messages */
  countTokens(messages: Array<{ role: string; content: string | Record<string, unknown>[] }>): Promise<number>
}

export interface SendOptions {
  signal?: AbortSignal
  maxTokens?: number
  thinking?: { budgetTokens: number }
  /** Maximum number of retry attempts on transient errors (default: 3) */
  maxRetries?: number
}
