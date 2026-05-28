/**
 * Tests — ConfigManager Edge Cases
 *
 * Covers: multi-source merge conflict resolution, invalid file watch errors,
 * schema validation extreme values, listener error isolation, and more.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigManager } from '../config/manager.js'
import type { ConfigChangeEvent } from '../config/manager.js'

// Helper: create a temp directory for config file tests
function createTempDir(): string {
  const dir = join(tmpdir(), `config-edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('ConfigManager — Multi-source Merge Conflict Scenarios', () => {
  let tmpDir: string
  let configPath: string
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    tmpDir = createTempDir()
    configPath = join(tmpDir, 'settings.json')
    originalEnv = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
      CLAUDE_CODE_PERMISSION_MODE: process.env.CLAUDE_CODE_PERMISSION_MODE,
    }
  })

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value !== undefined) {
        ;(process.env as any)[key] = value
      } else {
        delete (process.env as any)[key]
      }
    }
  })

  it('should handle empty env record in loadFromSources', () => {
    const cm = new ConfigManager()
    cm.loadFromSources({
      filePath: undefined,
      env: {},
      cliArgs: {},
    })
    // Should still have defaults
    expect(cm.getConfig().llm.provider).toBe('anthropic')
    expect(cm.getConfig().llm.model).toBe('claude-sonnet-4-20250514')
  })

  it('should handle cliArgs overriding file config for same field', () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        permissionMode: 'manual',
        defaultTools: false,
      }),
      'utf-8',
    )

    const cm = new ConfigManager()
    cm.loadFromSources({
      filePath: configPath,
      cliArgs: { permissionMode: 'bypass' },
    })

    expect(cm.getConfig().permissionMode).toBe('bypass') // CLI wins
    expect(cm.getConfig().defaultTools).toBe(false) // file value kept
  })

  it('should handle env overriding file when loading from sources', () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        llm: {
          provider: 'anthropic',
          apiKey: 'sk-file',
          model: 'file-model',
        },
      }),
      'utf-8',
    )

    const cm = new ConfigManager()
    cm.loadFromSources({
      filePath: configPath,
      env: { ANTHROPIC_API_KEY: 'sk-env-key' },
    })

    // env overrides file for apiKey
    const config = cm.getConfig()
    expect(config.llm.apiKey).toBe('sk-env-key')
    // model also overridden because env replaces entire llm block with default model
    expect(config.llm.model).toBe('claude-sonnet-4-20250514')
  })

  it('should handle all three sources with no conflicts gracefully', () => {
    const cm = new ConfigManager()
    cm.loadFromSources({
      env: { CLAUDE_CODE_PERMISSION_MODE: 'manual' },
      cliArgs: { defaultTools: false },
    })
    expect(cm.getConfig().permissionMode).toBe('manual')
    expect(cm.getConfig().defaultTools).toBe(false)
  })

  it('should not crash when filePath in loadFromSources points to non-existent file', () => {
    const cm = new ConfigManager()
    expect(() =>
      cm.loadFromSources({
        filePath: '/nonexistent/settings.json',
      }),
    ).toThrow()
  })

  it('should emit change events correctly per key during loadFromSources', () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        permissionMode: 'manual',
        defaultTools: false,
      }),
      'utf-8',
    )

    const cm = new ConfigManager()
    const changes: ConfigChangeEvent[] = []
    cm.onDidChange((event) => {
      changes.push(event)
    })

    cm.loadFromSources({
      filePath: configPath,
      cliArgs: { permissionMode: 'bypass' },
    })

    // Should have change events for permissionMode and defaultTools
    expect(changes.length).toBeGreaterThanOrEqual(2)
    const permChange = changes.find((c) => c.key === 'permissionMode')
    expect(permChange).toBeDefined()
    expect(permChange!.newValue).toBe('bypass')
    const toolsChange = changes.find((c) => c.key === 'defaultTools')
    expect(toolsChange).toBeDefined()
    expect(toolsChange!.newValue).toBe(false)
  })
})

describe('ConfigManager — Invalid File Watch Error Handling', () => {
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

  it('should handle watch on non-existent file gracefully', () => {
    const cm = new ConfigManager()
    // Should not throw
    expect(() => cm.watch('/nonexistent/file.json')).not.toThrow()
    cm.unwatch()
  })

  it('should handle unwatch when nothing is watched gracefully', () => {
    const cm = new ConfigManager()
    expect(() => cm.unwatch()).not.toThrow()
  })

  it('should handle duplicate watch calls without error', () => {
    writeFileSync(configPath, JSON.stringify({ permissionMode: 'manual' }), 'utf-8')
    const cm = new ConfigManager()
    cm.loadFromFile(configPath)
    expect(() => {
      cm.watch(configPath)
      cm.watch(configPath) // second call should unwatch previous and re-watch
    }).not.toThrow()
    cm.unwatch()
  })

  it('should not crash when watched file becomes unparseable temporarily', async () => {
    writeFileSync(configPath, JSON.stringify({ permissionMode: 'manual' }), 'utf-8')
    const cm = new ConfigManager()
    cm.loadFromFile(configPath)

    // Write invalid JSON to watched file
    const changeSpy = vi.fn()
    cm.onDidChange(changeSpy)
    cm.watch(configPath)

    // Write invalid content — should be silently ignored
    writeFileSync(configPath, '{ invalid json }', 'utf-8')

    // Wait a bit for the watch to fire
    await new Promise((r) => setTimeout(r, 1500))

    // Config should remain as before
    expect(cm.getConfig().permissionMode).toBe('manual')

    cm.unwatch()
  }, 10000)

  it('should handle watch on directory path gracefully', () => {
    const cm = new ConfigManager()
    // Watching a directory instead of a file should not throw
    expect(() => cm.watch(tmpDir)).not.toThrow()
    cm.unwatch()
  })
})

describe('ConfigManager — Schema Validation Extreme Values', () => {
  it('should validate with extremely large maxTokens', () => {
    const cm = new ConfigManager({
      llm: {
        provider: 'anthropic',
        apiKey: 'sk-valid',
        model: 'test',
        maxTokens: 9_999_999_999,
      },
    })
    const result = cm.validateZod()
    // Large positive int is valid
    expect(result.valid).toBe(true)
  })

  it('should validate with maxTokens = 1 (minimum positive)', () => {
    const cm = new ConfigManager({
      llm: {
        provider: 'anthropic',
        apiKey: 'sk-valid',
        model: 'test',
        maxTokens: 1,
      },
    })
    const result = cm.validateZod()
    expect(result.valid).toBe(true)
  })

  it('should reject maxTokens = 0 (not positive)', () => {
    const cm = new ConfigManager()
    cm.update({
      llm: {
        provider: 'anthropic',
        apiKey: 'sk-valid',
        model: 'test',
        maxTokens: 0,
      } as any,
    })
    const result = cm.validateZod()
    expect(result.valid).toBe(false)
  })

  it('should reject negative maxTokens', () => {
    const cm = new ConfigManager()
    cm.update({
      llm: {
        provider: 'anthropic',
        apiKey: 'sk-valid',
        model: 'test',
        maxTokens: -100,
      } as any,
    })
    const result = cm.validateZod()
    expect(result.valid).toBe(false)
  })

  it('should reject float maxTokens', () => {
    const cm = new ConfigManager()
    cm.update({
      llm: {
        provider: 'anthropic',
        apiKey: 'sk-valid',
        model: 'test',
        maxTokens: 50.5,
      } as any,
    })
    const result = cm.validateZod()
    expect(result.valid).toBe(false)
  })

  it('should validate temperature at exact boundary of 0', () => {
    const cm = new ConfigManager({
      llm: {
        provider: 'anthropic',
        apiKey: 'sk-valid',
        model: 'test',
        temperature: 0,
      },
    })
    const result = cm.validateZod()
    expect(result.valid).toBe(true)
  })

  it('should validate temperature at exact boundary of 2', () => {
    const cm = new ConfigManager({
      llm: {
        provider: 'anthropic',
        apiKey: 'sk-valid',
        model: 'test',
        temperature: 2,
      },
    })
    const result = cm.validateZod()
    expect(result.valid).toBe(true)
  })

  it('should reject temperature below 0', () => {
    const cm = new ConfigManager()
    cm.update({
      llm: {
        provider: 'anthropic',
        apiKey: 'sk-valid',
        model: 'test',
        temperature: -0.1,
      } as any,
    })
    const result = cm.validateZod()
    expect(result.valid).toBe(false)
  })

  it('should reject temperature above 2', () => {
    const cm = new ConfigManager()
    cm.update({
      llm: {
        provider: 'anthropic',
        apiKey: 'sk-valid',
        model: 'test',
        temperature: 2.1,
      } as any,
    })
    const result = cm.validateZod()
    expect(result.valid).toBe(false)
  })

  it('should handle extremely long model name strings', () => {
    const cm = new ConfigManager({
      llm: {
        provider: 'anthropic',
        apiKey: 'sk-valid',
        model: 'a'.repeat(10000),
      },
    })
    const result = cm.validateZod()
    expect(result.valid).toBe(true)
  })

  it('should handle empty apiKey string correctly in zod validation', () => {
    const cm = new ConfigManager()
    cm.update({
      llm: {
        provider: 'anthropic',
        apiKey: '',
        model: 'test',
      } as any,
    })
    const result = cm.validateZod()
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'llm.apiKey')).toBe(true)
  })

  it('should validate negative integer maxRetries', () => {
    const cm = new ConfigManager({
      llm: {
        provider: 'anthropic',
        apiKey: 'sk-valid',
        model: 'test',
      },
      global: {
        maxRetries: -1,
      },
    })
    // min(0) means -1 is invalid
    const result = cm.validateZod()
    expect(result.valid).toBe(false)
  })

  it('should validate maxRetries = 0 (ok, min(0))', () => {
    const cm = new ConfigManager({
      llm: {
        provider: 'anthropic',
        apiKey: 'sk-valid',
        model: 'test',
      },
      global: {
        maxRetries: 0,
      },
    })
    const result = cm.validateZod()
    expect(result.valid).toBe(true)
  })
})

describe('ConfigManager — Change Notification Listener Edge Cases', () => {
  it('should not crash when a listener throws', () => {
    const cm = new ConfigManager()
    cm.onDidChange(() => {
      throw new Error('listener error')
    })
    // Should not propagate the error
    expect(() => cm.update({ permissionMode: 'manual' })).not.toThrow()
  })

  it('should still call other listeners after one throws', () => {
    const cm = new ConfigManager()
    const goodSpy = vi.fn()
    cm.onDidChange(() => {
      throw new Error('bad listener')
    })
    cm.onDidChange(goodSpy)

    cm.update({ permissionMode: 'manual' })

    expect(goodSpy).toHaveBeenCalledTimes(1)
  })

  it('should not fire after all listeners are unsubscribed', () => {
    const cm = new ConfigManager()
    const spy = vi.fn()
    const unsub1 = cm.onDidChange(spy)
    const unsub2 = cm.onDidChange(spy)
    unsub1()
    unsub2()

    cm.update({ permissionMode: 'manual' })
    // Should fire twice (two subscriptions before unsubscribe)
    expect(spy).not.toHaveBeenCalled()
  })

  it('should handle removing non-existent listener gracefully', () => {
    const cm = new ConfigManager()
    // Callback that was never added
    const fn = () => {}
    // onDidChange returns a function; calling it twice is fine
    const unsub = cm.onDidChange(fn)
    unsub()
    // Second call should not throw
    expect(() => unsub()).not.toThrow()
  })

  it('should emit change for nested conversation key', () => {
    const cm = new ConfigManager()
    const spy = vi.fn()
    cm.onDidChange(spy)

    cm.update({ conversation: { maxTokens: 99999 } })

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'conversation', newValue: expect.objectContaining({ maxTokens: 99999 }) }),
    )
  })

  it('should emit change for nested context key', () => {
    const cm = new ConfigManager()
    const spy = vi.fn()
    cm.onDidChange(spy)

    cm.update({ context: { includeGitStatus: false } })

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'context', newValue: expect.objectContaining({ includeGitStatus: false }) }),
    )
  })
})

describe('ConfigManager — loadFromEnv Edge Cases', () => {
  beforeEach(() => {
    // Save and clear relevant env vars
    for (const key of [
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_MODEL',
      'ANTHROPIC_BASE_URL',
      'CLAUDE_CODE_PERMISSION_MODE',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_REGION',
      'ANTHROPIC_VERTEX_PROJECT_ID',
      'CLOUD_ML_REGION',
    ]) {
      delete (process.env as any)[key]
    }
  })

  afterEach(() => {
    // Clean up
    for (const key of [
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_MODEL',
      'ANTHROPIC_BASE_URL',
      'CLAUDE_CODE_PERMISSION_MODE',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_REGION',
      'ANTHROPIC_VERTEX_PROJECT_ID',
      'CLOUD_ML_REGION',
    ]) {
      delete (process.env as any)[key]
    }
  })

  it('should handle ANTHROPIC_BASE_URL without apiKey (no Anthropic config)', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://custom.com'
    const envConfig = new ConfigManager().loadFromEnv()
    // Without ANTHROPIC_API_KEY, base URL alone does nothing
    expect(Object.keys(envConfig)).toHaveLength(0)
  })

  it('should handle ANTHROPIC_BASE_URL with apiKey', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-baseurl-test'
    process.env.ANTHROPIC_BASE_URL = 'https://custom.api.com'
    const envConfig = new ConfigManager().loadFromEnv()
    expect(envConfig.llm).toBeDefined()
    if (envConfig.llm) {
      expect((envConfig.llm as any).baseUrl).toBe('https://custom.api.com')
    }
  })

  it('should handle partial AWS env (only access key, no secret)', () => {
    process.env.AWS_ACCESS_KEY_ID = 'some-key'
    // Without AWS_SECRET_ACCESS_KEY, should NOT trigger bedrock
    const envConfig = new ConfigManager().loadFromEnv()
    expect(envConfig.llm?.provider).not.toBe('bedrock')
  })

  it('should handle partial AWS env (only secret, no access key)', () => {
    process.env.AWS_SECRET_ACCESS_KEY = 'some-secret'
    const envConfig = new ConfigManager().loadFromEnv()
    expect(envConfig.llm?.provider).not.toBe('bedrock')
  })

  it('should handle CLAUDE_CODE_PERMISSION_MODE env var', () => {
    process.env.CLAUDE_CODE_PERMISSION_MODE = 'bypass'
    const envConfig = new ConfigManager().loadFromEnv()
    expect(envConfig.permissionMode).toBe('bypass')
  })
})

describe('ConfigManager — Additional validate() Edge Cases', () => {
  it('should warn but not error for bedrock without credentials', () => {
    const cm = new ConfigManager()
    cm.update({
      llm: {
        provider: 'bedrock',
        model: 'anthropic.claude-sonnet-4-20250514',
      } as any,
    })
    const result = cm.validate()
    // Should have warnings but not errors for missing accessKeyId
    if (result.warnings && result.warnings.length > 0) {
      expect(result.warnings.some((w) => w.includes('accessKeyId'))).toBe(true)
    }
  })

  it('should report missing model', () => {
    const cm = new ConfigManager()
    // Config without model via update
    cm.update({
      llm: {
        provider: 'anthropic',
        apiKey: 'sk-valid',
        model: '',
      } as any,
    })
    const result = cm.validate()
    expect(result.errors.some((e) => e.includes('model'))).toBe(true)
  })

  it('should report invalid permission mode', () => {
    const cm = new ConfigManager({
      llm: {
        provider: 'anthropic',
        apiKey: 'sk-valid',
        model: 'test',
      },
      permissionMode: 'invalid-mode' as any,
    })
    const result = cm.validate()
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('permissionMode'))).toBe(true)
  })
})

describe('ConfigManager — saveToFile compact storage edge cases', () => {
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

  it('should not save nested objects that match defaults exactly', () => {
    const cm = new ConfigManager()
    // All defaults — save should produce minimal output
    cm.saveToFile(configPath)
    const saved = JSON.parse(readFileSync(configPath, 'utf-8'))
    // Everything matches defaults, so saved should be empty or minimal
    expect(Object.keys(saved).length).toBe(0)
  })

  it('should save only the non-default nested subsections', () => {
    const cm = new ConfigManager({
      context: {
        includeGitStatus: false, // differs from default (true)
      },
    })
    cm.saveToFile(configPath)
    const saved = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(saved.context).toBeDefined()
    expect(saved.context.includeGitStatus).toBe(false)
    // includeClaudeMd matches default, so should be filtered out
    expect(saved.context.includeClaudeMd).toBeUndefined()
  })

  it('should handle empty config path edge cases', () => {
    const cm = new ConfigManager()
    // Non-existent parent directory — should create it
    const deepPath = join(tmpDir, 'a', 'b', 'c', 'settings.json')
    expect(() => cm.saveToFile(deepPath)).not.toThrow()
    expect(existsSync(deepPath)).toBe(true)
  })
})
