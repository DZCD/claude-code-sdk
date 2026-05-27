import { describe, expect, it } from 'vitest'
import { ConfigManager } from '../config/manager.js'

describe('ConfigManager', () => {
  it('should create with default values', () => {
    const cm = new ConfigManager()
    const config = cm.getConfig()
    expect(config.llm.provider).toBe('anthropic')
    expect(config.llm.model).toBe('claude-sonnet-4-20250514')
    expect(config.permissionMode).toBe('auto')
    expect(config.defaultTools).toBe(true)
  })

  it('should accept partial configuration', () => {
    const cm = new ConfigManager({
      llm: {
        provider: 'anthropic',
        apiKey: 'sk-test',
        model: 'claude-haiku-3-5',
      },
      permissionMode: 'manual',
    })
    const config = cm.getConfig()
    expect(config.llm.provider).toBe('anthropic')
    expect(config.llm.model).toBe('claude-haiku-3-5')
    expect(config.permissionMode).toBe('manual')
    // Should still have defaults for other fields
    expect(config.defaultTools).toBe(true)
  })

  it('should update config', () => {
    const cm = new ConfigManager()
    cm.update({ permissionMode: 'plan' })
    expect(cm.getConfig().permissionMode).toBe('plan')
  })

  it('should get LLM config', () => {
    const cm = new ConfigManager({
      llm: {
        provider: 'anthropic',
        apiKey: 'sk-test',
        model: 'test-model',
      },
    })
    const llm = cm.getLLMConfig()
    expect(llm.provider).toBe('anthropic')
  })

  it('should merge environment variables', () => {
    const cm = new ConfigManager()
    // Set env vars before merging
    process.env.ANTHROPIC_API_KEY = 'sk-env-key'
    process.env.ANTHROPIC_MODEL = 'env-model'
    cm.mergeFromEnv()
    const config = cm.getConfig()
    expect(config.llm.provider).toBe('anthropic')
    expect(config.llm.model).toBe('env-model')
    // Clean up
    process.env.ANTHROPIC_API_KEY = undefined
    process.env.ANTHROPIC_MODEL = undefined
  })

  it('should reset to defaults', () => {
    const cm = new ConfigManager({
      permissionMode: 'manual',
    })
    cm.reset()
    expect(cm.getConfig().permissionMode).toBe('auto')
  })

  it('should load env vars for AWS Bedrock', () => {
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

    process.env.AWS_ACCESS_KEY_ID = undefined
    process.env.AWS_SECRET_ACCESS_KEY = undefined
    process.env.AWS_REGION = undefined
  })

  it('should load env vars for Vertex AI', () => {
    process.env.ANTHROPIC_VERTEX_PROJECT_ID = 'my-project'
    process.env.CLOUD_ML_REGION = 'europe-west1'

    const cm = new ConfigManager()
    cm.mergeFromEnv()
    const config = cm.getConfig()

    expect(config.llm.provider).toBe('vertex')

    process.env.ANTHROPIC_VERTEX_PROJECT_ID = undefined
    process.env.CLOUD_ML_REGION = undefined
  })
})
