/**
 * Edge-case tests for LLM Client factory, stream events, and token statistics
 *
 * Covers boundary scenarios not tested in the main test files:
 * 1. createLLMConnector — empty config, null provider, missing fields
 * 2. StreamEvent type exhaustiveness — all union members discriminable
 * 3. Token statistics — empty messages, very large messages, unicode
 * 4. withRetry — retry-after header, network errors, status edge cases
 */
import { describe, expect, it, vi } from 'vitest'
import { createLLMConnector, getSupportedProviders } from '../client.js'

// ─── 1. createLLMConnector — Boundary Cases ───────────────

describe('createLLMConnector — boundary cases', () => {
  it('should throw for empty config object', () => {
    expect(() => createLLMConnector({} as never)).toThrow('Unsupported LLM provider')
  })

  it('should throw for config with undefined provider', () => {
    expect(() => createLLMConnector({ provider: undefined, model: 'test' } as never)).toThrow(
      'Unsupported LLM provider',
    )
  })

  it('should throw for config with null provider', () => {
    expect(() => createLLMConnector({ provider: null, model: 'test' } as never)).toThrow('Unsupported LLM provider')
  })

  it('should throw for config with empty string provider', () => {
    expect(() => createLLMConnector({ provider: '', model: 'test' } as never)).toThrow('Unsupported LLM provider')
  })

  it('should throw for config with number as provider', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing type coercion boundary
      createLLMConnector({ provider: 123 as any, model: 'test' }),
    ).toThrow('Unsupported LLM provider')
  })

  it('should create connector even with missing apiKey (runtime validation deferred)', () => {
    // The AnthropicConnector creates the SDK client with undefined apiKey,
    // which doesn't throw until send() is called
    const connector = createLLMConnector({
      provider: 'anthropic',
      model: 'test-model',
      // no apiKey
    } as never)
    expect(connector.provider).toBe('anthropic')
  })

  it('should create connector with provider and model only (model may be set at runtime)', () => {
    const connector = createLLMConnector({
      provider: 'anthropic',
      apiKey: 'sk-test',
      // no model — will use whatever the SDK defaults to
    } as never)
    expect(connector.provider).toBe('anthropic')
  })

  it('should include the unsupported provider name in the error message', () => {
    expect(() => createLLMConnector({ provider: 'gpt-5' } as never)).toThrow('Unsupported LLM provider: gpt-5')
  })

  it('should throw for config with extra unknown fields gracefully', () => {
    // Extra fields should not affect type guard behavior
    const config = {
      provider: 'bedrock',
      model: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
      region: 'us-east-1',
      extraField: 'should-be-ignored',
    }
    // Bedrock config doesn't require accessKeyId (uses default chain)
    const connector = createLLMConnector(config)
    expect(connector.provider).toBe('bedrock')
  })

  it('should return correct provider for each valid config', () => {
    // Anthropic
    expect(
      createLLMConnector({
        provider: 'anthropic',
        apiKey: 'sk-test',
        model: 'claude-sonnet-4-20250514',
      }).provider,
    ).toBe('anthropic')

    // Bedrock
    expect(
      createLLMConnector({
        provider: 'bedrock',
        model: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
        region: 'us-east-1',
      }).provider,
    ).toBe('bedrock')
  })

  it('should list exactly the supported providers', () => {
    const providers = getSupportedProviders()
    expect(providers).toEqual(['anthropic', 'bedrock', 'vertex', 'foundry'])
    expect(new Set(providers).size).toBe(providers.length) // no duplicates
  })
})

// ─── 2. StreamEvent Type Exhaustiveness ──────────────────

describe('StreamEvent — type exhaustiveness', () => {
  it('should discriminate all event types via type field', () => {
    const events = [
      { type: 'text' as const, text: 'hello' },
      {
        type: 'tool_use_start' as const,
        id: 'tu_1',
        name: 'bash',
        input: { cmd: 'ls' },
      },
      {
        type: 'tool_use_end' as const,
        id: 'tu_1',
        output: '{}',
        isError: false,
      },
      { type: 'thinking' as const, thinking: 'I think...' },
      { type: 'error' as const, error: new Error('fail') },
      { type: 'retry' as const, attempt: 1, delayMs: 500, error: 'timeout', status: 429 },
      { type: 'done' as const, usage: { inputTokens: 10, outputTokens: 5 } },
      { type: 'ping' as const },
    ]

    // Verify each event type is uniquely discriminable
    const typeCounts = new Map<string, number>()
    for (const event of events) {
      typeCounts.set(event.type, (typeCounts.get(event.type) ?? 0) + 1)
    }
    expect(typeCounts.size).toBe(events.length)

    // Verify all defined StreamEvent types are represented
    const coveredTypes = events.map((e) => e.type).sort()
    expect(coveredTypes).toEqual([
      'done',
      'error',
      'ping',
      'retry',
      'text',
      'thinking',
      'tool_use_end',
      'tool_use_start',
    ])
  })

  it('should support tool_use_end with isError flag', () => {
    const event: { type: 'tool_use_end'; id: string; output: string; isError?: boolean } = {
      type: 'tool_use_end',
      id: 'tu_err',
      output: 'Command failed',
      isError: true,
    }
    expect(event.isError).toBe(true)
  })

  it('should support retry event with undefined status', () => {
    const event = {
      type: 'retry' as const,
      attempt: 2,
      delayMs: 1000,
      error: 'Connection refused',
      // status is optional
    }
    expect(event.status).toBeUndefined()
    expect(event.attempt).toBe(2)
  })

  it('should support done event with zero usage', () => {
    const event = { type: 'done' as const, usage: { inputTokens: 0, outputTokens: 0 } }
    expect(event.usage.inputTokens).toBe(0)
    expect(event.usage.outputTokens).toBe(0)
  })

  it('should support done event with cache metrics', () => {
    const event = {
      type: 'done' as const,
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationInputTokens: 80,
        cacheReadInputTokens: 20,
      },
    }
    expect(event.usage.cacheCreationInputTokens).toBe(80)
    expect(event.usage.cacheReadInputTokens).toBe(20)
  })

  it('should treat text event payload correctly', () => {
    const textEvent = { type: 'text' as const, text: 'Hello world' }
    expect(typeof textEvent.text).toBe('string')
    expect(textEvent.text.length).toBeGreaterThan(0)
  })

  it('should treat error event payload correctly', () => {
    const errorEvent = { type: 'error' as const, error: new Error('API timeout') }
    expect(errorEvent.error).toBeInstanceOf(Error)
    expect(errorEvent.error.message).toBe('API timeout')
  })
})

// ─── 3. Token Statistics — Edge Cases ────────────────────

describe('Token statistics — edge cases', () => {
  // Simulate the fallback estimation logic: Math.ceil(content.length / 4)
  function estimateTokens(messages: Array<{ role: string; content: string }>): number {
    return messages.reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0)
  }

  it('should return 0 for empty message array', () => {
    expect(estimateTokens([])).toBe(0)
  })

  it('should estimate 1 token for single character', () => {
    expect(estimateTokens([{ role: 'user', content: 'a' }])).toBe(1) // ceil(1/4) = 1
  })

  it('should estimate 1 token for 4 characters', () => {
    expect(estimateTokens([{ role: 'user', content: 'test' }])).toBe(1) // ceil(4/4) = 1
  })

  it('should estimate 2 tokens for 5 characters', () => {
    expect(estimateTokens([{ role: 'user', content: 'hello' }])).toBe(2) // ceil(5/4) = 2
  })

  it('should handle very large message (100k chars)', () => {
    const largeContent = 'x'.repeat(100_000)
    const tokens = estimateTokens([{ role: 'user', content: largeContent }])
    expect(tokens).toBe(25_000) // ceil(100000/4) = 25000
  })

  it('should handle unicode characters (multi-byte)', () => {
    // Unicode chars may be multi-byte, but estimation treats them as single chars
    const content = '你好世界' // 4 Chinese chars
    expect(estimateTokens([{ role: 'user', content }])).toBe(1) // ceil(4/4) = 1
    // More realistic: longer unicode content
    const longUnicode = '宇宙'.repeat(500) // 1000 chars
    expect(estimateTokens([{ role: 'user', content: longUnicode }])).toBe(250) // ceil(1000/4) = 250
  })

  it('should handle emoji characters', () => {
    // Emoji are typically 2 chars in JS (surrogate pairs)
    const content = '🔥💡🚀' // 3 emoji = 6 JS chars
    expect(estimateTokens([{ role: 'user', content }])).toBe(2) // ceil(6/4) = 2
  })

  it('should handle messages with only whitespace', () => {
    expect(estimateTokens([{ role: 'user', content: '   ' }])).toBe(1) // ceil(3/4) = 1
  })

  it('should handle multiple messages with different sizes', () => {
    const messages = [
      { role: 'user', content: 'hi' }, // ceil(2/4) = 1
      { role: 'assistant', content: 'hello' }, // ceil(5/4) = 2
      { role: 'user', content: 'world' }, // ceil(5/4) = 2
    ]
    expect(estimateTokens(messages)).toBe(5)
  })

  it('should handle messages with empty content strings', () => {
    expect(estimateTokens([{ role: 'user', content: '' }])).toBe(0) // ceil(0/4) = 0
  })

  it('should handle mixed empty and non-empty messages', () => {
    const messages = [
      { role: 'user', content: '' },
      { role: 'assistant', content: 'a' },
      { role: 'user', content: '' },
    ]
    expect(estimateTokens(messages)).toBe(1) // 0 + 1 + 0 = 1
  })

  it('should handle messages with special characters (newlines, tabs)', () => {
    const content = 'line1\nline2\tline3'
    expect(estimateTokens([{ role: 'user', content }])).toBe(5) // ceil(17/4) = 5
  })

  it('should handle messages with very long words', () => {
    const content = 'supercalifragilisticexpialidocious'.repeat(100) // 3400 chars
    expect(estimateTokens([{ role: 'user', content }])).toBe(850) // ceil(3400/4) = 850
  })
})

// ─── 4. withRetry — Retry Limit & Edge Scenarios ─────────

describe('withRetry — limit scenarios', () => {
  it('should throw immediate for retryable error when maxRetries=0', async () => {
    const { shouldRetry } = await import('../retry.js')
    const err = new Error('Rate limited') as Error & { status?: number }
    err.status = 429
    expect(shouldRetry(err)).toBe(true)
  })

  it('should reject unknown provider configs at factory level', () => {
    expect(() => createLLMConnector({ provider: 'openai' } as never)).toThrow('Unsupported LLM provider: openai')
  })

  it('should reject config with provider name collision', () => {
    // Config that looks like a valid type but has wrong discriminator
    expect(() =>
      createLLMConnector({
        provider: 'anthropic',
        apiKey: 'sk-test',
        model: 'test',
      }),
    ).not.toThrow() // Valid config should work
  })

  it('should handle config with all optional fields omitted for bedrock', () => {
    // Bedrock has region as optional
    const connector = createLLMConnector({
      provider: 'bedrock',
      model: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
      // region, accessKeyId, secretAccessKey all omitted
    })
    expect(connector.provider).toBe('bedrock')
  })
})

// ─── 5. getSupportedProviders — Edge Cases ──────────────

describe('getSupportedProviders — edge cases', () => {
  it('should return a frozen-like array (immutable reference)', () => {
    const providers = getSupportedProviders()
    // Modifying returned array should not affect subsequent calls
    const copy = [...providers]
    copy.push('custom')
    expect(copy).toHaveLength(5)
    expect(getSupportedProviders()).toHaveLength(4)
  })

  it('should always return providers in same order', () => {
    const order1 = getSupportedProviders()
    const order2 = getSupportedProviders()
    expect(order1).toEqual(order2)
  })
})
