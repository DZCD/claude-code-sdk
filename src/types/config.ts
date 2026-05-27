/**
 * ClaudeCode SDK — Configuration Types
 */

import type { PermissionMode, PermissionRule } from './permission.js'
import type { MCPServerConfig } from '../mcp/types.js'

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
}
