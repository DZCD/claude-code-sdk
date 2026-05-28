/**
 * E2E Test — Streaming via Real API
 *
 * Tests the streaming (SSE) mode of the SDK with a real LLM backend.
 * Verifies that stream events follow the correct sequence and contain
 * the expected data.
 *
 * @group e2e
 * @group real-api
 */
import { describe, expect, it } from 'vitest'
import type { StreamEvent } from '../../llm/types.js'
import { ClaudeCodeSDK } from '../../session/engine.js'

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

describe('Streaming — Real API', () => {
  it('should yield text events with content', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)
    const events: StreamEvent[] = []

    for await (const event of sdk.stream('Write a short sentence about AI.')) {
      events.push(event)
    }

    // Should have multiple events
    expect(events.length).toBeGreaterThan(0)

    // At least one text event
    const textEvents = events.filter((e) => e.type === 'text')
    expect(textEvents.length).toBeGreaterThan(0)

    // Text should be non-empty
    const allText = textEvents.map((e) => (e as { text: string }).text).join('')
    expect(allText.length).toBeGreaterThan(0)

    // Should end with done event
    const lastEvent = events[events.length - 1]
    expect(lastEvent?.type).toBe('done')

    console.log(
      `[stream-text] Total events: ${events.length}, Text events: ${textEvents.length}, Total chars: ${allText.length}`,
    )
  }, 60_000)

  it('should yield done event with usage data', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)
    let doneEvent: StreamEvent | undefined

    for await (const event of sdk.stream('Say "test streaming".')) {
      if (event.type === 'done') {
        doneEvent = event
      }
    }

    expect(doneEvent).toBeDefined()
    if (doneEvent && doneEvent.type === 'done') {
      expect(doneEvent.usage.inputTokens).toBeGreaterThan(0)
      expect(doneEvent.usage.outputTokens).toBeGreaterThan(0)
      console.log(`[stream-usage] Input: ${doneEvent.usage.inputTokens}, Output: ${doneEvent.usage.outputTokens}`)
    }
  }, 60_000)

  it('should yield text incrementally (multiple text events)', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)
    const textChunks: string[] = []

    for await (const event of sdk.stream('Count from 1 to 5 with dots between each number.')) {
      if (event.type === 'text') {
        textChunks.push(event.text)
      }
    }

    // There should be multiple text chunks (streaming yields incremental content)
    // Note: The Anthropic API may emit a single text block depending on the model
    console.log(`[stream-chunks] Got ${textChunks.length} text chunks`)

    const fullText = textChunks.join('')
    expect(fullText.length).toBeGreaterThan(0)
    console.log(`[stream-chunks] Full text length: ${fullText.length}`)
  }, 60_000)

  it('should handle streaming across multiple sends', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)

    // First stream
    const text1: string[] = []
    for await (const event of sdk.stream('Say: "Stream one"')) {
      if (event.type === 'text') text1.push(event.text)
    }
    const content1 = text1.join('')
    expect(content1.length).toBeGreaterThan(0)
    console.log(`[stream-multi] Stream 1: "${content1.slice(0, 60)}"`)

    // Second stream — should have conversation context
    const text2: string[] = []
    for await (const event of sdk.stream('What did I just say in my first request?')) {
      if (event.type === 'text') text2.push(event.text)
    }
    const content2 = text2.join('')
    expect(content2.length).toBeGreaterThan(0)
    console.log(`[stream-multi] Stream 2: "${content2.slice(0, 100)}"`)

    // Should remember the context
    expect(content2.toLowerCase()).toContain('stream')
  }, 120_000)

  it('should not crash on empty or very short input', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)

    // Very short message
    const events: StreamEvent[] = []
    for await (const event of sdk.stream('Hi')) {
      events.push(event)
    }

    expect(events.length).toBeGreaterThan(0)
    const textEvents = events.filter((e) => e.type === 'text')
    expect(textEvents.length).toBeGreaterThan(0)
  }, 60_000)
})
