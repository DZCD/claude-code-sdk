/**
 * ClaudeCode SDK — Config Zod Schemas
 *
 * Defines Zod schemas for runtime configuration validation.
 * Uses Zod .safeParse() for validation (no JSON Schema, no standalone validator).
 */
import { z } from 'zod'

// ========== LLM Config Schemas ==========

const baseLLMConfigSchema = z.object({
  model: z.string().min(1),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
})

const anthropicConfigSchema = baseLLMConfigSchema.extend({
  provider: z.literal('anthropic'),
  apiKey: z.string().min(1),
  baseUrl: z.string().url().optional(),
})

const bedrockConfigSchema = baseLLMConfigSchema.extend({
  provider: z.literal('bedrock'),
  region: z.string().optional(),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
})

const vertexConfigSchema = baseLLMConfigSchema.extend({
  provider: z.literal('vertex'),
  projectId: z.string().min(1),
  region: z.string().optional(),
})

const foundryConfigSchema = baseLLMConfigSchema.extend({
  provider: z.literal('foundry'),
  resourceName: z.string().min(1),
  apiKey: z.string().optional(),
})

const llmConfigSchema = z.discriminatedUnion('provider', [
  anthropicConfigSchema,
  bedrockConfigSchema,
  vertexConfigSchema,
  foundryConfigSchema,
])

// ========== Full SDKConfig Schema ==========

export const sdkConfigSchema = z.object({
  llm: llmConfigSchema,
  permissionMode: z.enum(['auto', 'manual', 'bypass', 'plan']).optional(),
  permissionRules: z.array(z.any()).optional(),
  defaultTools: z.union([z.boolean(), z.array(z.string())]).optional(),
  mcpServers: z.array(z.any()).optional(),
  context: z
    .object({
      includeGitStatus: z.boolean().optional(),
      includeClaudeMd: z.boolean().optional(),
      systemPromptPrefix: z.string().optional(),
      systemPromptSuffix: z.string().optional(),
    })
    .optional(),
  conversation: z
    .object({
      maxTokens: z.number().int().positive().optional(),
      autoCompact: z.boolean().optional(),
    })
    .optional(),
  global: z
    .object({
      timeout: z.number().int().positive().optional(),
      maxRetries: z.number().int().min(0).optional(),
    })
    .optional(),
  session: z
    .object({
      maxTurns: z.number().int().min(0).optional(),
      timeout: z.number().int().min(0).optional(),
      idleTimeout: z.number().int().min(0).optional(),
      attributionMode: z.enum(['off', 'simple', 'detailed']).optional(),
      modelName: z.string().optional(),
      autoSave: z.boolean().optional(),
      autoSaveInterval: z.number().int().positive().optional(),
      storageDir: z.string().optional(),
      sessionLabel: z.string().optional(),
      sessionTags: z.array(z.string()).optional(),
    })
    .optional(),
  rateLimit: z
    .object({
      enabled: z.boolean().optional(),
    })
    .optional(),
})
