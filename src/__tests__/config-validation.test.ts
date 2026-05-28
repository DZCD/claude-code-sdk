/**
 * Tests for ConfigManager Phase 3D — Zod Config Validation (validateZod)
 *
 * Covers: valid configs for all providers, invalid providers,
 * missing required fields, invalid enum values, structured error format.
 */
import { describe, expect, it } from 'vitest'
import { sdkConfigSchema } from '../config/config-schema.js'
import { ConfigManager } from '../config/manager.js'
import type { ValidationResult } from '../config/manager.js'

describe('ConfigManager Phase 3D — validateZod()', () => {
  describe('valid configurations', () => {
    it('should validate valid anthropic config', () => {
      const cm = new ConfigManager({
        llm: {
          provider: 'anthropic',
          apiKey: 'sk-valid-key',
          model: 'claude-sonnet-4-20250514',
        },
      })
      const result = cm.validateZod()
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should validate valid bedrock config', () => {
      const cm = new ConfigManager()
      // Manually set config
      cm.update({
        llm: {
          provider: 'bedrock',
          model: 'anthropic.claude-sonnet-4-20250514',
          region: 'us-east-1',
          accessKeyId: 'aws-key',
          secretAccessKey: 'aws-secret',
        } as any,
      })
      const result = cm.validateZod()
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should validate valid vertex config', () => {
      const cm = new ConfigManager()
      cm.update({
        llm: {
          provider: 'vertex',
          model: 'claude-sonnet-4-20250514',
          projectId: 'my-project',
          region: 'us-central1',
        } as any,
      })
      const result = cm.validateZod()
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should validate valid foundry config', () => {
      const cm = new ConfigManager()
      cm.update({
        llm: {
          provider: 'foundry',
          model: 'my-model',
          resourceName: 'projects/my-project/locations/us-central1/endpoints/123',
          apiKey: 'sk-key',
        } as any,
      })
      const result = cm.validateZod()
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should validate config with all optional fields filled', () => {
      const cm = new ConfigManager({
        llm: {
          provider: 'anthropic',
          apiKey: 'sk-full-key',
          model: 'claude-sonnet-4-20250514',
          maxTokens: 4096,
          temperature: 0.7,
        },
        permissionMode: 'plan',
        permissionRules: [],
        defaultTools: ['bash', 'file_read'],
        context: {
          includeGitStatus: true,
          includeClaudeMd: false,
          systemPromptPrefix: 'Custom prefix',
          systemPromptSuffix: 'Custom suffix',
        },
        conversation: {
          maxTokens: 50000,
          autoCompact: false,
        },
        global: {
          timeout: 60000,
          maxRetries: 5,
        },
        session: {
          maxTurns: 100,
          timeout: 300000,
          idleTimeout: 60000,
          attributionMode: 'detailed',
          modelName: 'test-model',
          autoSave: true,
          autoSaveInterval: 30000,
          storageDir: '/tmp/sessions',
          sessionLabel: 'test-session',
          sessionTags: ['test', 'dev'],
        },
        rateLimit: {
          enabled: true,
        },
      })
      const result = cm.validateZod()
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('invalid configurations', () => {
    it('should reject invalid provider', () => {
      const cm = new ConfigManager()
      cm.update({
        llm: {
          provider: 'invalid-provider',
          apiKey: 'sk-test',
          model: 'test',
        } as any,
      })
      const result = cm.validateZod()
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      // Should report the provider issue
      expect(result.errors.some((e) => e.path.includes('provider') || e.message.includes('provider'))).toBe(true)
    })

    it('should reject missing apiKey for anthropic provider', () => {
      const cm = new ConfigManager({
        llm: {
          provider: 'anthropic',
          apiKey: '',
          model: 'claude-sonnet-4-20250514',
        },
      })
      const result = cm.validateZod()
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.path === 'llm.apiKey')).toBe(true)
    })

    it('should reject missing projectId for vertex provider', () => {
      const cm = new ConfigManager()
      cm.update({
        llm: {
          provider: 'vertex',
          model: 'test',
        } as any,
      })
      const result = cm.validateZod()
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.path === 'llm.projectId')).toBe(true)
    })

    it('should reject missing resourceName for foundry provider', () => {
      const cm = new ConfigManager()
      cm.update({
        llm: {
          provider: 'foundry',
          model: 'test',
        } as any,
      })
      const result = cm.validateZod()
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.path === 'llm.resourceName')).toBe(true)
    })

    it('should reject invalid permissionMode', () => {
      const cm = new ConfigManager({
        llm: {
          provider: 'anthropic',
          apiKey: 'sk-valid',
          model: 'test',
        },
        permissionMode: 'invalid-mode' as any,
      })
      const result = cm.validateZod()
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.path === 'permissionMode')).toBe(true)
    })

    it('should reject empty model string', () => {
      const cm = new ConfigManager()
      cm.update({
        llm: {
          provider: 'anthropic',
          apiKey: 'sk-key',
          model: '',
        } as any,
      })
      const result = cm.validateZod()
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.path === 'llm.model')).toBe(true)
    })
  })

  describe('structured error format', () => {
    it('should return ValidationError with path, message, expected, actual', () => {
      const cm = new ConfigManager()
      cm.update({
        llm: {
          provider: 'anthropic',
          apiKey: '',
          model: 'test',
        },
      })
      const result = cm.validateZod()
      expect(result.valid).toBe(false)

      for (const err of result.errors) {
        expect(err).toHaveProperty('path')
        expect(err).toHaveProperty('message')
        expect(err).toHaveProperty('expected')
        expect(err).toHaveProperty('actual')
        expect(typeof err.path).toBe('string')
        expect(typeof err.message).toBe('string')
      }
    })

    it('should have readable error messages', () => {
      const cm = new ConfigManager({
        llm: {
          provider: 'anthropic',
          apiKey: 'sk-key',
          model: 'test',
        },
        permissionMode: 'bogus' as any,
      })
      const result = cm.validateZod()
      expect(result.valid).toBe(false)

      const permissionError = result.errors.find((e) => e.path === 'permissionMode')
      expect(permissionError).toBeDefined()
      expect(permissionError!.message.length).toBeGreaterThan(0)
      expect(permissionError!.expected).toBeDefined()
      expect(permissionError!.actual).toBeDefined()
    })
  })
})

describe('sdkConfigSchema — direct Zod schema tests', () => {
  it('should parse a valid config object', () => {
    const config = {
      llm: {
        provider: 'anthropic' as const,
        apiKey: 'sk-valid',
        model: 'claude-sonnet-4-20250514',
      },
      permissionMode: 'auto' as const,
    }
    const result = sdkConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
  })

  it('should reject a config with missing llm', () => {
    const result = sdkConfigSchema.safeParse({} as any)
    expect(result.success).toBe(false)
  })

  it('should reject a config with invalid temperature range', () => {
    const config = {
      llm: {
        provider: 'anthropic' as const,
        apiKey: 'sk-key',
        model: 'test',
        temperature: 99,
      },
    }
    const result = sdkConfigSchema.safeParse(config)
    expect(result.success).toBe(false)
  })
})
