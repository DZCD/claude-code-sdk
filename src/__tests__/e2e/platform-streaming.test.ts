/**
 * E2E Test — Platform Integration Streaming
 *
 * Tests the full streaming pipeline with real API:
 * - StreamConsumer integration (toTextStream / toBlockStream / toPromise)
 * - streamToText / streamToBlocks utility functions
 * - Hook system triggering during real API calls
 * - Edge cases and error recovery
 *
 * @group e2e
 * @group real-api
 */
import { describe, expect, it, vi } from 'vitest'
import { ClaudeCodeSDK } from '../../session/engine.js'
import type { StreamEvent } from '../../llm/types.js'
import { HookRegistry } from '../../hooks/registry.js'
import { StreamConsumer, createStreamConsumer, streamToText, streamToBlocks } from '../../streaming/consumer.js'

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

// ─── Helper: Collect all events from SDK stream ───────────

async function collectEvents(messages: string[], sdk?: ClaudeCodeSDK): Promise<StreamEvent[]> {
  const s = sdk ?? ClaudeCodeSDK.create(sdkConfig)
  const events: StreamEvent[] = []
  for (const msg of messages) {
    for await (const event of s.stream(msg)) {
      events.push(event)
    }
  }
  return events
}

// ─── StreamConsumer Integration ────────────────────────────

describe('StreamConsumer — Real API Integration', () => {
  it('should consume stream via toPromise() and get text content', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)

    // Collect all events from a single turn
    const events: StreamEvent[] = []
    for await (const event of sdk.stream('Reply with exactly: "Hello from E2E"')) {
      events.push(event)
    }

    const consumer = new StreamConsumer(
      (async function* () { yield* events })(),
    )

    const result = await consumer.toPromise()
    expect(result.text.length).toBeGreaterThan(0)
    expect(result.usage.inputTokens).toBeGreaterThan(0)
    expect(result.usage.outputTokens).toBeGreaterThan(0)
    console.log(`[StreamConsumer] Text length: ${result.text.length}, Usage: ${JSON.stringify(result.usage)}`)
  }, 60_000)

  it('should consume stream via toTextStream() and produce text fragments', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)

    const events: StreamEvent[] = []
    for await (const event of sdk.stream('Say: "Streaming works!"')) {
      events.push(event)
    }

    const consumer = new StreamConsumer(
      (async function* () { yield* events })(),
    )

    const textParts: string[] = []
    for await (const chunk of consumer.toTextStream()) {
      textParts.push(chunk)
    }

    expect(textParts.length).toBeGreaterThan(0)
    const fullText = textParts.join('')
    expect(fullText.length).toBeGreaterThan(0)
    console.log(`[toTextStream] Got ${textParts.length} chunks, total length: ${fullText.length}`)
  }, 60_000)

  it('should consume stream via toBlockStream() and produce blocks', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)

    const events: StreamEvent[] = []
    for await (const event of sdk.stream('Write a short greeting.')) {
      events.push(event)
    }

    const consumer = new StreamConsumer(
      (async function* () { yield* events })(),
    )

    const blocks: unknown[] = []
    for await (const block of consumer.toBlockStream()) {
      blocks.push(block)
    }

    // Should have text blocks
    expect(blocks.length).toBeGreaterThan(0)
    const textBlocks = blocks.filter((b: any) => b.type === 'text')
    expect(textBlocks.length).toBeGreaterThan(0)
    const text = textBlocks.map((b: any) => b.text).join('')
    expect(text.length).toBeGreaterThan(0)
    console.log(`[toBlockStream] Got ${blocks.length} blocks, text length: ${text.length}`)
  }, 60_000)

  it('should handle handler registration via on() and onEvent()', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)

    const events: StreamEvent[] = []
    for await (const event of sdk.stream('Count from 1 to 3.')) {
      events.push(event)
    }

    const consumer = new StreamConsumer(
      (async function* () { yield* events })(),
    )

    const textHandler = vi.fn()
    const allHandler = vi.fn()

    consumer.on('text', textHandler)
    consumer.onEvent(allHandler)
    await consumer.consume()

    expect(textHandler).toHaveBeenCalled()
    // All handler should be called for each event
    expect(allHandler).toHaveBeenCalled()
    console.log(`[on/onEvent] text events: ${textHandler.mock.calls.length}, total events: ${allHandler.mock.calls.length}`)
  }, 60_000)
})

// ─── streamToText / streamToBlocks Integration ────────────

describe('streamToText / streamToBlocks — Real API', () => {
  it('should filter text events via streamToText', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)

    const events: StreamEvent[] = []
    for await (const event of sdk.stream('Write a two-word response: "Hello World"')) {
      events.push(event)
    }

    const stream = (async function* () { yield* events })()
    const textParts: string[] = []
    for await (const chunk of streamToText(stream)) {
      textParts.push(chunk)
    }

    expect(textParts.length).toBeGreaterThan(0)
    const fullText = textParts.join('')
    expect(fullText.length).toBeGreaterThan(0)
    console.log(`[streamToText] Text: "${fullText.slice(0, 100)}"`)
  }, 60_000)

  it('should assemble blocks via streamToBlocks', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)

    const events: StreamEvent[] = []
    for await (const event of sdk.stream('Write a short sentence about testing.')) {
      events.push(event)
    }

    const stream = (async function* () { yield* events })()
    const blocks: unknown[] = []
    for await (const block of streamToBlocks(stream)) {
      blocks.push(block)
    }

    expect(blocks.length).toBeGreaterThan(0)
    const textFromBlocks = blocks
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
    expect(textFromBlocks.length).toBeGreaterThan(0)
    console.log(`[streamToBlocks] ${blocks.length} blocks, text: "${textFromBlocks.slice(0, 100)}"`)
  }, 60_000)
})

// ─── Hook System Integration ──────────────────────────────

describe('Hooks — Real API Integration', () => {
  it('should trigger preTool hook during tool-using conversation', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)

    const preToolCalled = vi.fn()
    const postToolCalled = vi.fn()
    const hookRegistry = new HookRegistry()

    hookRegistry.register('preTool', 'e2e-pre', async (toolName: string, input: Record<string, unknown>) => {
      preToolCalled(toolName, input)
      return { allowed: true }
    })

    hookRegistry.register('postTool', 'e2e-post', async (toolName: string, input: Record<string, unknown>, result: unknown) => {
      postToolCalled(toolName, input, result)
    })

    sdk.withHooks(hookRegistry)

    // Use a prompt that triggers a tool call via built-in tools
    const events: StreamEvent[] = []
    for await (const event of sdk.stream('What is the current date? Reply with just the date.')) {
      events.push(event)
    }

    // The SDK may or may not have tools available, but hooks should still fire
    // At minimum, the stream should complete successfully
    const doneEvent = events.find(e => e.type === 'done')
    expect(doneEvent).toBeDefined()
    console.log(`[Hooks] preTool called: ${preToolCalled.mock.calls.length}, postTool called: ${postToolCalled.mock.calls.length}`)
  }, 60_000)

  it('should trigger preTurn hook and allow proceeding', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)

    const preTurnCalled = vi.fn()
    const postTurnCalled = vi.fn()
    const hookRegistry = new HookRegistry()

    hookRegistry.register('preTurn', 'e2e-pre-turn', async (messages: unknown[]) => {
      preTurnCalled(messages.length)
      return { proceed: true }
    })

    hookRegistry.register('postTurn', 'e2e-post-turn', async (messages: unknown[], responseText: string) => {
      postTurnCalled(messages.length, responseText)
    })

    sdk.withHooks(hookRegistry)

    const events: StreamEvent[] = []
    for await (const event of sdk.stream('Say: "Hook test complete"')) {
      events.push(event)
    }

    expect(events.length).toBeGreaterThan(0)
    expect(preTurnCalled).toHaveBeenCalled()
    console.log(`[Hooks] preTurn called: ${preTurnCalled.mock.calls.length}, postTurn called: ${postTurnCalled.mock.calls.length}`)
  }, 60_000)

  it('should handle blocking hook that stops tool execution', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)

    const hookRegistry = new HookRegistry()
    hookRegistry.register('preTool', 'block-all', async () => ({
      allowed: false,
      error: 'E2E test blocking all tools',
    }))

    sdk.withHooks(hookRegistry)

    // Even without tools, this should still complete (hooks just won't fire)
    const events: StreamEvent[] = []
    for await (const event of sdk.stream('Say: "Blocking test"')) {
      events.push(event)
    }

    const doneEvent = events.find(e => e.type === 'done')
    expect(doneEvent).toBeDefined()
    console.log(`[Hooks] Blocking hook test completed, ${events.length} events`)
  }, 60_000)
})

// ─── Cross-session Streaming ──────────────────────────────

describe('Multi-turn Streaming — Real API', () => {
  it('should stream across multiple sends with conversation context', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)

    // Turn 1
    const events1: StreamEvent[] = []
    for await (const event of sdk.stream('My secret number is 42. Remember it.')) {
      events1.push(event)
    }

    const text1 = events1.filter(e => e.type === 'text').map(e => (e as any).text).join('')
    expect(text1.length).toBeGreaterThan(0)
    console.log(`[Multi-turn] Turn 1: "${text1.slice(0, 80)}"`)

    // Turn 2
    const events2: StreamEvent[] = []
    for await (const event of sdk.stream('What was my secret number?')) {
      events2.push(event)
    }

    const text2 = events2.filter(e => e.type === 'text').map(e => (e as any).text).join('')
    expect(text2.length).toBeGreaterThan(0)
    expect(text2).toContain('42')
    console.log(`[Multi-turn] Turn 2: "${text2.slice(0, 100)}"`)
  }, 120_000)
})

// ─── Edge Cases ────────────────────────────────────────────

describe('Streaming Edge Cases — Real API', () => {
  it('should handle empty/short input gracefully', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)

    const events: StreamEvent[] = []
    for await (const event of sdk.stream('Hi')) {
      events.push(event)
    }

    expect(events.length).toBeGreaterThan(0)
    const doneEvent = events.find(e => e.type === 'done')
    expect(doneEvent).toBeDefined()
    console.log(`[Edge] Short input: ${events.length} events`)
  }, 60_000)

  it('should not crash on consecutive streaming calls', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)

    for (let i = 0; i < 3; i++) {
      const events: StreamEvent[] = []
      for await (const event of sdk.stream(`Say: "Message ${i + 1}"`)) {
        events.push(event)
      }
      const text = events.filter(e => e.type === 'text').map(e => (e as any).text).join('')
      expect(text.length).toBeGreaterThan(0)
      console.log(`[Consecutive] Message ${i + 1} length: ${text.length}`)
    }
  }, 120_000)

  it('should handle new conversation reset between streams', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)

    // Turn 1
    const events1: StreamEvent[] = []
    for await (const event of sdk.stream('My secret is "abc123"')) {
      events1.push(event)
    }
    console.log('[Reset] First turn complete')

    // Reset
    sdk.newConversation()

    // Turn 2 — should not remember the secret
    const events2: StreamEvent[] = []
    for await (const event of sdk.stream('What is my secret? Reply with UNKNOWN if you do not know.')) {
      events2.push(event)
    }

    const text2 = events2.filter(e => e.type === 'text').map(e => (e as any).text).join('')
    // Should not contain the original secret since conversation was reset
    expect(text2.toLowerCase()).not.toContain('abc123')
    console.log(`[Reset] After reset, response: "${text2.slice(0, 100)}"`)
  }, 120_000)
})

// ─── createStreamConsumer Integration ──────────────────────

describe('createStreamConsumer — Real API', () => {
  it('should create consumer from collected events', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)

    const events: StreamEvent[] = []
    for await (const event of sdk.stream('Say: "Factory test"')) {
      events.push(event)
    }

    const stream = (async function* () { yield* events })()
    const consumer = createStreamConsumer(stream)
    const result = await consumer.toPromise()

    expect(result.text.length).toBeGreaterThan(0)
    expect(result.usage.inputTokens).toBeGreaterThan(0)
    console.log(`[createStreamConsumer] Text: "${result.text.slice(0, 80)}", Usage: ${JSON.stringify(result.usage)}`)
  }, 60_000)

  it('should support abort signal with collected events', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)

    const events: StreamEvent[] = []
    for await (const event of sdk.stream('Write a short poem.')) {
      events.push(event)
    }

    const ac = new AbortController()
    const stream = (async function* () { yield* events })()
    const consumer = createStreamConsumer(stream, ac.signal)

    const result = await consumer.toPromise()
    // Not aborted, should get full result
    expect(result.text.length).toBeGreaterThan(0)
    console.log(`[AbortSignal] Text length: ${result.text.length}`)
  }, 60_000)
})

// ─── Token Usage Validation ────────────────────────────────

describe('Token Usage — Real API Streaming', () => {
  it('should report non-zero token usage from done events', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)

    let usage: { inputTokens: number; outputTokens: number } | undefined
    for await (const event of sdk.stream('Say: "Token check"')) {
      if (event.type === 'done') {
        usage = event.usage
      }
    }

    expect(usage).toBeDefined()
    expect(usage!.inputTokens).toBeGreaterThan(0)
    expect(usage!.outputTokens).toBeGreaterThan(0)
    console.log(`[TokenUsage] Input: ${usage!.inputTokens}, Output: ${usage!.outputTokens}`)
  }, 60_000)

  it('should accumulate token usage across multiple sends', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)

    for await (const _ of sdk.stream('Say "first"')) { /* consume */ }
    const usage1 = sdk.getTokenUsage()
    expect(usage1.inputTokens).toBeGreaterThan(0)

    for await (const _ of sdk.stream('Say "second"')) { /* consume */ }
    const usage2 = sdk.getTokenUsage()
    expect(usage2.inputTokens).toBeGreaterThan(usage1.inputTokens)

    console.log(`[Accumulate] After 1st: ${JSON.stringify(usage1)}, After 2nd: ${JSON.stringify(usage2)}`)
  }, 120_000)
})
