/**
 * E2E Test — Session Conversation Lifecycle via Real API
 *
 * ClaudeCodeSDK 完整生命周期测试：
 *   - create → send → stream → reset
 *   - 多轮对话上下文保持
 *   - send 与 stream 混合使用
 *   - newConversation() 重置
 *   - token usage 累积跟踪
 *   - Attribution 统计跟踪
 *
 * @group e2e
 * @group real-api
 */
import { describe, expect, it } from 'vitest'
import { ClaudeCodeSDK } from '../../session/engine.js'
import type { StreamEvent } from '../../llm/types.js'

// ─── Shared Config ───────────────────────────────────────

const API_KEY = 'sk-af3a84b5661b44f5b5695b47cb39dcd2'
const BASE_URL = 'https://api.deepseek.com/anthropic'
const MODEL = 'deepseek-v4-flash'

const sdkConfig = {
  llm: {
    provider: 'anthropic' as const,
    apiKey: API_KEY,
    baseUrl: BASE_URL,
    model: MODEL,
    maxTokens: 1024,
  },
}

// ─── Helpers ─────────────────────────────────────────────

/** Collect all events from a stream into an array */
async function collectEvents(iterable: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = []
  for await (const event of iterable) {
    events.push(event)
  }
  return events
}

/** Collect just the text content from a stream */
async function collectText(iterable: AsyncIterable<StreamEvent>): Promise<string> {
  const chunks: string[] = []
  for await (const event of iterable) {
    if (event.type === 'text') {
      chunks.push(event.text)
    }
  }
  return chunks.join('')
}

// ─── Tests ───────────────────────────────────────────────

describe('Session — Full Lifecycle (Real API)', () => {
  // ─── 1. Basic Send ─────────────────────────────────

  describe('1. Basic send()', () => {
    it('should create SDK and receive a text response', async () => {
      const sdk = ClaudeCodeSDK.create(sdkConfig)
      expect(sdk).toBeInstanceOf(ClaudeCodeSDK)
      expect(sdk.getSessionId()).toBeDefined()
      expect(sdk.getSessionStatus()).toBe('active')
      expect(sdk.getTurnCount()).toBe(0)

      const response = await sdk.send('Reply with exactly: "Hello World"')
      expect(response.content).toBeDefined()
      expect(response.content.length).toBeGreaterThan(0)
      expect(response.content).toContain('Hello World')
      expect(response.usage.inputTokens).toBeGreaterThan(0)
      expect(response.usage.outputTokens).toBeGreaterThan(0)
      expect(sdk.getTurnCount()).toBe(1)

      console.log(`[send-basic] Turn: ${sdk.getTurnCount()}, Tokens in: ${response.usage.inputTokens}, out: ${response.usage.outputTokens}`)
    }, 60_000)

    it('should return empty toolCalls for plain text exchange', async () => {
      const sdk = ClaudeCodeSDK.create(sdkConfig)
      const response = await sdk.send('Reply with: "No tools needed"')
      expect(response.toolCalls).toEqual([])
    }, 60_000)

    it('should track token usage via getTokenUsage()', async () => {
      const sdk = ClaudeCodeSDK.create(sdkConfig)
      const r1 = await sdk.send('Say: "First"')
      const usage1 = sdk.getTokenUsage()
      expect(usage1.inputTokens).toBe(r1.usage.inputTokens)
      expect(usage1.outputTokens).toBe(r1.usage.outputTokens)

      const r2 = await sdk.send('Say: "Second"')
      const usage2 = sdk.getTokenUsage()
      // Accumulated input should be larger (history grows)
      expect(usage2.inputTokens).toBeGreaterThan(usage1.inputTokens)
      expect(usage2.outputTokens).toBeGreaterThanOrEqual(usage1.outputTokens)

      console.log(`[token-accum] After turn1: in=${usage1.inputTokens} out=${usage1.outputTokens}`)
      console.log(`[token-accum] After turn2: in=${usage2.inputTokens} out=${usage2.outputTokens}`)
    }, 120_000)
  })

  // ─── 2. Streaming ──────────────────────────────────

  describe('2. stream()', () => {
    it('should yield text events ending with done', async () => {
      const sdk = ClaudeCodeSDK.create(sdkConfig)
      const events = await collectEvents(sdk.stream('Count from 1 to 3, one per line.'))

      expect(events.length).toBeGreaterThan(0)
      const textEvents = events.filter(e => e.type === 'text')
      expect(textEvents.length).toBeGreaterThan(0)

      const fullText = textEvents.map(e => (e as { text: string }).text).join('')
      expect(fullText.length).toBeGreaterThan(0)

      // Must end with done
      const lastEvent = events[events.length - 1]
      expect(lastEvent?.type).toBe('done')
      if (lastEvent?.type === 'done') {
        expect(lastEvent.usage.inputTokens).toBeGreaterThan(0)
        expect(lastEvent.usage.outputTokens).toBeGreaterThan(0)
      }

      console.log(`[stream-basic] ${textEvents.length} text events, ${fullText.length} chars total`)
    }, 60_000)

    it('should retain conversation context across stream calls', async () => {
      const sdk = ClaudeCodeSDK.create(sdkConfig)

      // Turn 1 — stream
      const text1 = await collectText(sdk.stream('My favorite color is red. Remember this.'))
      expect(text1.length).toBeGreaterThan(0)
      console.log(`[stream-context-turn1] "${text1.slice(0, 80)}..."`)

      // Turn 2 — stream, ask about previous turn
      const text2 = await collectText(sdk.stream('What is my favorite color?'))
      expect(text2.toLowerCase()).toContain('red')
      console.log(`[stream-context-turn2] "${text2.slice(0, 100)}..."`)
    }, 120_000)
  })

  // ─── 3. Mixed send & stream ─────────────────────────

  describe('3. Mixed send() and stream()', () => {
    it('should maintain context when alternating send and stream', async () => {
      const sdk = ClaudeCodeSDK.create(sdkConfig)

      // Turn 1: send
      const r1 = await sdk.send('My pet is a dog named Buddy.')
      expect(r1.content.length).toBeGreaterThan(0)
      console.log(`[mixed-turn1-send] "${r1.content.slice(0, 80)}..."`)

      // Turn 2: stream
      const text2 = await collectText(sdk.stream('What is the name of my pet?'))
      expect(text2.toLowerCase()).toContain('buddy')
      console.log(`[mixed-turn2-stream] "${text2.slice(0, 100)}..."`)

      // Turn 3: send again
      const r3 = await sdk.send('What kind of pet do I have?')
      expect(r3.content.toLowerCase()).toContain('dog')
      console.log(`[mixed-turn3-send] "${r3.content.slice(0, 80)}..."`)
    }, 180_000)
  })

  // ─── 4. Multi-turn context retention ────────────────

  describe('4. Multi-turn context retention', () => {
    it('should remember context across 3+ turns', async () => {
      const sdk = ClaudeCodeSDK.create(sdkConfig)

      const turns = [
        'My name is Alice.',
        'What is my name?',
        'Tell me a fun fact about space.',
      ]

      for (let i = 0; i < turns.length; i++) {
        const response = await sdk.send(turns[i])
        expect(response.content.length).toBeGreaterThan(0)
        console.log(`[3turns] Turn ${i + 1}: "${response.content.slice(0, 80)}..."`)

        // Turn 2 should remember the name
        if (i === 1) {
          expect(response.content.toLowerCase()).toContain('alice')
        }
      }
    }, 180_000)

    it('should accumulate attribution stats', async () => {
      const sdk = ClaudeCodeSDK.create(sdkConfig)

      // Initially zero
      let stats = sdk.getAttributionStats()!
      console.log(`[attr-stats] Initial: turns=${stats.totalTurns}, user=${stats.userMessageCount}, asst=${stats.assistantMessageCount}`)

      await sdk.send('Say "One"')
      stats = sdk.getAttributionStats()!
      console.log(`[attr-stats] After turn 1: turns=${stats.totalTurns}, user=${stats.userMessageCount}, asst=${stats.assistantMessageCount}`)
      expect(stats.totalTurns).toBeGreaterThanOrEqual(1)
      expect(stats.userMessageCount).toBeGreaterThanOrEqual(1)
      expect(stats.assistantMessageCount).toBeGreaterThanOrEqual(1)

      await sdk.send('Say "Two"')
      stats = sdk.getAttributionStats()!
      console.log(`[attr-stats] After turn 2: turns=${stats.totalTurns}, user=${stats.userMessageCount}, asst=${stats.assistantMessageCount}`)
      expect(stats.totalTurns).toBeGreaterThanOrEqual(2)
    }, 120_000)
  })

  // ─── 5. Conversation Reset ──────────────────────────

  describe('5. Conversation reset', () => {
    it('should forget context after newConversation()', async () => {
      const sdk = ClaudeCodeSDK.create(sdkConfig)

      // Establish context
      await sdk.send('The secret number is 42. Remember this.')
      expect(sdk.getTurnCount()).toBe(1)

      // Reset
      sdk.newConversation()
      expect(sdk.getTurnCount()).toBe(0)
      expect(sdk.getHistory()).toEqual([])

      // Ask about the secret — should NOT know it
      const response = await sdk.send('Do you know any secret number?')
      console.log(`[reset] After newConversation: "${response.content.slice(0, 150)}..."`)
      // The model should have no memory of 42
      // (Note: some models might guess common numbers)
      const knowsSecret = response.content.includes('42')
      console.log(`[reset] Model mentions 42: ${knowsSecret}`)
    }, 120_000)

    it('should reset token usage after newConversation()', async () => {
      const sdk = ClaudeCodeSDK.create(sdkConfig)

      await sdk.send('Say "Before reset"')
      const usageBefore = sdk.getTokenUsage()
      console.log(`[reset-usage] Before: in=${usageBefore.inputTokens} out=${usageBefore.outputTokens}`)

      sdk.newConversation()

      // Token usage should reset BUT the ConversationManager creates a new instance
      // The SDK's getTokenUsage delegates to the conversation manager
      const usageAfterReset = sdk.getTokenUsage()
      console.log(`[reset-usage] After reset: in=${usageAfterReset.inputTokens} out=${usageAfterReset.outputTokens}`)
      expect(usageAfterReset.inputTokens).toBe(0)
      expect(usageAfterReset.outputTokens).toBe(0)
    }, 120_000)

    it('should continue working after newConversation()', async () => {
      const sdk = ClaudeCodeSDK.create(sdkConfig)

      await sdk.send('Say "First session"')
      sdk.newConversation()
      const r2 = await sdk.send('Say "Second session"')
      expect(r2.content).toContain('Second session')

      // Turn count should be relative to new conversation
      expect(sdk.getTurnCount()).toBe(1)
    }, 120_000)

    it('should also reset via resetConversation()', async () => {
      const sdk = ClaudeCodeSDK.create(sdkConfig)

      await sdk.send('Message before reset')
      expect(sdk.getHistory().length).toBeGreaterThan(0)

      sdk.resetConversation()
      expect(sdk.getHistory()).toEqual([])
      expect(sdk.getTurnCount()).toBe(0)

      // Verify it still works
      const r = await sdk.send('Message after reset')
      expect(r.content.length).toBeGreaterThan(0)
    }, 120_000)
  })

  // ─── 6. Session info & attribution ─────────────────

  describe('6. Session metadata & attribution', () => {
    it('should provide session ID and status', async () => {
      const sdk = ClaudeCodeSDK.create(sdkConfig)
      expect(sdk.getSessionId()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      )
      expect(sdk.getSessionStatus()).toBe('active')
    })

    it('should generate attribution texts', async () => {
      const sdk = ClaudeCodeSDK.create(sdkConfig)
      const texts = sdk.getAttributionTexts()
      expect(texts.commit).toContain('Co-Authored-By')
      expect(texts.pr).toContain('Claude Code')
    })

    it('should generate non-empty attribution stats after conversation', async () => {
      const sdk = ClaudeCodeSDK.create(sdkConfig)
      await sdk.send('Say "Attribution test"')

      const stats = sdk.getAttributionStats()!
      expect(stats.totalTurns).toBeGreaterThanOrEqual(1)
      expect(stats.userMessageCount).toBeGreaterThanOrEqual(1)
      expect(stats.assistantMessageCount).toBeGreaterThanOrEqual(1)
      expect(stats.startTime).toBeDefined()
      expect(stats.lastActivityTime).toBeDefined()
      // Ensure timestamps are valid
      expect(() => new Date(stats.startTime)).not.toThrow()
      expect(() => new Date(stats.lastActivityTime)).not.toThrow()
      console.log(`[attr-e2e] Turns: ${stats.totalTurns}, User: ${stats.userMessageCount}, Asst: ${stats.assistantMessageCount}`)
    }, 60_000)
  })

  // ─── 7. Edge cases with real API ───────────────────

  describe('7. Edge cases', () => {
    it('should handle empty-ish message gracefully', async () => {
      const sdk = ClaudeCodeSDK.create(sdkConfig)
      const response = await sdk.send('Hi')
      expect(response.content.length).toBeGreaterThan(0)
      expect(response.usage.inputTokens).toBeGreaterThan(0)
    }, 60_000)

    it('should handle a short stream', async () => {
      const sdk = ClaudeCodeSDK.create(sdkConfig)
      const events = await collectEvents(sdk.stream('OK'))
      expect(events.length).toBeGreaterThan(0)
      const last = events[events.length - 1]
      expect(last?.type).toBe('done')
    }, 60_000)

    it('should handle rapid sequential sends (rate-limit aware)', async () => {
      const sdk = ClaudeCodeSDK.create(sdkConfig)

      // Three quick sends in sequence with simple prompts
      for (let i = 1; i <= 3; i++) {
        const response = await sdk.send(`Reply with the word "Turn${i}" only`)
        // The model might not always follow exact instruction, but should respond
        expect(response.content.length).toBeGreaterThan(0)
        console.log(`[rapid] Turn ${i}: ${response.content.slice(0, 40)}`)
        // Small delay to avoid rate limit
        await new Promise(r => setTimeout(r, 500))
      }
    }, 180_000)
  })
})
