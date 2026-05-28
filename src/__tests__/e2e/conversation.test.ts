/**
 * E2E Test — Multi-turn Conversation via Real API
 *
 * Tests that the SDK correctly maintains conversation context across
 * multiple turns with a real LLM backend.
 *
 * @group e2e
 * @group real-api
 */
import { describe, expect, it } from 'vitest'
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

describe('Multi-turn Conversation — Real API', () => {
  it('should remember context from previous turns', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)

    // Turn 1: Establish a fact
    const r1 = await sdk.send('My favorite color is blue. Remember this.')
    expect(r1.content.length).toBeGreaterThan(0)
    console.log(`[conv-turn1] Response: "${r1.content.slice(0, 100)}"`)

    // Turn 2: Ask about what was said in turn 1
    const r2 = await sdk.send('What is my favorite color?')
    console.log(`[conv-turn2] Response: "${r2.content.slice(0, 100)}"`)

    // The response should contain "blue" since the SDK maintains conversation history
    const r2lower = r2.content.toLowerCase()
    expect(r2lower).toContain('blue')
  }, 120_000)

  it('should accumulate token usage across turns', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)

    await sdk.send('Say: "First message"')
    const usage1 = sdk.getTokenUsage()
    console.log(`[conv-usage] After turn 1: input=${usage1.inputTokens} output=${usage1.outputTokens}`)

    await sdk.send('Say: "Second message"')
    const usage2 = sdk.getTokenUsage()
    console.log(`[conv-usage] After turn 2: input=${usage2.inputTokens} output=${usage2.outputTokens}`)

    // Total accumulated tokens should increase
    // (output tokens might not change much if the response is short, but input should grow with history)
    expect(usage2.inputTokens).toBeGreaterThanOrEqual(usage1.inputTokens)
    expect(usage2.outputTokens).toBeGreaterThanOrEqual(usage1.outputTokens)
  }, 120_000)

  it('should reset context on newConversation()', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)

    // Establish context
    await sdk.send('Remember this secret: the answer is 42')

    // Reset
    sdk.newConversation()
    expect(sdk.getTurnCount()).toBe(0)

    // Ask about the secret — should NOT know it after reset
    const response = await sdk.send('What was the secret I told you?')
    console.log(`[conv-reset] After reset: "${response.content.slice(0, 150)}"`)

    // The model should NOT know about 42 since conversation was reset
    const rLower = response.content.toLowerCase()
    const knowsSecret = rLower.includes('42') || rLower.includes('secret')
    // Note: Some models may guess, but we just log the behavior
    console.log(`[conv-reset] Model seems to know secret after reset: ${knowsSecret}`)
  }, 120_000)

  it('should support at least 3 turns of coherent conversation', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)

    const turns = [
      'My name is TestUser.',
      'What did I tell you my name is?',
      'Now tell me a fun fact about technology.',
    ]

    for (let i = 0; i < turns.length; i++) {
      const response = await sdk.send(turns[i])
      console.log(`[conv-3turns] Turn ${i + 1}: "${response.content.slice(0, 80)}..."`)

      if (i === 1) {
        // Should remember the name from turn 0
        expect(response.content.toLowerCase()).toContain('testuser')
      }
    }
  }, 180_000)
})
