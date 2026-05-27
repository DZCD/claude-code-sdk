/**
 * Tests for LLM Client factory
 */
import { describe, expect, it, vi } from 'vitest'

// Mock provider SDKs so constructors don't validate
vi.mock('@anthropic-ai/bedrock-sdk', () => ({
  AnthropicBedrock: class {
    messages = { create: vi.fn() }
  },
}))
vi.mock('@anthropic-ai/vertex-sdk', () => ({
  AnthropicVertex: class {
    messages = { create: vi.fn(), countTokens: vi.fn() }
  },
}))
vi.mock('@anthropic-ai/foundry-sdk', () => ({
  AnthropicFoundry: class {
    messages = { create: vi.fn(), countTokens: vi.fn() }
  },
}))

import { createLLMConnector, getSupportedProviders } from '../client.js'

describe('createLLMConnector factory', () => {
  it('should create AnthropicConnector for anthropic config', () => {
    const connector = createLLMConnector({
      provider: 'anthropic',
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-20250514',
    })
    expect(connector.provider).toBe('anthropic')
  })

  it('should create BedrockConnector for bedrock config', () => {
    const connector = createLLMConnector({
      provider: 'bedrock',
      model: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
      region: 'us-east-1',
    })
    expect(connector.provider).toBe('bedrock')
  })

  it('should create VertexConnector for vertex config', () => {
    const connector = createLLMConnector({
      provider: 'vertex',
      model: 'claude-sonnet-4@20250514',
      projectId: 'my-project',
    })
    expect(connector.provider).toBe('vertex')
  })

  it('should create FoundryConnector for foundry config', () => {
    const connector = createLLMConnector({
      provider: 'foundry',
      model: 'claude-sonnet-4',
      resourceName: 'my-resource',
    })
    expect(connector.provider).toBe('foundry')
  })

  it('should throw for unknown provider', () => {
    expect(() =>
      createLLMConnector({
        provider: 'unknown',
        model: 'test',
      } as never),
    ).toThrow('Unsupported LLM provider')
  })

  it('should list all supported providers', () => {
    const providers = getSupportedProviders()
    expect(providers).toContain('anthropic')
    expect(providers).toContain('bedrock')
    expect(providers).toContain('vertex')
    expect(providers).toContain('foundry')
    expect(providers).toHaveLength(4)
  })
})
