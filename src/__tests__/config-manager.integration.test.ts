/**
 * Integration Tests — ConfigManager
 *
 * Tests multi-source configuration merge: default values,
 * environment variables, and programmatic overrides.
 * Covers: config priority, deep merge, env loading.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigManager } from '../config/manager.js'
import type { SDKConfig } from '../types/config.js'

describe('ConfigManager Integration', () => {
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    originalEnv = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
      CLAUDE_CODE_PERMISSION_MODE: process.env.CLAUDE_CODE_PERMISSION_MODE,
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
      AWS_REGION: process.env.AWS_REGION,
      ANTHROPIC_VERTEX_PROJECT_ID: process.env.ANTHROPIC_VERTEX_PROJECT_ID,
      CLOUD_ML_REGION: process.env.CLOUD_ML_REGION,
    }
  })

  afterEach(() => {
    // Restore env
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value !== undefined) {
        process.env[key] = value
      } else {
        delete process.env[key]
      }
    }
  })

  describe('default values', () => {
    it('should apply defaults for all config fields', () => {
      const cm = new ConfigManager()
      const config = cm.getConfig()

      expect(config.llm.provider).toBe('anthropic')
      expect(config.llm.apiKey).toBe('')
      expect(config.llm.model).toBe('claude-sonnet-4-20250514')
      expect(config.permissionMode).toBe('auto')
      expect(config.defaultTools).toBe(true)
      expect(config.context?.includeGitStatus).toBe(true)
      expect(config.context?.includeClaudeMd).toBe(true)
      expect(config.conversation?.maxTokens).toBe(100000)
      expect(config.conversation?.autoCompact).toBe(true)
      expect(config.global?.timeout).toBe(120000)
      expect(config.global?.maxRetries).toBe(3)
    })
  })

  describe('programmatic override priority', () => {
    it('should allow partial config to override defaults', () => {
      const cm = new ConfigManager({
        llm: {
          provider: 'anthropic',
          apiKey: 'sk-prog-key',
          model: 'claude-sonnet-4-20250514',
        },
        permissionMode: 'manual',
        conversation: {
          maxTokens: 50000,
          autoCompact: false,
        },
      })
      const config = cm.getConfig()

      expect(config.llm.apiKey).toBe('sk-prog-key')
      expect(config.permissionMode).toBe('manual')
      expect(config.conversation?.maxTokens).toBe(50000)
      expect(config.conversation?.autoCompact).toBe(false)
      // Non-overridden fields should still be defaults
      expect(config.global?.timeout).toBe(120000)
    })

    it('should merge context subsection correctly', () => {
      const cm = new ConfigManager({
        context: {
          includeGitStatus: false,
          systemPromptPrefix: 'Custom prefix',
        },
      })
      const config = cm.getConfig()

      expect(config.context?.includeGitStatus).toBe(false)
      expect(config.context?.includeClaudeMd).toBe(true) // default
      expect(config.context?.systemPromptPrefix).toBe('Custom prefix')
    })
  })

  describe('update() deep merge', () => {
    it('should update single fields via update()', () => {
      const cm = new ConfigManager()
      cm.update({ permissionMode: 'bypass' })
      expect(cm.getConfig().permissionMode).toBe('bypass')

      // Other fields unchanged
      expect(cm.getConfig().llm.provider).toBe('anthropic')
    })

    it('should merge nested objects in update()', () => {
      const cm = new ConfigManager()
      cm.update({
        conversation: { maxTokens: 200000 },
        global: { timeout: 300000 },
      })
      expect(cm.getConfig().conversation?.maxTokens).toBe(200000)
      expect(cm.getConfig().conversation?.autoCompact).toBe(true) // default preserved
      expect(cm.getConfig().global?.timeout).toBe(300000)
      expect(cm.getConfig().global?.maxRetries).toBe(3) // default preserved
    })
  })

  describe('environment variable loading', () => {
    it('should load anthropic config from env vars', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-env-key'
      process.env.ANTHROPIC_MODEL = 'claude-opus-4-20250514'
      process.env.ANTHROPIC_BASE_URL = 'https://custom.anthropic.com'

      const cm = new ConfigManager()
      cm.mergeFromEnv()
      const config = cm.getConfig()

      expect(config.llm.provider).toBe('anthropic')
      expect(config.llm.apiKey).toBe('sk-env-key')
      expect(config.llm.model).toBe('claude-opus-4-20250514')
      if ('baseUrl' in config.llm) {
        expect((config.llm as { baseUrl: string }).baseUrl).toBe('https://custom.anthropic.com')
      }
    })

    it('should load permission mode from env', () => {
      process.env.CLAUDE_CODE_PERMISSION_MODE = 'manual'

      const cm = new ConfigManager()
      cm.mergeFromEnv()
      expect(cm.getConfig().permissionMode).toBe('manual')

      // Programmatic API should override env
      cm.update({ permissionMode: 'plan' })
      expect(cm.getConfig().permissionMode).toBe('plan')
    })

    it('should load bedrock config from env vars', () => {
      process.env.AWS_ACCESS_KEY_ID = 'aws-key'
      process.env.AWS_SECRET_ACCESS_KEY = 'aws-secret'
      process.env.AWS_REGION = 'us-west-2'

      const cm = new ConfigManager()
      cm.mergeFromEnv()
      const config = cm.getConfig()

      expect(config.llm.provider).toBe('bedrock')
      if (config.llm.provider === 'bedrock') {
        expect(config.llm.region).toBe('us-west-2')
      }
    })

    it('should load vertex config from env vars', () => {
      process.env.ANTHROPIC_VERTEX_PROJECT_ID = 'vertex-project'
      process.env.CLOUD_ML_REGION = 'europe-west4'

      const cm = new ConfigManager()
      cm.mergeFromEnv()
      const config = cm.getConfig()

      expect(config.llm.provider).toBe('vertex')
    })

    it('should merge env vars into existing config', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-env-key'

      const cm = new ConfigManager({
        llm: {
          provider: 'anthropic',
          apiKey: 'sk-original',
          model: 'claude-sonnet-4-20250514',
        },
      })

      // Before merge, programmatic value is used
      expect(cm.getConfig().llm.apiKey).toBe('sk-original')

      // After merge, env replaces the llm block entirely
      cm.mergeFromEnv()
      const config = cm.getConfig()

      // mergeFromEnv replaces the whole llm block
      expect(config.llm.apiKey).toBe('sk-env-key')
    })

    it('should allow programmatic update after env merge', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-env-key'

      const cm = new ConfigManager()
      cm.mergeFromEnv()
      expect(cm.getConfig().llm.apiKey).toBe('sk-env-key')

      // update() can override env values
      cm.update({ permissionMode: 'plan' })
      expect(cm.getConfig().permissionMode).toBe('plan')
    })

    it('should handle no env vars gracefully', () => {
      // Clean all relevant env vars (set to empty string, NOT delete — biome noDelete rule
      // and NOT =undefined — Node.js converts undefined to the string "undefined" which is truthy)
      process.env.ANTHROPIC_API_KEY = ''
      process.env.ANTHROPIC_MODEL = ''
      process.env.AWS_ACCESS_KEY_ID = ''
      process.env.AWS_SECRET_ACCESS_KEY = ''
      process.env.ANTHROPIC_VERTEX_PROJECT_ID = ''

      const cm = new ConfigManager()
      cm.mergeFromEnv()
      const config = cm.getConfig()

      // Should keep defaults
      expect(config.llm.provider).toBe('anthropic')
      expect(config.llm.apiKey).toBe('')
      expect(config.llm.model).toBe('claude-sonnet-4-20250514')
    })
  })

  describe('reset()', () => {
    it('should reset all config to defaults', () => {
      const cm = new ConfigManager({
        permissionMode: 'manual',
        conversation: { maxTokens: 500 },
      })
      cm.reset()

      const config = cm.getConfig()
      expect(config.permissionMode).toBe('auto')
      expect(config.conversation?.maxTokens).toBe(100000)
      expect(config.conversation?.autoCompact).toBe(true)
    })
  })
})
