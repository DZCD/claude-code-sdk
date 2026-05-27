/**
 * ClaudeCode SDK — Config Manager
 *
 * Manages SDK configuration from multiple sources:
 * environment variables, config files, and programmatic overrides.
 */
import type { SDKConfig, LLMConfig } from '../types/config.js'
import type { PermissionMode, PermissionRule } from '../types/permission.js'

export class ConfigManager {
  private _config: SDKConfig

  constructor(config?: Partial<SDKConfig>) {
    this._config = this._applyDefaults(config ?? {})
  }

  /** Get the full configuration */
  getConfig(): SDKConfig {
    return { ...this._config }
  }

  /** Get the LLM configuration */
  getLLMConfig(): LLMConfig {
    return { ...this._config.llm }
  }

  /** Update the configuration (deep merge) */
  update(partial: Partial<SDKConfig>): void {
    this._config = this._merge(this._config, partial)
  }

  /** Load configuration from environment variables */
  loadFromEnv(): Partial<SDKConfig> {
    const env: Partial<SDKConfig> = {}

    if (process.env.ANTHROPIC_API_KEY) {
      env.llm = {
        provider: 'anthropic',
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514',
      }
    }

    if (process.env.ANTHROPIC_BASE_URL) {
      if (env.llm?.provider === 'anthropic') {
        ;(env.llm as { baseUrl?: string }).baseUrl = process.env.ANTHROPIC_BASE_URL
      }
    }

    // AWS Bedrock
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      env.llm = {
        provider: 'bedrock',
        model: process.env.ANTHROPIC_MODEL ?? 'anthropic.claude-sonnet-4-20250514',
        region: process.env.AWS_REGION ?? 'us-east-1',
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    }

    // Vertex AI
    if (process.env.ANTHROPIC_VERTEX_PROJECT_ID) {
      env.llm = {
        provider: 'vertex',
        projectId: process.env.ANTHROPIC_VERTEX_PROJECT_ID,
        model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514',
        region: process.env.CLOUD_ML_REGION ?? 'us-east5',
      }
    }

    // Permission mode
    if (process.env.CLAUDE_CODE_PERMISSION_MODE) {
      env.permissionMode = process.env.CLAUDE_CODE_PERMISSION_MODE as PermissionMode
    }

    return env
  }

  /** Merge environment variables into current config */
  mergeFromEnv(): void {
    const envConfig = this.loadFromEnv()
    this._config = this._merge(this._config, envConfig)
  }

  /** Reset to defaults */
  reset(): void {
    this._config = this._applyDefaults({})
  }

  /** Apply defaults to a partial config */
  private _applyDefaults(config: Partial<SDKConfig>): SDKConfig {
    return {
      llm: config.llm ?? {
        provider: 'anthropic',
        apiKey: '',
        model: 'claude-sonnet-4-20250514',
      },
      permissionMode: config.permissionMode ?? 'auto',
      permissionRules: config.permissionRules ?? [],
      defaultTools: config.defaultTools ?? true,
      context: {
        includeGitStatus: config.context?.includeGitStatus ?? true,
        includeClaudeMd: config.context?.includeClaudeMd ?? true,
        ...config.context,
      },
      conversation: {
        maxTokens: config.conversation?.maxTokens ?? 100_000,
        autoCompact: config.conversation?.autoCompact ?? true,
        ...config.conversation,
      },
      global: {
        timeout: config.global?.timeout ?? 120_000,
        maxRetries: config.global?.maxRetries ?? 3,
        ...config.global,
      },
    }
  }

  /** Deep merge two config objects */
  private _merge(base: SDKConfig, override: Partial<SDKConfig>): SDKConfig {
    return {
      ...base,
      ...override,
      llm: override.llm ?? base.llm,
      permissionMode: override.permissionMode ?? base.permissionMode,
      permissionRules: override.permissionRules ?? base.permissionRules,
      defaultTools: override.defaultTools ?? base.defaultTools,
      context: { ...base.context, ...override.context },
      conversation: { ...base.conversation, ...override.conversation },
      global: { ...base.global, ...override.global },
    }
  }
}
