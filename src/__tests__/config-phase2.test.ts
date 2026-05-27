import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
/**
 * Tests for ConfigManager Phase 2 features
 *
 * Wave 1: settings.json read/write + multi-source merge
 * Wave 2: validation + change notification
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigManager } from '../config/manager.js'

// Helper: create a temp directory for config file tests
function createTempDir(): string {
  const dir = join(tmpdir(), `config-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('ConfigManager Phase 2 — settings.json Read/Write', () => {
  let tmpDir: string
  let configPath: string

  beforeEach(() => {
    tmpDir = createTempDir()
    configPath = join(tmpDir, 'settings.json')
  })

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  describe('loadFromFile()', () => {
    it('should load config from a valid JSON file', () => {
      writeFileSync(
        configPath,
        JSON.stringify({
          llm: {
            provider: 'anthropic',
            apiKey: 'sk-file-key',
            model: 'claude-haiku-3-5',
          },
          permissionMode: 'manual',
        }),
        'utf-8',
      )

      const cm = new ConfigManager()
      cm.loadFromFile(configPath)
      const config = cm.getConfig()

      expect(config.llm.apiKey).toBe('sk-file-key')
      expect(config.llm.model).toBe('claude-haiku-3-5')
      expect(config.permissionMode).toBe('manual')
    })

    it('should merge file config over defaults but keep non-overridden defaults', () => {
      writeFileSync(
        configPath,
        JSON.stringify({
          permissionMode: 'plan',
        }),
        'utf-8',
      )

      const cm = new ConfigManager()
      cm.loadFromFile(configPath)
      const config = cm.getConfig()

      expect(config.permissionMode).toBe('plan')
      // Defaults preserved
      expect(config.llm.provider).toBe('anthropic')
      expect(config.conversation?.maxTokens).toBe(100000)
      expect(config.global?.timeout).toBe(120000)
    })

    it('should handle empty file gracefully', () => {
      writeFileSync(configPath, '{}', 'utf-8')

      const cm = new ConfigManager()
      cm.loadFromFile(configPath)
      const config = cm.getConfig()

      // All defaults
      expect(config.llm.provider).toBe('anthropic')
      expect(config.permissionMode).toBe('auto')
    })

    it('should throw on non-existent file', () => {
      const cm = new ConfigManager()
      expect(() => cm.loadFromFile('/nonexistent/settings.json')).toThrow()
    })

    it('should throw on invalid JSON', () => {
      writeFileSync(configPath, '{ invalid json }', 'utf-8')

      const cm = new ConfigManager()
      expect(() => cm.loadFromFile(configPath)).toThrow(/JSON|parse|invalid/i)
    })

    it('should merge nested subsections correctly', () => {
      writeFileSync(
        configPath,
        JSON.stringify({
          conversation: { maxTokens: 5000 },
          context: { includeGitStatus: false },
        }),
        'utf-8',
      )

      const cm = new ConfigManager()
      cm.loadFromFile(configPath)
      const config = cm.getConfig()

      expect(config.conversation?.maxTokens).toBe(5000)
      expect(config.conversation?.autoCompact).toBe(true) // default
      expect(config.context?.includeGitStatus).toBe(false)
      expect(config.context?.includeClaudeMd).toBe(true) // default
    })
  })

  describe('saveToFile()', () => {
    it('should save config to a JSON file', () => {
      const cm = new ConfigManager({
        llm: {
          provider: 'anthropic',
          apiKey: 'sk-save-key',
          model: 'test-model',
        },
        permissionMode: 'manual',
      })
      cm.saveToFile(configPath)

      // Read file and verify
      const saved = JSON.parse(require('node:fs').readFileSync(configPath, 'utf-8'))
      expect(saved.llm.apiKey).toBe('sk-save-key')
      expect(saved.permissionMode).toBe('manual')
    })

    it('should filter out default values from saved file (compact save)', () => {
      const cm = new ConfigManager({
        llm: {
          provider: 'anthropic',
          apiKey: 'sk-only-key',
          model: 'claude-sonnet-4-20250514',
        },
      })
      cm.saveToFile(configPath)

      const saved = JSON.parse(require('node:fs').readFileSync(configPath, 'utf-8'))
      // apiKey differs from default (''), so it's saved
      expect(saved.llm.apiKey).toBe('sk-only-key')
      // Default model matches the default, so it's filtered out (compact save)
      expect(saved.llm.model).toBeUndefined()
    })

    it('should create parent directories if they do not exist', () => {
      const deepPath = join(tmpDir, 'nested', 'deep', 'settings.json')

      const cm = new ConfigManager({
        llm: {
          provider: 'anthropic',
          apiKey: 'sk-deep-key',
          model: 'claude-sonnet-4-20250514',
        },
      })
      cm.saveToFile(deepPath)

      expect(existsSync(deepPath)).toBe(true)
      const saved = JSON.parse(require('node:fs').readFileSync(deepPath, 'utf-8'))
      expect(saved.llm.apiKey).toBe('sk-deep-key')
    })

    it('should set file permissions to 0o600', () => {
      const cm = new ConfigManager({
        llm: {
          provider: 'anthropic',
          apiKey: 'sk-perm-key',
          model: 'claude-sonnet-4-20250514',
        },
      })
      cm.saveToFile(configPath)

      const stats = require('node:fs').statSync(configPath)
      // On Unix, check mode is 0o600 (user read+write only)
      if (process.platform !== 'win32') {
        expect(stats.mode & 0o777).toBe(0o600)
      }
    })
  })

  describe('loadFromFile() + update() priority', () => {
    it('should have update() override file config', () => {
      writeFileSync(
        configPath,
        JSON.stringify({
          llm: {
            provider: 'anthropic',
            apiKey: 'sk-file-key',
            model: 'claude-sonnet-4-20250514',
          },
          permissionMode: 'manual',
        }),
        'utf-8',
      )

      const cm = new ConfigManager()
      cm.loadFromFile(configPath)
      cm.update({ permissionMode: 'bypass' })
      const config = cm.getConfig()

      expect(config.llm.apiKey).toBe('sk-file-key') // from file
      expect(config.permissionMode).toBe('bypass') // programmatic overrides
    })

    it('should have file config override env config', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-env-key'
      process.env.CLAUDE_CODE_PERMISSION_MODE = 'manual'

      writeFileSync(
        configPath,
        JSON.stringify({
          permissionMode: 'plan',
        }),
        'utf-8',
      )

      const cm = new ConfigManager()
      cm.mergeFromEnv() // loads env
      cm.loadFromFile(configPath) // file overrides

      // After file load, file values have higher priority than env
      // (because loadFromFile happens after mergeFromEnv)
      const config = cm.getConfig()
      expect(config.permissionMode).toBe('plan') // file overrides env
      expect(config.llm.apiKey).toBe('sk-env-key') // env still present

      process.env.ANTHROPIC_API_KEY = undefined
      process.env.CLAUDE_CODE_PERMISSION_MODE = undefined
    })
  })
})

describe('ConfigManager Phase 2 — Multi-source Merge', () => {
  let tmpDir: string
  let configPath: string

  beforeEach(() => {
    tmpDir = createTempDir()
    configPath = join(tmpDir, 'settings.json')
  })

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  describe('loadFromSources()', () => {
    it('should merge all sources with correct priority: defaults < file < env < cli', () => {
      writeFileSync(
        configPath,
        JSON.stringify({
          llm: {
            provider: 'anthropic',
            apiKey: 'sk-file',
            model: 'file-model',
          },
          permissionMode: 'plan',
          defaultTools: false,
        }),
        'utf-8',
      )

      const cm = new ConfigManager()
      cm.loadFromSources({
        filePath: configPath,
        env: { CLAUDE_CODE_PERMISSION_MODE: 'manual' },
        cliArgs: { permissionMode: 'bypass', defaultTools: true },
      })

      const config = cm.getConfig()
      // CLI arg has highest priority
      expect(config.permissionMode).toBe('bypass')
      expect(config.defaultTools).toBe(true)
      // File config for model (no higher priority override)
      expect(config.llm.model).toBe('file-model')
      expect(config.llm.apiKey).toBe('sk-file')
    })

    it('should accept only file path with no env or CLI', () => {
      writeFileSync(
        configPath,
        JSON.stringify({
          permissionMode: 'manual',
        }),
        'utf-8',
      )

      const cm = new ConfigManager()
      cm.loadFromSources({ filePath: configPath })

      expect(cm.getConfig().permissionMode).toBe('manual')
    })

    it('should accept only env and CLI without file', () => {
      const cm = new ConfigManager()
      cm.loadFromSources({
        env: { ANTHROPIC_API_KEY: 'sk-env-only' },
        cliArgs: { permissionMode: 'bypass' },
      })

      const config = cm.getConfig()
      expect(config.llm.apiKey).toBe('sk-env-only')
      expect(config.permissionMode).toBe('bypass')
    })
  })

  describe('getEffectiveConfig()', () => {
    it('should return the current merged config', () => {
      const cm = new ConfigManager({
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test' },
      })
      const effective = cm.getEffectiveConfig()
      expect(effective.llm.apiKey).toBe('sk-test')
    })

    it('should return a copy not a reference', () => {
      const cm = new ConfigManager()
      const effective = cm.getEffectiveConfig()
      effective.permissionMode = 'bypass'
      expect(cm.getConfig().permissionMode).toBe('auto')
    })
  })
})

describe('ConfigManager Phase 2 — Validation (Wave 2)', () => {
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    originalEnv = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    }
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value !== undefined) {
        process.env[key] = value
      } else {
        delete process.env[key]
      }
    }
  })

  describe('validate()', () => {
    it('should return valid result for a valid config', () => {
      const cm = new ConfigManager({
        llm: {
          provider: 'anthropic',
          apiKey: 'sk-valid',
          model: 'claude-sonnet-4-20250514',
        },
      })
      const result = cm.validate()
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should report missing apiKey for anthropic provider', () => {
      const cm = new ConfigManager({
        llm: { provider: 'anthropic', apiKey: '', model: 'test' },
      })
      const result = cm.validate()
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('apiKey'))).toBe(true)
    })

    it('should report missing projectId for vertex provider', () => {
      const cm = new ConfigManager({
        llm: { provider: 'vertex', model: 'test' } as any,
      })
      const result = cm.validate()
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('projectId'))).toBe(true)
    })

    it('should report invalid provider', () => {
      const cm = new ConfigManager({
        llm: {
          provider: 'invalid-provider',
          apiKey: 'sk-test',
          model: 'test',
        } as any,
      })
      const result = cm.validate()
      expect(result.valid).toBe(false)
    })

    it('should validate with custom schema', () => {
      const cm = new ConfigManager()
      const result = cm.validate({
        required: ['permissionMode'],
        properties: {
          permissionMode: { type: 'string', required: true },
        },
      })
      expect(result.valid).toBe(true)
    })
  })

  describe('validateRequired()', () => {
    it('should return empty array when all required fields present', () => {
      const cm = new ConfigManager({
        llm: { provider: 'anthropic', apiKey: 'sk-ok', model: 'test' },
      })
      expect(cm.validateRequired()).toHaveLength(0)
    })

    it('should return missing apiKey for anthropic', () => {
      const cm = new ConfigManager({
        llm: { provider: 'anthropic', apiKey: '', model: 'test' },
      })
      const missing = cm.validateRequired()
      expect(missing.some((m) => m.includes('apiKey'))).toBe(true)
    })

    it('should return missing projectId for vertex', () => {
      // Delete env vars that might auto-provide projectId
      process.env.ANTHROPIC_VERTEX_PROJECT_ID = undefined
      const cm = new ConfigManager({
        llm: { provider: 'vertex', model: 'test' } as any,
      })
      const missing = cm.validateRequired()
      expect(missing.some((m) => m.includes('projectId'))).toBe(true)
    })
  })
})

describe('ConfigManager Phase 2 — Change Notification (Wave 2)', () => {
  let tmpDir: string
  let configPath: string

  beforeEach(() => {
    tmpDir = createTempDir()
    configPath = join(tmpDir, 'settings.json')
  })

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  describe('onDidChange()', () => {
    it('should fire callback when config is updated', () => {
      const cm = new ConfigManager()
      const callback = vi.fn()
      const unsubscribe = cm.onDidChange(callback)

      cm.update({ permissionMode: 'manual' })

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'permissionMode',
          newValue: 'manual',
        }),
      )
      unsubscribe()
    })

    it('should fire callback when reset is called', () => {
      const cm = new ConfigManager({ permissionMode: 'manual' })
      const callback = vi.fn()
      cm.onDidChange(callback)

      cm.reset()

      expect(callback).toHaveBeenCalled()
    })

    it('should stop firing after unsubscribe', () => {
      const cm = new ConfigManager()
      const callback = vi.fn()
      const unsubscribe = cm.onDidChange(callback)
      unsubscribe()

      cm.update({ permissionMode: 'manual' })
      expect(callback).not.toHaveBeenCalled()
    })

    it('should support multiple listeners', () => {
      const cm = new ConfigManager()
      const cb1 = vi.fn()
      const cb2 = vi.fn()
      cm.onDidChange(cb1)
      cm.onDidChange(cb2)

      cm.update({ permissionMode: 'manual' })

      expect(cb1).toHaveBeenCalledTimes(1)
      expect(cb2).toHaveBeenCalledTimes(1)
    })

    it('should provide old and new values in change event', () => {
      const cm = new ConfigManager({ permissionMode: 'auto' })
      const callback = vi.fn()
      cm.onDidChange(callback)

      cm.update({ permissionMode: 'bypass' })

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'permissionMode',
          oldValue: 'auto',
          newValue: 'bypass',
        }),
      )
    })
  })

  describe('watch()', () => {
    it('should detect external file changes', async () => {
      const cm = new ConfigManager()
      // First, load config from file
      writeFileSync(
        configPath,
        JSON.stringify({
          permissionMode: 'manual',
          llm: { provider: 'anthropic', apiKey: 'sk-file', model: 'test' },
        }),
        'utf-8',
      )
      cm.loadFromFile(configPath)

      const changePromise = new Promise<void>((resolve) => {
        cm.onDidChange((event) => {
          if (event.key === 'permissionMode') {
            resolve()
          }
        })
      })

      // Watch for changes
      cm.watch(configPath)

      // Simulate external change after a short delay
      setTimeout(() => {
        writeFileSync(
          configPath,
          JSON.stringify({
            permissionMode: 'bypass',
            llm: { provider: 'anthropic', apiKey: 'sk-file', model: 'test' },
          }),
          'utf-8',
        )
      }, 100)

      await changePromise
      expect(cm.getConfig().permissionMode).toBe('bypass')

      // Clean up
      cm.unwatch()
    }, 10000)

    it('should reload config on external change', async () => {
      writeFileSync(
        configPath,
        JSON.stringify({
          llm: { provider: 'anthropic', apiKey: 'sk-v1', model: 'v1' },
        }),
        'utf-8',
      )

      const cm = new ConfigManager()
      cm.loadFromFile(configPath)

      const changePromise = new Promise<void>((resolve) => {
        cm.onDidChange(() => {
          resolve()
        })
      })

      cm.watch(configPath)

      // External modification
      setTimeout(() => {
        writeFileSync(
          configPath,
          JSON.stringify({
            llm: { provider: 'anthropic', apiKey: 'sk-v2', model: 'v2' },
          }),
          'utf-8',
        )
      }, 100)

      await changePromise
      expect(cm.getConfig().llm.apiKey).toBe('sk-v2')

      cm.unwatch()
    }, 10000)
  })
})
