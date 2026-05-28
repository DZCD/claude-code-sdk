/**
 * ClaudeCode SDK — Configuration Types
 */

import type { MCPServerConfig } from '../mcp/types.js'
import type { AttributionMode } from '../session/attribution.js'
import type { PermissionMode, PermissionRule } from './permission.js'

export type LLMProvider = 'anthropic' | 'bedrock' | 'vertex' | 'foundry'

export interface BaseLLMConfig {
  model: string
  maxTokens?: number
  temperature?: number
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

/** Session configuration options */
export interface SessionConfig {
  /** Maximum conversation turns (0 = unlimited) */
  maxTurns?: number
  /** Session timeout in ms (0 = no timeout) */
  timeout?: number
  /** Idle timeout in ms (0 = no timeout) */
  idleTimeout?: number
  /** Attribution mode */
  attributionMode?: AttributionMode
  /** Model name for attribution */
  modelName?: string
  /** Auto-save session state */
  autoSave?: boolean
  /** Auto-save interval in ms */
  autoSaveInterval?: number
  /** Storage directory for session persistence */
  storageDir?: string
  /** Session label */
  sessionLabel?: string
  /** Session tags */
  sessionTags?: string[]
}

export interface SDKConfig {
  llm: LLMConfig
  permissionMode?: PermissionMode
  permissionRules?: PermissionRule[]
  defaultTools?: boolean | string[]
  mcpServers?: MCPServerConfig[]
  context?: {
    includeGitStatus?: boolean
    includeClaudeMd?: boolean
    systemPromptPrefix?: string
    systemPromptSuffix?: string
  }
  conversation?: {
    maxTokens?: number
    autoCompact?: boolean
  }
  global?: {
    timeout?: number
    maxRetries?: number
  }
  /** Phase 2-E: Session configuration options */
  session?: SessionConfig
  /** Phase 3D: Rate limiting configuration */
  rateLimit?: {
    enabled?: boolean
  }
}
