/**
 * ClaudeCode SDK — Config Manager
 *
 * Manages SDK configuration from multiple sources:
 * environment variables, config files, and programmatic overrides.
 */
import { existsSync, mkdirSync, readFileSync, statSync, unwatchFile, watchFile, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { LLMConfig, SDKConfig } from '../types/config.js'
import type { PermissionMode, PermissionRule } from '../types/permission.js'

// ========== Phase 2 Types ==========

export interface ConfigSources {
  /** Path to settings.json file */
  filePath?: string
  /** Environment variable overrides (e.g., { ANTHROPIC_API_KEY: 'sk-...' }) */
  env?: Record<string, string>
  /** CLI argument overrides (e.g., { permissionMode: 'bypass' }) */
  cliArgs?: Record<string, unknown>
}

export interface ConfigChangeEvent {
  /** The config key that changed (dot-notation path) */
  key: string
  /** Previous value (undefined if new key) */
  oldValue?: unknown
  /** New value */
  newValue?: unknown
}

export type ConfigChangeCallback = (event: ConfigChangeEvent) => void

export interface ConfigSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  required?: boolean
  default?: unknown
  enum?: string[]
}

export interface ConfigSchema {
  required?: string[]
  properties?: Record<string, ConfigSchemaProperty>
}

export interface ConfigValidationResult {
  valid: boolean
  errors: string[]
  warnings?: string[]
}

const VALID_PROVIDERS = ['anthropic', 'bedrock', 'vertex', 'foundry'] as const
const VALID_PERMISSION_MODES = ['auto', 'manual', 'bypass', 'plan'] as const

// ========== Defaults ==========

const DEFAULT_CONFIG: SDKConfig = {
  llm: {
    provider: 'anthropic',
    apiKey: '',
    model: 'claude-sonnet-4-20250514',
  },
  permissionMode: 'auto',
  permissionRules: [],
  defaultTools: true,
  context: {
    includeGitStatus: true,
    includeClaudeMd: true,
  },
  conversation: {
    maxTokens: 100_000,
    autoCompact: true,
  },
  global: {
    timeout: 120_000,
    maxRetries: 3,
  },
}

export class ConfigManager {
  private _config: SDKConfig
  private _listeners: Set<ConfigChangeCallback> = new Set()
  private _watchedPath: string | null = null
  private _prevFileMtime = 0

  constructor(config?: Partial<SDKConfig>) {
    this._config = this._applyDefaults(config ?? {})
  }

  /** Get the full configuration (returns a copy) */
  getConfig(): SDKConfig {
    return { ...this._config }
  }

  /** Get the LLM configuration */
  getLLMConfig(): LLMConfig {
    return { ...this._config.llm }
  }

  /** Update the configuration (deep merge), triggers change notifications */
  update(partial: Partial<SDKConfig>): void {
    const oldConfig = { ...this._config }
    this._config = this._merge(this._config, partial)
    this._emitChanges(oldConfig, this._config)
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
    const oldConfig = { ...this._config }
    this._config = this._applyDefaults({})
    this._emitChanges(oldConfig, this._config)
  }

  // ========== Phase 2: settings.json Read/Write ==========

  /**
   * Load configuration from a JSON file.
   * Merges file values into the current config.
   */
  loadFromFile(path: string): void {
    const oldConfig = { ...this._config }
    const content = readFileSync(path, { encoding: 'utf-8' })
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(content) as Record<string, unknown>
    } catch (err) {
      throw new Error(`Config file parse error at ${path}: ${(err as Error).message}`)
    }
    this._config = this._merge(this._config, parsed as Partial<SDKConfig>)
    this._prevFileMtime = Date.now()
    this._emitChanges(oldConfig, this._config)
  }

  /**
   * Save configuration to a JSON file.
   * Creates parent directories if needed. Uses compact storage (filters defaults).
   * Sets file permissions to 0o600.
   */
  saveToFile(path: string): void {
    const dir = dirname(path)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    // Filter out values that match defaults (compact storage)
    const result = this._filterDefaults(this._config)
    const content = JSON.stringify(result, null, 2)

    writeFileSync(path, content, { encoding: 'utf-8', mode: 0o600 })
  }

  // ========== Phase 2: Multi-source Merge ==========

  /**
   * Load configuration from multiple sources with priority:
   * defaults < file < environment < CLI args
   */
  loadFromSources(sources: ConfigSources): void {
    const oldConfig = { ...this._config }

    // 1. Start with current (already has defaults applied)
    let merged = { ...this._config }

    // 2. File config (overrides defaults)
    if (sources.filePath) {
      const content = readFileSync(sources.filePath, { encoding: 'utf-8' })
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(content) as Record<string, unknown>
      } catch (err) {
        throw new Error(`Config file parse error at ${sources.filePath}: ${(err as Error).message}`)
      }
      merged = this._merge(merged, parsed as Partial<SDKConfig>)
    }

    // 3. Environment variables (overrides file)
    if (sources.env && Object.keys(sources.env).length > 0) {
      const envPartial = this._parseEnvRecord(sources.env)
      merged = this._merge(merged, envPartial)
    }

    // 4. CLI args (highest priority)
    if (sources.cliArgs && Object.keys(sources.cliArgs).length > 0) {
      merged = this._merge(merged, sources.cliArgs as Partial<SDKConfig>)
    }

    this._config = merged
    this._emitChanges(oldConfig, this._config)
  }

  /**
   * Get the current effective merged configuration (copy).
   */
  getEffectiveConfig(): SDKConfig {
    return { ...this._config }
  }

  // ========== Phase 2: Validation ==========

  /**
   * Validate the current configuration.
   * Checks structure, required fields, type correctness, and enum validity.
   */
  validate(schema?: ConfigSchema): ConfigValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    if (schema) {
      // Custom schema validation
      if (schema.required) {
        for (const key of schema.required) {
          const value = this._getNestedValue(this._config, key)
          if (value === undefined || value === null || value === '') {
            errors.push(`Missing required field: ${key}`)
          }
        }
      }
      if (schema.properties) {
        for (const [key, prop] of Object.entries(schema.properties)) {
          const value = this._getNestedValue(this._config, key)
          if (prop.required && (value === undefined || value === null || value === '')) {
            errors.push(`Missing required field: ${key}`)
          }
          if (value !== undefined && prop.type) {
            if (prop.type === 'array' && !Array.isArray(value)) {
              errors.push(`Field ${key} should be an array`)
            } else if (prop.type !== 'array' && typeof value !== prop.type) {
              errors.push(`Field ${key} should be of type ${prop.type}, got ${typeof value}`)
            }
          }
          if (prop.enum && value !== undefined && !prop.enum.includes(value as string)) {
            errors.push(`Field ${key} should be one of: ${prop.enum.join(', ')}, got ${value}`)
          }
        }
      }
    } else {
      // Default validation
      const config = this._config

      // Check provider validity
      if (!VALID_PROVIDERS.includes(config.llm.provider as (typeof VALID_PROVIDERS)[number])) {
        errors.push(`Invalid LLM provider: ${config.llm.provider}. Must be one of: ${VALID_PROVIDERS.join(', ')}`)
      }

      // Check provider-specific required fields
      switch (config.llm.provider) {
        case 'anthropic':
          if (!config.llm.apiKey) {
            errors.push('Missing required field: llm.apiKey (required for anthropic provider)')
          }
          break
        case 'vertex':
          if (!('projectId' in config.llm) || !(config.llm as any).projectId) {
            errors.push('Missing required field: llm.projectId (required for vertex provider)')
          }
          break
        case 'bedrock':
          if (!('accessKeyId' in config.llm) || !(config.llm as any).accessKeyId) {
            warnings.push('Recommended field: llm.accessKeyId (bedrock provider may need AWS credentials)')
          }
          break
        case 'foundry':
          if (!('resourceName' in config.llm) || !(config.llm as any).resourceName) {
            errors.push('Missing required field: llm.resourceName (required for foundry provider)')
          }
          break
      }

      // Check permission mode
      if (
        config.permissionMode &&
        !VALID_PERMISSION_MODES.includes(config.permissionMode as (typeof VALID_PERMISSION_MODES)[number])
      ) {
        errors.push(
          `Invalid permissionMode: ${config.permissionMode}. Must be one of: ${VALID_PERMISSION_MODES.join(', ')}`,
        )
      }

      // Check model is specified
      if (!config.llm.model) {
        errors.push('Missing required field: llm.model')
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: warnings.length > 0 ? warnings : undefined,
    }
  }

  /**
   * Returns a list of missing required field names.
   */
  validateRequired(): string[] {
    const result = this.validate()
    return result.errors.map((e) => {
      // Extract field name from patterns like:
      // "Missing required field: llm.apiKey (required for ...)"
      // "Invalid LLM provider: ..."
      const fieldMatch = e.match(/field:\s*([\w.]+)/i)
      if (fieldMatch) return fieldMatch[1]!
      // Fallback: extract first meaningful word
      const wordMatch = e.match(/([\w.]+)/)
      return wordMatch ? wordMatch[1]! : e
    })
  }

  // ========== Phase 2: Change Notification ==========

  /**
   * Register a callback for config changes.
   * Returns an unsubscribe function.
   */
  onDidChange(callback: ConfigChangeCallback): () => void {
    this._listeners.add(callback)
    return () => {
      this._listeners.delete(callback)
    }
  }

  /**
   * Watch a config file for external changes.
   * When the file changes, it's automatically reloaded.
   */
  watch(path: string): void {
    this.unwatch()
    this._watchedPath = path

    try {
      const stats = statSync(path)
      this._prevFileMtime = stats.mtimeMs
    } catch {
      this._prevFileMtime = 0
    }

    watchFile(path, { interval: 1000, persistent: false }, (curr) => {
      if (curr.mtimeMs <= this._prevFileMtime) return
      try {
        const oldConfig = { ...this._config }
        const content = readFileSync(path, { encoding: 'utf-8' })
        const parsed = JSON.parse(content) as Record<string, unknown>
        this._config = this._merge(this._config, parsed as Partial<SDKConfig>)
        this._prevFileMtime = curr.mtimeMs
        this._emitChanges(oldConfig, this._config)
      } catch {
        // Silently ignore parse errors during watch
      }
    })
  }

  /**
   * Stop watching the config file.
   */
  unwatch(): void {
    if (this._watchedPath) {
      try {
        unwatchFile(this._watchedPath)
      } catch {
        /* ignore */
      }
      this._watchedPath = null
    }
  }

  // ========== Private Methods ==========

  /**
   * Emit change events for all changed keys between old and new config.
   */
  private _emitChanges(oldConfig: SDKConfig, newConfig: SDKConfig): void {
    if (this._listeners.size === 0) return

    const changedKeys = this._findChangedKeys(oldConfig, newConfig)
    for (const key of changedKeys) {
      const oldValue = this._getNestedValue(oldConfig, key)
      const newValue = this._getNestedValue(newConfig, key)
      const event: ConfigChangeEvent = { key, oldValue, newValue }
      for (const listener of this._listeners) {
        try {
          listener(event)
        } catch {
          // Don't let a listener crash the notification
        }
      }
    }
  }

  /**
   * Find all top-level keys that changed between two configs.
   */
  private _findChangedKeys(oldConfig: SDKConfig, newConfig: SDKConfig): string[] {
    const keys = new Set([...Object.keys(oldConfig), ...Object.keys(newConfig)])
    const changed: string[] = []
    for (const key of keys) {
      const oldVal = (oldConfig as unknown as Record<string, unknown>)[key]
      const newVal = (newConfig as unknown as Record<string, unknown>)[key]
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changed.push(key)
      }
    }
    return changed
  }

  /**
   * Get a nested value by dot-notation path.
   */
  private _getNestedValue(obj: unknown, path: string): unknown {
    const parts = path.split('.')
    let current: unknown = obj
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined
      }
      current = (current as Record<string, unknown>)[part]
    }
    return current
  }

  /**
   * Parse an env record into a Partial<SDKConfig>.
   */
  private _parseEnvRecord(env: Record<string, string>): Partial<SDKConfig> {
    const result: Partial<SDKConfig> = {}

    if (env.ANTHROPIC_API_KEY) {
      result.llm = {
        provider: 'anthropic',
        apiKey: env.ANTHROPIC_API_KEY,
        model: env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514',
      }
      if (env.ANTHROPIC_BASE_URL) {
        ;(result.llm as { baseUrl?: string }).baseUrl = env.ANTHROPIC_BASE_URL
      }
    }

    if (env.CLAUDE_CODE_PERMISSION_MODE) {
      result.permissionMode = env.CLAUDE_CODE_PERMISSION_MODE as PermissionMode
    }

    return result
  }

  /**
   * Filter config to only include values that differ from defaults.
   */
  private _filterDefaults(config: SDKConfig): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    const defaults = DEFAULT_CONFIG as unknown as Record<string, unknown>
    const configRecord = config as unknown as Record<string, unknown>

    for (const key of Object.keys(configRecord)) {
      const val = configRecord[key]
      const defaultVal = defaults[key]
      // Include if different from default
      if (JSON.stringify(val) !== JSON.stringify(defaultVal)) {
        // For nested objects, filter their children too
        if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
          const filtered = this._filterNested(
            val as Record<string, unknown>,
            defaultVal as Record<string, unknown> | undefined,
          )
          if (Object.keys(filtered).length > 0) {
            result[key] = filtered
          }
        } else {
          result[key] = val
        }
      }
    }

    return result
  }

  /**
   * Filter nested object, keeping only values that differ from defaults.
   */
  private _filterNested(obj: Record<string, unknown>, defaults?: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(obj)) {
      const val = obj[key]
      const defaultVal = defaults?.[key]
      if (JSON.stringify(val) !== JSON.stringify(defaultVal)) {
        if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
          const filtered = this._filterNested(
            val as Record<string, unknown>,
            defaultVal as Record<string, unknown> | undefined,
          )
          if (Object.keys(filtered).length > 0) {
            result[key] = filtered
          }
        } else {
          result[key] = val
        }
      }
    }
    return result
  }

  /** Apply defaults to a partial config */
  private _applyDefaults(config: Partial<SDKConfig>): SDKConfig {
    return {
      llm: config.llm ?? { ...DEFAULT_CONFIG.llm },
      permissionMode: config.permissionMode ?? DEFAULT_CONFIG.permissionMode,
      permissionRules: config.permissionRules ?? [],
      defaultTools: config.defaultTools ?? true,
      context: {
        includeGitStatus: config.context?.includeGitStatus ?? true,
        includeClaudeMd: config.context?.includeClaudeMd ?? true,
        ...config.context,
      },
      conversation: {
        maxTokens: config.conversation?.maxTokens ?? DEFAULT_CONFIG.conversation?.maxTokens ?? 4096,
        autoCompact: config.conversation?.autoCompact ?? DEFAULT_CONFIG.conversation?.autoCompact ?? true,
        ...config.conversation,
      },
      global: {
        timeout: config.global?.timeout ?? DEFAULT_CONFIG.global?.timeout ?? 30000,
        maxRetries: config.global?.maxRetries ?? DEFAULT_CONFIG.global?.maxRetries ?? 3,
        ...config.global,
      },
      session: config.session ? { ...config.session } : undefined,
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
      session: override.session ? { ...base.session, ...override.session } : base.session,
    }
  }
}
