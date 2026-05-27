/**
 * Tests — TokenTracker
 *
 * Token usage extraction, estimation, and tracking.
 */
import { describe, expect, it } from 'vitest'
import type { Message } from '../../types/message.js'
import { createAssistantMessage, createToolResultMessage, createUserMessage } from '../../types/message.js'
import {
  TokenTracker,
  estimateContextTokens,
  getContextSizeFromLastResponse,
  getCurrentUsage,
  getOutputTokensFromLastResponse,
  getTokenUsageFromMessage,
  getTotalTokensFromUsage,
} from '../token-tracker.js'

type TestUsage = {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
}

function createAssistantWithUsage(usage: TestUsage): Message {
  return {
    ...createAssistantMessage('test'),
    usage,
  } as Message
}

function createAssistantWithoutUsage(): Message {
  return createAssistantMessage('test')
}

describe('getTokenUsageFromMessage', () => {
  it('should extract usage from assistant message with usage', () => {
    const msg = createAssistantWithUsage({
      inputTokens: 100,
      outputTokens: 50,
    })
    const usage = getTokenUsageFromMessage(msg)
    expect(usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    })
  })

  it('should return undefined for assistant message without usage', () => {
    const usage = getTokenUsageFromMessage(createAssistantWithoutUsage())
    expect(usage).toBeUndefined()
  })

  it('should return undefined for user message', () => {
    const usage = getTokenUsageFromMessage(createUserMessage('hi'))
    expect(usage).toBeUndefined()
  })

  it('should include cache tokens when present', () => {
    const msg = createAssistantWithUsage({
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationInputTokens: 200,
      cacheReadInputTokens: 30,
    })
    const usage = getTokenUsageFromMessage(msg)
    expect(usage?.cacheCreationInputTokens).toBe(200)
    expect(usage?.cacheReadInputTokens).toBe(30)
  })
})

describe('getTotalTokensFromUsage', () => {
  it('should sum all token types', () => {
    const total = getTotalTokensFromUsage({
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationInputTokens: 200,
      cacheReadInputTokens: 30,
    })
    expect(total).toBe(380)
  })

  it('should handle zero cache tokens', () => {
    const total = getTotalTokensFromUsage({
      inputTokens: 100,
      outputTokens: 50,
    })
    expect(total).toBe(150)
  })
})

describe('getContextSizeFromLastResponse', () => {
  it('should get context size from last assistant with usage', () => {
    const messages: Message[] = [
      createUserMessage('hi'),
      createAssistantWithUsage({
        inputTokens: 200,
        outputTokens: 50,
        cacheCreationInputTokens: 100,
        cacheReadInputTokens: 20,
      }),
    ]
    const size = getContextSizeFromLastResponse(messages)
    expect(size).toBe(370)
  })

  it('should return 0 when no usage-bearing messages', () => {
    const messages: Message[] = [createUserMessage('hi'), createAssistantWithoutUsage()]
    const size = getContextSizeFromLastResponse(messages)
    expect(size).toBe(0)
  })

  it('should return 0 for empty messages', () => {
    expect(getContextSizeFromLastResponse([])).toBe(0)
  })
})

describe('getOutputTokensFromLastResponse', () => {
  it('should get output tokens from last response', () => {
    const messages: Message[] = [
      createUserMessage('hi'),
      createAssistantWithUsage({ inputTokens: 200, outputTokens: 50 }),
    ]
    const tokens = getOutputTokensFromLastResponse(messages)
    expect(tokens).toBe(50)
  })

  it('should return 0 when no usage', () => {
    expect(getOutputTokensFromLastResponse([createAssistantWithoutUsage()])).toBe(0)
  })
})

describe('getCurrentUsage', () => {
  it('should return latest usage from messages', () => {
    const messages: Message[] = [
      createAssistantWithUsage({ inputTokens: 100, outputTokens: 30 }),
      createUserMessage('more'),
      createAssistantWithUsage({ inputTokens: 200, outputTokens: 60 }),
    ]
    const usage = getCurrentUsage(messages)
    expect(usage?.inputTokens).toBe(200)
    expect(usage?.outputTokens).toBe(60)
  })

  it('should return null when no usage found', () => {
    expect(getCurrentUsage([createUserMessage('hi')])).toBeNull()
  })
})

describe('estimateContextTokens', () => {
  it('should return estimate from last usage-bearing message plus rough estimate', () => {
    const messages: Message[] = [
      createAssistantWithUsage({ inputTokens: 100, outputTokens: 30 }),
      createUserMessage('some new content here'),
    ]
    const estimate = estimateContextTokens(messages)
    expect(estimate).toBeGreaterThan(130) // 130 from usage + rough estimate for remaining
  })

  it('should return rough estimate when no usage data', () => {
    const messages: Message[] = [createUserMessage('short text')]
    const estimate = estimateContextTokens(messages)
    expect(estimate).toBeGreaterThan(0)
  })

  it('should handle empty messages', () => {
    expect(estimateContextTokens([])).toBe(0)
  })

  it('should handle messages with tool results', () => {
    const toolResult = createToolResultMessage([{ type: 'tool_result', toolUseId: 't1', content: 'result data' }])
    const messages: Message[] = [createAssistantWithUsage({ inputTokens: 200, outputTokens: 50 }), toolResult]
    const estimate = estimateContextTokens(messages)
    expect(estimate).toBeGreaterThan(250)
  })
})

describe('TokenTracker', () => {
  it('should track accumulated usage', () => {
    const tracker = new TokenTracker()
    tracker.updateFromUsage({ inputTokens: 100, outputTokens: 50 })
    tracker.updateFromUsage({ inputTokens: 200, outputTokens: 80 })
    const acc = tracker.getAccumulatedUsage()
    expect(acc.inputTokens).toBe(300)
    expect(acc.outputTokens).toBe(130)
  })

  it('should reset', () => {
    const tracker = new TokenTracker()
    tracker.updateFromUsage({ inputTokens: 100, outputTokens: 50 })
    tracker.reset()
    const acc = tracker.getAccumulatedUsage()
    expect(acc.inputTokens).toBe(0)
    expect(acc.outputTokens).toBe(0)
  })

  it('should estimate context size from messages using last usage', () => {
    const tracker = new TokenTracker()
    const messages: Message[] = [createAssistantWithUsage({ inputTokens: 150, outputTokens: 40 })]
    const estimate = tracker.estimateContextSize(messages)
    expect(estimate).toBeGreaterThanOrEqual(190)
  })

  it('should handle empty messages in estimateContextSize', () => {
    const tracker = new TokenTracker()
    expect(tracker.estimateContextSize([])).toBe(0)
  })
})
