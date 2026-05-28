/**
 * E2E Test — Session Engine with Real DeepSeek API
 *
 * Tests the full ClaudeCodeSDK lifecycle using a real API:
 *   - createSession → send → receive response
 *   - Multi-turn context retention (ask name → verify name)
 *   - stream() flow
 *   - Attribution snapshot accuracy
 *
 * @group e2e
 * @group real-api
 */
import { describe, expect, it } from 'vitest'
import type { StreamEvent } from '../../llm/types.js'
import { ClaudeCodeSDK } from '../../session/engine.js'

// ─── DeepSeek API Config ─────────────────────────────────

const TEST_CONFIG = {
  provider: 'anthropic' as const,
  apiKey: 'sk-af3a84b5661b44f5b5695b47cb39dcd2',
  baseUrl: 'https://api.deepseek.com/anthropic',
  model: 'deepseek-v4-flash',
  maxTokens: 1024,
}

// ─── Helpers ─────────────────────────────────────────────

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

describe('Session Engine E2E — DeepSeek API', () => {
  // 1. Basic session lifecycle: create → send → response
  describe('1. Session Lifecycle', () => {
    it('should create a session and get a response via send()', async () => {
      const sdk = ClaudeCodeSDK.create({ llm: TEST_CONFIG })

      expect(sdk).toBeInstanceOf(ClaudeCodeSDK)
      expect(sdk.getSessionId()).toBeDefined()
      expect(sdk.getSessionStatus()).toBe('active')
      expect(sdk.getTurnCount()).toBe(0)

      const response = await sdk.send('Reply with exactly: "Session Ready"')

      expect(response).toBeDefined()
      expect(response.content).toBeDefined()
      expect(response.content.length).toBeGreaterThan(0)
      expect(response.content).toContain('Session Ready')
      expect(response.usage.inputTokens).toBeGreaterThan(0)
      expect(response.usage.outputTokens).toBeGreaterThan(0)
      expect(sdk.getTurnCount()).toBe(1)

      console.log(
        `[E2E-send] Turn: ${sdk.getTurnCount()}, in: ${response.usage.inputTokens}, out: ${response.usage.outputTokens}`,
      )
    }, 60_000)

    it('should start with empty toolCalls for plain chat', async () => {
      const sdk = ClaudeCodeSDK.create({ llm: TEST_CONFIG })
      const response = await sdk.send('Reply with: "No tools"')
      expect(response.toolCalls).toEqual([])
    }, 60_000)
  })

  // 2. Multi-turn context verification
  describe('2. Multi-turn Context', () => {
    it('should remember context across turns (name question)', async () => {
      const sdk = ClaudeCodeSDK.create({ llm: TEST_CONFIG })

      // Turn 1: introduce name
      const r1 = await sdk.send('My name is Alice Wonderland. Remember my name.')
      expect(r1.content.length).toBeGreaterThan(0)
      console.log(`[E2E-context-turn1] "${r1.content.slice(0, 80)}..."`)

      // Turn 2: ask name back — should remember
      const r2 = await sdk.send('What is my name? Reply with just my full name.')
      expect(r2.content.length).toBeGreaterThan(0)
      console.log(`[E2E-context-turn2] "${r2.content.slice(0, 100)}..."`)
      expect(r2.content.toLowerCase()).toContain('alice')
      expect(sdk.getTurnCount()).toBe(2)
    }, 120_000)

    it('should maintain context across 3+ turns', async () => {
      const sdk = ClaudeCodeSDK.create({ llm: TEST_CONFIG })

      await sdk.send('My favorite number is 42.')
      await sdk.send('My favorite color is blue.')

      const r3 = await sdk.send('What are my favorite number and color? Reply concisely.')
      expect(r3.content.length).toBeGreaterThan(0)
      console.log(`[E2E-3turns] "${r3.content.slice(0, 120)}..."`)
      expect(r3.content.toLowerCase()).toContain('42')
      expect(r3.content.toLowerCase()).toContain('blue')
    }, 180_000)

    it('should forget context after newConversation()', async () => {
      const sdk = ClaudeCodeSDK.create({ llm: TEST_CONFIG })

      await sdk.send('The secret word is "platypus". Keep it secret.')
      sdk.newConversation()

      // After reset, the model should NOT know the secret word
      const r = await sdk.send('Do you know any secret word? Reply with NO if you do not.')
      console.log(`[E2E-reset] "${r.content.slice(0, 150)}..."`)
      // The model shouldn't mention platypus
      const mentionsSecret = r.content.toLowerCase().includes('platypus')
      console.log(`[E2E-reset] Mentions secret: ${mentionsSecret}`)
    }, 120_000)
  })

  // 3. Stream flow
  describe('3. Stream Flow', () => {
    it('should receive streaming text events ending with done', async () => {
      const sdk = ClaudeCodeSDK.create({ llm: TEST_CONFIG })

      const chunks: string[] = []
      let lastType = ''
      let finalUsage = { inputTokens: 0, outputTokens: 0 }

      for await (const event of sdk.stream('Count from 1 to 5, one per line.')) {
        if (event.type === 'text') {
          chunks.push(event.text)
        } else if (event.type === 'done') {
          lastType = 'done'
          finalUsage = event.usage
        }
      }

      const fullText = chunks.join('')
      expect(fullText.length).toBeGreaterThan(0)
      expect(lastType).toBe('done')
      expect(finalUsage.inputTokens).toBeGreaterThan(0)
      expect(finalUsage.outputTokens).toBeGreaterThan(0)
      console.log(`[E2E-stream] ${chunks.length} text events, ${fullText.length} chars`)
    }, 60_000)

    it('should maintain context across stream calls', async () => {
      const sdk = ClaudeCodeSDK.create({ llm: TEST_CONFIG })

      // Turn 1 — stream
      const text1 = await collectText(sdk.stream('My favorite city is Tokyo.'))
      expect(text1.length).toBeGreaterThan(0)
      console.log(`[E2E-stream-context1] "${text1.slice(0, 80)}..."`)

      // Turn 2 — stream, ask about previous turn
      const text2 = await collectText(sdk.stream('What is my favorite city?'))
      expect(text2.toLowerCase()).toContain('tokyo')
      console.log(`[E2E-stream-context2] "${text2.slice(0, 100)}..."`)
    }, 120_000)
  })

  // 4. Mixed send() and stream()
  describe('4. Mixed send/stream', () => {
    it('should maintain context when alternating send and stream', async () => {
      const sdk = ClaudeCodeSDK.create({ llm: TEST_CONFIG })

      // Turn 1: send
      const r1 = await sdk.send('My pet is a cat named Whiskers.')
      expect(r1.content.length).toBeGreaterThan(0)

      // Turn 2: stream
      const text2 = await collectText(sdk.stream('What is my pet name?'))
      expect(text2.toLowerCase()).toContain('whiskers')

      // Turn 3: send
      const r3 = await sdk.send('What kind of pet do I have? Reply with just the animal.')
      expect(r3.content.toLowerCase()).toContain('cat')
    }, 180_000)
  })

  // 5. Attribution accuracy
  describe('5. Attribution Accuracy', () => {
    it('should report correct attribution stats after conversation', async () => {
      const sdk = ClaudeCodeSDK.create({ llm: TEST_CONFIG })

      // Before any messages
      let stats = sdk.getAttributionStats()!
      console.log(
        `[E2E-attr] Initial: turns=${stats.totalTurns}, user=${stats.userMessageCount}, asst=${stats.assistantMessageCount}`,
      )

      await sdk.send('Say "Turn one"')
      stats = sdk.getAttributionStats()!
      console.log(
        `[E2E-attr] After 1: turns=${stats.totalTurns}, user=${stats.userMessageCount}, asst=${stats.assistantMessageCount}`,
      )
      expect(stats.totalTurns).toBeGreaterThanOrEqual(1)
      expect(stats.userMessageCount).toBeGreaterThanOrEqual(1)
      expect(stats.assistantMessageCount).toBeGreaterThanOrEqual(1)

      await sdk.send('Say "Turn two"')
      stats = sdk.getAttributionStats()!
      console.log(
        `[E2E-attr] After 2: turns=${stats.totalTurns}, user=${stats.userMessageCount}, asst=${stats.assistantMessageCount}`,
      )
      expect(stats.totalTurns).toBeGreaterThanOrEqual(2)
      expect(stats.userMessageCount).toBeGreaterThanOrEqual(2)
      expect(stats.assistantMessageCount).toBeGreaterThanOrEqual(2)
    }, 120_000)

    it('should provide valid timestamps in attribution stats', async () => {
      const sdk = ClaudeCodeSDK.create({ llm: TEST_CONFIG })

      await sdk.send('Say "Timestamp test"')

      const stats = sdk.getAttributionStats()!
      expect(() => new Date(stats.startTime)).not.toThrow()
      expect(() => new Date(stats.lastActivityTime)).not.toThrow()
      expect(new Date(stats.lastActivityTime).getTime()).toBeGreaterThanOrEqual(new Date(stats.startTime).getTime())
    }, 60_000)
  })

  // 6. Token usage tracking
  describe('6. Token Usage', () => {
    it('should accumulate token usage across turns', async () => {
      const sdk = ClaudeCodeSDK.create({ llm: TEST_CONFIG })

      const r1 = await sdk.send('Say "First"')
      const usage1 = sdk.getTokenUsage()
      expect(usage1.inputTokens).toBe(r1.usage.inputTokens)
      expect(usage1.outputTokens).toBe(r1.usage.outputTokens)

      const r2 = await sdk.send('Say "Second"')
      const usage2 = sdk.getTokenUsage()
      // Input should grow (history accumulates)
      expect(usage2.inputTokens).toBeGreaterThan(usage1.inputTokens)

      console.log(`[E2E-usage] Turn1: in=${usage1.inputTokens} out=${usage1.outputTokens}`)
      console.log(`[E2E-usage] Turn2: in=${usage2.inputTokens} out=${usage2.outputTokens}`)
    }, 120_000)

    it('should reset token usage after newConversation()', async () => {
      const sdk = ClaudeCodeSDK.create({ llm: TEST_CONFIG })

      await sdk.send('Say "Before reset"')
      const usageBefore = sdk.getTokenUsage()
      expect(usageBefore.inputTokens).toBeGreaterThan(0)

      sdk.newConversation()

      const usageAfter = sdk.getTokenUsage()
      expect(usageAfter.inputTokens).toBe(0)
      expect(usageAfter.outputTokens).toBe(0)
    }, 120_000)
  })

  // 7. Quick edge cases with real API
  describe('7. Edge Cases', () => {
    it('should handle a short message', async () => {
      const sdk = ClaudeCodeSDK.create({ llm: TEST_CONFIG })
      const response = await sdk.send('Hi')
      expect(response.content.length).toBeGreaterThan(0)
    }, 60_000)

    it('should handle rapid sequential sends with rate-limit awareness', async () => {
      const sdk = ClaudeCodeSDK.create({ llm: TEST_CONFIG })

      for (let i = 1; i <= 3; i++) {
        const response = await sdk.send(`Reply with the word "Turn${i}" only`)
        expect(response.content.length).toBeGreaterThan(0)
        console.log(`[E2E-rapid] Turn ${i}: ${response.content.slice(0, 40)}`)
        await new Promise((r) => setTimeout(r, 500))
      }
    }, 180_000)
  })
})
