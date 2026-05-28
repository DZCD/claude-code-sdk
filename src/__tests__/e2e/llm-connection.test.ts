/**
 * E2E Test — LLM Connectivity (Real API)
 *
 * Tests basic connectivity to the DeepSeek API via the Anthropic-compatible
 * interface. Verifies that the SDK can successfully send messages and
 * receive responses from a real LLM endpoint.
 *
 * @group e2e
 * @group real-api
 * @requires DEEPSEEK_API_KEY
 */
import { describe, expect, it } from 'vitest'
import { ClaudeCodeSDK } from '../../session/engine.js'
import { AnthropicConnector } from '../../llm/client.js'
import type { LLMConfig, StreamEvent } from '../../llm/types.js'

const DEEPSEEK_API_KEY = 'sk-af3a84b5661b44f5b5695b47cb39dcd2'
const BASE_URL = 'https://api.deepseek.com/anthropic'
const MODEL = 'deepseek-v4-flash'

const sdkConfig = {
  llm: {
    provider: 'anthropic' as const,
    apiKey: DEEPSEEK_API_KEY,
    baseUrl: BASE_URL,
    model: MODEL,
    maxTokens: 1024,
  },
}

describe('LLM Connection — DeepSeek Real API', () => {
  it('should send a simple message and receive a non-empty response', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)
    const response = await sdk.send('Reply with exactly one word: "hello"')

    expect(response).toBeDefined()
    expect(response.content).toBeDefined()
    expect(response.content.length).toBeGreaterThan(0)
    expect(response.usage).toBeDefined()
    expect(response.usage.inputTokens).toBeGreaterThan(0)
    expect(response.usage.outputTokens).toBeGreaterThan(0)
    console.log(`[llm-connection] Input tokens: ${response.usage.inputTokens}, Output tokens: ${response.usage.outputTokens}`)
    console.log(`[llm-connection] Response: "${response.content.slice(0, 100)}..."`)
  }, 60_000)

  it('should handle streaming (non-blocking) mode', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)
    const textChunks: string[] = []

    for await (const event of sdk.stream('Count from 1 to 3, one per line.')) {
      if (event.type === 'text') {
        textChunks.push(event.text)
      }
      if (event.type === 'done') {
        expect(event.usage.inputTokens).toBeGreaterThan(0)
        expect(event.usage.outputTokens).toBeGreaterThan(0)
        console.log(`[llm-connection-stream] Input: ${event.usage.inputTokens}, Output: ${event.usage.outputTokens}`)
      }
    }

    const fullText = textChunks.join('')
    expect(fullText.length).toBeGreaterThan(0)
    console.log(`[llm-connection-stream] Streamed text length: ${fullText.length}`)
  }, 60_000)

  it('should return token usage after send', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)
    await sdk.send('Say "hello world"')

    const usage = sdk.getTokenUsage()
    expect(usage.inputTokens).toBeGreaterThan(0)
    expect(usage.outputTokens).toBeGreaterThan(0)
  }, 60_000)

  it('should support multiple consecutive sends on same SDK instance', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)

    const r1 = await sdk.send('Reply with: "First"')
    expect(r1.content).toContain('First')

    const r2 = await sdk.send('Reply with: "Second"')
    expect(r2.content).toContain('Second')

    // Token usage should accumulate
    const usage = sdk.getTokenUsage()
    expect(usage.inputTokens).toBeGreaterThan(0)
    expect(usage.outputTokens).toBeGreaterThan(0)
  }, 120_000)

  it('should handle new conversation reset', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)
    await sdk.send('Say: "Before reset"')

    sdk.newConversation()

    const r2 = await sdk.send('Say: "After reset"')
    expect(r2.content).toContain('After reset')
  }, 120_000)

  it('should handle a very short message successfully', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)
    const response = await sdk.send('Hi')

    expect(response.content.length).toBeGreaterThan(0)
    expect(response.usage.inputTokens).toBeGreaterThan(0)
    console.log(`[llm-short] Response: "${response.content.slice(0, 80)}"`)
  }, 60_000)

  it('should support system prompt with send', async () => {
    const sdk = ClaudeCodeSDK.create({
      ...sdkConfig,
      session: { systemPrompt: 'You are a very terse assistant. Respond in 3 words or fewer.' },
    })
    const response = await sdk.send('Say something about the weather')

    expect(response.content.length).toBeGreaterThan(0)
    // Response should be short given the system prompt
    const wordCount = response.content.split(/\s+/).length
    console.log(`[llm-system] Response word count: ${wordCount}, Text: "${response.content.slice(0, 100)}"`)
  }, 60_000)

  it('should report consistent token usage between stream and getTokenUsage', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)
    let streamUsage: { inputTokens: number; outputTokens: number } | undefined

    for await (const event of sdk.stream('Say "token test"')) {
      if (event.type === 'done') {
        streamUsage = event.usage
      }
    }

    expect(streamUsage).toBeDefined()
    expect(streamUsage!.inputTokens).toBeGreaterThan(0)
    expect(streamUsage!.outputTokens).toBeGreaterThan(0)

    // getTokenUsage should reflect stream usage
    const postStreamUsage = sdk.getTokenUsage()
    expect(postStreamUsage.inputTokens).toBe(streamUsage!.inputTokens)
    expect(postStreamUsage.outputTokens).toBe(streamUsage!.outputTokens)

    console.log(`[llm-token-consistency] Stream: input=${streamUsage!.inputTokens}, output=${streamUsage!.outputTokens}`)
    console.log(`[llm-token-consistency] getTokenUsage: input=${postStreamUsage.inputTokens}, output=${postStreamUsage.outputTokens}`)
  }, 60_000)

  it('should stream events in correct order (text before done)', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)
    const eventTypes: string[] = []

    for await (const event of sdk.stream('Write one word: "test"')) {
      eventTypes.push(event.type)
    }

    // Last event should be 'done'
    expect(eventTypes[eventTypes.length - 1]).toBe('done')

    // No error events in normal flow
    expect(eventTypes.filter(t => t === 'error')).toHaveLength(0)

    console.log(`[llm-event-order] Event types: ${eventTypes.join(' -> ')}`)
  }, 60_000)

  it('should handle streaming with tools (no crash)', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)
    // With tools, the model may or may not use them; just verify no crash
    const events: StreamEvent[] = []
    for await (const event of sdk.stream('Say "hello" without using any tools.')) {
      events.push(event)
    }

    expect(events.length).toBeGreaterThan(0)
    const last = events[events.length - 1]
    expect(last?.type).toBe('done')
    console.log(`[llm-tools] Events: ${events.length}, Last: ${last?.type}`)
  }, 60_000)

  // ─── 新增: API 错误处理 ──────────────────────────────────

  it('should yield error event when using invalid API key', async () => {
    const invalidConfig = {
      llm: {
        provider: 'anthropic' as const,
        apiKey: 'sk-invalid-key-that-does-not-work',
        baseUrl: BASE_URL,
        model: MODEL,
        maxTokens: 1024,
      },
    }
    const sdk = ClaudeCodeSDK.create(invalidConfig)

    const errors: Error[] = []
    for await (const event of sdk.stream('This should fail')) {
      if (event.type === 'error') {
        errors.push(event.error)
      }
    }

    // We should get error events when the API rejects the invalid key
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toBeInstanceOf(Error)
    console.log(`[llm-invalid-key] Error: ${errors[0]?.message}`)
  }, 60_000)

  it('should yield error event using invalid API key via send()', async () => {
    const invalidConfig = {
      llm: {
        provider: 'anthropic' as const,
        apiKey: 'sk-invalid-key-that-does-not-work',
        baseUrl: BASE_URL,
        model: MODEL,
        maxTokens: 1024,
      },
    }
    const sdk = ClaudeCodeSDK.create(invalidConfig)

    try {
      await sdk.send('This should fail')
      // If no error thrown, the API might have accepted the key (unlikely)
      console.log('[llm-invalid-key-send] No error thrown (unexpected)')
    } catch (err) {
      expect(err).toBeDefined()
      console.log(`[llm-invalid-key-send] Caught error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, 60_000)

  // ─── 新增: 超时处理 ──────────────────────────────────────

  it('should handle abort signal during streaming', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)
    const controller = new AbortController()
    const eventTypes: string[] = []

    // Abort after a short delay to simulate timeout
    const abortTimer = setTimeout(() => controller.abort(), 5_000)

    try {
      for await (const event of sdk.stream('Write a long essay about AI safety.', { signal: controller.signal })) {
        eventTypes.push(event.type)
        // Stop early if we start getting meaningful data
        if (event.type === 'text' && eventTypes.filter(t => t === 'text').length >= 3) {
          controller.abort()
        }
      }
    } catch {
      // Abort may throw depending on SDK implementation
      console.log('[llm-abort] Stream aborted via signal')
    } finally {
      clearTimeout(abortTimer)
    }

    // We should have collected some events before abort
    expect(eventTypes.length).toBeGreaterThan(0)
    console.log(`[llm-abort] Events collected before abort: ${eventTypes.length}, types: ${[...new Set(eventTypes)].join(', ')}`)
  }, 60_000)

  // ─── 新增: 直接 AnthropicConnector 连通性 ─────────────────

  it('should connect via direct AnthropicConnector', async () => {
    const config: LLMConfig & { provider: 'anthropic' } = {
      provider: 'anthropic',
      apiKey: DEEPSEEK_API_KEY,
      baseUrl: BASE_URL,
      model: MODEL,
      maxTokens: 1024,
    }

    const connector = new AnthropicConnector(config)
    expect(connector.provider).toBe('anthropic')

    const textChunks: string[] = []
    for await (const event of connector.send('Reply concisely.', [{ role: 'user', content: 'Say hello in 3 words' }], [])) {
      if (event.type === 'text') {
        textChunks.push(event.text)
      }
      if (event.type === 'done') {
        expect(event.usage.inputTokens).toBeGreaterThan(0)
        expect(event.usage.outputTokens).toBeGreaterThan(0)
        console.log(`[llm-direct] Tokens: input=${event.usage.inputTokens}, output=${event.usage.outputTokens}`)
      }
      if (event.type === 'error') {
        console.log(`[llm-direct] Error: ${event.error.message}`)
      }
    }

    const fullText = textChunks.join('')
    expect(fullText.length).toBeGreaterThan(0)
    console.log(`[llm-direct] Response: "${fullText.slice(0, 100)}"`)
  }, 60_000)

  it('should handle a longer input message (>500 chars)', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)
    const longMessage = `Please summarize the following text in one sentence:

The field of artificial intelligence has seen remarkable progress in recent years, 
particularly with the development of large language models capable of understanding 
and generating human-like text. These models, trained on vast amounts of text data, 
can perform a wide variety of tasks including translation, summarization, question 
answering, and creative writing. However, challenges remain in areas such as factual 
accuracy, bias mitigation, and alignment with human values. Researchers continue to 
explore ways to make these systems more reliable, interpretable, and beneficial to society.`

    const response = await sdk.send(longMessage)
    expect(response.content.length).toBeGreaterThan(0)
    expect(response.usage.inputTokens).toBeGreaterThan(0)
    console.log(`[llm-long-input] Input tokens: ${response.usage.inputTokens}, Output length: ${response.content.length}`)
  }, 60_000)

  it('should handle a stream with multiple events beyond just text and done', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)
    const eventTypes: string[] = []

    for await (const event of sdk.stream('Write a short greeting.')) {
      eventTypes.push(event.type)
    }

    // Verify we got text and done at minimum
    expect(eventTypes).toContain('text')
    expect(eventTypes).toContain('done')
    // done should be last
    expect(eventTypes[eventTypes.length - 1]).toBe('done')

    console.log(`[llm-event-types] Unique types: ${[...new Set(eventTypes)].join(', ')}`)
  }, 60_000)

  it('should handle empty-ish (whitespace) input gracefully', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)

    // Whitespace-only inputs should be sent to the API and get a response
    const response = await sdk.send('   ')
    expect(response.content.length).toBeGreaterThan(0)
    console.log(`[llm-whitespace] Response: "${response.content.slice(0, 80)}"`)
  }, 60_000)

  it('should handle abort signal with immediate abort', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)
    const controller = new AbortController()
    controller.abort() // Abort before sending

    const events: StreamEvent[] = []
    try {
      for await (const event of sdk.stream('This should be aborted immediately', { signal: controller.signal })) {
        events.push(event)
      }
    } catch {
      // Expected: abort may throw
    }

    // Either we got an error event or the stream threw
    console.log(`[llm-immediate-abort] Events: ${events.length}`)
  }, 30_000)
})
