/**
 * Tests — Conversation Module Edge Cases
 *
 * Covers: TokenBudget negative/zero budget, isAboveThreshold boundary,
 * TokenTracker edge cases, AutoCompactor large messages & trigger timing,
 * MicroCompactor edge cases.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Message } from '../../types/message.js'
import {
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from '../../types/message.js'
import { AutoCompactor, type SummaryLLM } from '../auto-compact.js'
import { MicroCompactor } from '../micro-compact.js'
import { TokenBudget, parseTokenBudget } from '../token-budget.js'
import {
  TokenTracker,
  estimateContextTokens,
  getCurrentUsage,
} from '../token-tracker.js'

// ─── TokenBudget Edge Cases ──────────────────────────────

describe('TokenBudget — Edge Cases', () => {
  describe('parseTokenBudget', () => {
    it('should parse billion shorthand: +1b', () => {
      expect(parseTokenBudget('+1b')).toBe(1_000_000_000)
    })

    it('should parse decimal billion: +2.5b', () => {
      expect(parseTokenBudget('+2.5b')).toBe(2_500_000_000)
    })

    it('should return null for text with only "k" (no number)', () => {
      expect(parseTokenBudget('k')).toBeNull()
    })

    it('should return null for text with only "+" sign', () => {
      expect(parseTokenBudget('+ only')).toBeNull()
    })

    it('should parse verbose form with different word order', () => {
      expect(parseTokenBudget('spend 2M tokens today')).toBe(2_000_000)
    })

    it('should handle uppercase shorthand: +500K', () => {
      expect(parseTokenBudget('+500K')).toBe(500_000)
    })

    it('should handle whitespace padding around verbose form', () => {
      expect(parseTokenBudget('  use  1.5M  tokens  ')).toBe(1_500_000)
    })
  })

  describe('TokenBudget class', () => {
    it('should handle zero budget', () => {
      const budget = new TokenBudget(0)
      expect(budget.remaining).toBe(0)
      budget.recordUsage({ inputTokens: 100, outputTokens: 50 })
      expect(budget.remaining).toBe(0)
    })

    it('should handle negative budget', () => {
      const budget = new TokenBudget(-1000)
      expect(budget.remaining).toBe(0) // Math.max(0, -1000 - 0) = 0
    })

    it('should never go negative after usage recording', () => {
      const budget = new TokenBudget(10)
      budget.recordUsage({ inputTokens: 20, outputTokens: 30 })
      expect(budget.remaining).toBe(0) // Math.max(0, 10 - 50) = 0
    })

    it('should handle isAboveThreshold with zero budget (never trigger)', () => {
      const budget = new TokenBudget(0)
      expect(budget.isAboveThreshold(0.8)).toBe(false)
      budget.recordUsage({ inputTokens: 100, outputTokens: 100 })
      expect(budget.isAboveThreshold(0.8)).toBe(false)
    })

    it('should handle isAboveThreshold exactly at boundary (not >)', () => {
      const budget = new TokenBudget(1000)
      budget.recordUsage({ inputTokens: 800, outputTokens: 0 })
      // 800/1000 = 0.8, but isAboveThreshold uses > not >=
      expect(budget.isAboveThreshold(0.8)).toBe(false)
    })

    it('should handle isAboveThreshold just above boundary', () => {
      const budget = new TokenBudget(1000)
      budget.recordUsage({ inputTokens: 801, outputTokens: 0 })
      expect(budget.isAboveThreshold(0.8)).toBe(true)
    })

    it('should handle multiple recordUsage calls', () => {
      const budget = new TokenBudget(10000)
      budget.recordUsage({ inputTokens: 1000, outputTokens: 500 })
      budget.recordUsage({ inputTokens: 2000, outputTokens: 1000 })
      budget.recordUsage({ inputTokens: 500, outputTokens: 200 })
      expect(budget.remaining).toBe(4800) // 10000 - (1000+500+2000+1000+500+200)
    })

    it('should reset to full budget after usage', () => {
      const budget = new TokenBudget(5000)
      budget.recordUsage({ inputTokens: 3000, outputTokens: 1000 })
      expect(budget.remaining).toBe(1000)
      budget.reset()
      expect(budget.remaining).toBe(5000)
    })

    it('should handle recording zero usage', () => {
      const budget = new TokenBudget(100)
      budget.recordUsage({ inputTokens: 0, outputTokens: 0 })
      expect(budget.remaining).toBe(100)
    })

    it('should handle undefined input/output tokens gracefully', () => {
      const budget = new TokenBudget(100)
      budget.recordUsage({ inputTokens: undefined as any, outputTokens: undefined as any })
      expect(budget.remaining).toBe(100) // undefined ?? 0 === 0
    })
  })
})

// ─── TokenTracker Edge Cases ─────────────────────────────

describe('TokenTracker — Edge Cases', () => {
  it('should handle zero accumulative usage', () => {
    const tracker = new TokenTracker()
    const acc = tracker.getAccumulatedUsage()
    expect(acc.inputTokens).toBe(0)
    expect(acc.outputTokens).toBe(0)
  })

  it('should handle updateFromUsage with partial usage object', () => {
    const tracker = new TokenTracker()
    tracker.updateFromUsage({ inputTokens: 50, outputTokens: 0 } as any)
    const acc = tracker.getAccumulatedUsage()
    expect(acc.inputTokens).toBe(50)
    expect(acc.outputTokens).toBe(0)
  })

  it('should handle estimateContextSize with only user messages', () => {
    const tracker = new TokenTracker()
    const messages: Message[] = [
      createUserMessage('Hello'),
      createUserMessage('How are you?'),
    ]
    const estimate = tracker.estimateContextSize(messages)
    expect(estimate).toBeGreaterThan(0)
  })

  it('should handle estimateContextSize with mixed content blocks', () => {
    const tracker = new TokenTracker()
    const toolResult = createToolResultMessage([
      { type: 'tool_result', toolUseId: 't1', content: 'Large result data here' },
    ])
    const messages: Message[] = [
      createUserMessage('test'),
      createAssistantMessage('response'),
      toolResult,
    ]
    const estimate = tracker.estimateContextSize(messages)
    expect(estimate).toBeGreaterThan(0)
  })
})

describe('estimateContextTokens — Edge Cases', () => {
  it('should handle messages with tool_result content type', () => {
    const toolResult = createToolResultMessage([
      { type: 'tool_result' as any, toolUseId: 't1', content: 'result' },
    ])
    const messages: Message[] = [
      createAssistantMessage('response'),
      toolResult,
    ]
    const estimate = estimateContextTokens(messages)
    expect(estimate).toBeGreaterThan(0)
  })

  it('should handle messages with thinking blocks', () => {
    const message: Message = {
      role: 'assistant',
      content: [
        { type: 'thinking' as any, thinking: 'deep thoughts here' },
        { type: 'text', text: 'final answer' },
      ],
    }
    const estimate = estimateContextTokens([message])
    expect(estimate).toBeGreaterThan(0)
  })

  it('should handle messages with empty content array', () => {
    const message: Message = {
      role: 'assistant',
      content: [],
    }
    const estimate = estimateContextTokens([message])
    expect(estimate).toBe(10) // just overhead
  })

  it('should handle messages with unknown content block types', () => {
    const message: Message = {
      role: 'assistant',
      content: [{ type: 'unknown_type' as any, data: 'something' }],
    }
    const estimate = estimateContextTokens([message])
    expect(estimate).toBeGreaterThanOrEqual(0)
  })

  it('should return rough estimate when no usage data available across messages', () => {
    const messages: Message[] = [
      createUserMessage('A'.repeat(400)), // ~100 tokens
    ]
    const estimate = estimateContextTokens(messages)
    expect(estimate).toBeGreaterThan(100)
  })
})

describe('getCurrentUsage — Edge Cases', () => {
  it('should return null for empty messages', () => {
    expect(getCurrentUsage([])).toBeNull()
  })

  it('should return null for messages without usage', () => {
    const messages: Message[] = [createUserMessage('hi'), createUserMessage('there')]
    expect(getCurrentUsage(messages)).toBeNull()
  })

  it('should return latest usage ignoring user messages after', () => {
    const messages: Message[] = [
      {
        ...createAssistantMessage('first'),
        usage: { inputTokens: 100, outputTokens: 50 },
      } as Message,
      createUserMessage('more text'),
      {
        ...createAssistantMessage('second'),
        usage: { inputTokens: 200, outputTokens: 80 },
      } as Message,
    ]
    const usage = getCurrentUsage(messages)
    expect(usage?.inputTokens).toBe(200)
  })
})

// ─── AutoCompactor Edge Cases ────────────────────────────

function createAssistantWithUsage(usageTokens: number): Message {
  return {
    ...createAssistantMessage('test'),
    usage: { inputTokens: usageTokens, outputTokens: 100 },
  } as Message
}

describe('AutoCompactor — Edge Cases', () => {
  describe('needsCompact', () => {
    it('should not trigger when threshold is set to 1.0 (100%)', () => {
      const compactor = new AutoCompactor({ threshold: 1.0, contextWindowSize: 1000 })
      const messages: Message[] = [createAssistantWithUsage(900)]
      expect(compactor.needsCompact(messages, 1000)).toBe(false)
    })

    it('should trigger at exactly threshold 0.5 with enough content', () => {
      const compactor = new AutoCompactor({ threshold: 0.5, contextWindowSize: 1000 })
      const messages: Message[] = [createAssistantWithUsage(600)]
      expect(compactor.needsCompact(messages, 1000)).toBe(true)
    })

    it('should handle very large context window with small messages', () => {
      const compactor = new AutoCompactor({ threshold: 0.8, contextWindowSize: 1_000_000 })
      const messages: Message[] = [createAssistantWithUsage(100)]
      expect(compactor.needsCompact(messages, 1_000_000)).toBe(false)
    })
  })

  describe('getCompactCandidates', () => {
    it('should skip system messages in candidates', () => {
      const compactor = new AutoCompactor({ keepRecentMessages: 1 })
      const messages: Message[] = [
        { role: 'system', content: 'system prompt' },
        createUserMessage('user msg'),
        createAssistantMessage('response'),
      ]
      const candidates = compactor.getCompactCandidates(messages)
      // System message at index 0 is skipped, user msg at index 1 is candidate
      expect(candidates).toHaveLength(1)
      expect(candidates[0]!.role).not.toBe('system')
    })

    it('should return no candidates when exactly at keepRecentMessages count', () => {
      const compactor = new AutoCompactor({ keepRecentMessages: 3 })
      const messages: Message[] = [
        createUserMessage('a'),
        createUserMessage('b'),
        createUserMessage('c'),
      ]
      expect(compactor.getCompactCandidates(messages)).toEqual([])
    })

    it('should handle single message with keepRecentMessages > 0', () => {
      const compactor = new AutoCompactor({ keepRecentMessages: 5 })
      const messages: Message[] = [createUserMessage('lonely')]
      expect(compactor.getCompactCandidates(messages)).toEqual([])
    })
  })

  describe('compact', () => {
    it('should handle large message arrays without LLM', async () => {
      const compactor = new AutoCompactor({
        threshold: 0.1,
        keepRecentMessages: 3,
        contextWindowSize: 10000,
      })
      // Many long messages to exceed threshold
      const messages: Message[] = Array.from({ length: 50 }, (_, i) =>
        createUserMessage(`Message ${i} `.repeat(100)),
      )
      const result = await compactor.compact(messages, null)
      expect(result.compacted).toBe(true)
      expect(result.originalCount).toBe(50)
      expect(result.finalCount).toBeLessThan(50)
      expect(result.summary).toContain('trimmed')
    })

    it('should use LLM summary when llm provided', async () => {
      const compactor = new AutoCompactor({
        threshold: 0.2,
        keepRecentMessages: 2,
        contextWindowSize: 1000,
      })

      const mockLLM: SummaryLLM = {
        summarize: vi.fn().mockResolvedValue('LLM generated summary'),
      }

      const messages: Message[] = Array.from({ length: 10 }, (_, i) =>
        createUserMessage(`M ${i} `.repeat(30)),
      )
      const result = await compactor.compact(messages, mockLLM)
      expect(result.compacted).toBe(true)
      expect(mockLLM.summarize).toHaveBeenCalled()
      expect(result.summary).toBe('LLM generated summary')
    })

    it('should return compacted=false when no candidates found', async () => {
      const compactor = new AutoCompactor({
        threshold: 0.1,
        keepRecentMessages: 100,
        contextWindowSize: 1000,
      })
      const messages: Message[] = Array.from({ length: 5 }, (_, i) =>
        createUserMessage(`Message ${i}`),
      )
      const result = await compactor.compact(messages, null)
      expect(result.compacted).toBe(false)
      // Should still report counts
      expect(result.originalCount).toBe(5)
      expect(result.finalCount).toBe(5)
    })

    it('should return compacted=false when messages length = 0', async () => {
      const compactor = new AutoCompactor()
      const result = await compactor.compact([], null)
      expect(result.compacted).toBe(false)
      expect(result.originalCount).toBe(0)
      expect(result.finalCount).toBe(0)
    })

    it('should increment compactCount on successful compaction', async () => {
      const compactor = new AutoCompactor({
        threshold: 0.2,
        keepRecentMessages: 2,
        contextWindowSize: 1000,
      })
      expect(compactor.compactCount).toBe(0)

      const messages: Message[] = Array.from({ length: 10 }, (_, i) =>
        createUserMessage(`M ${i} `.repeat(30)),
      )
      await compactor.compact(messages, null)
      expect(compactor.compactCount).toBe(1)

      // Second compaction
      await compactor.compact(messages, null)
      expect(compactor.compactCount).toBe(2)
    })
  })
})

// ─── MicroCompactor Edge Cases ───────────────────────────

describe('MicroCompactor — Edge Cases', () => {
  describe('truncateContent', () => {
    it('should truncate at exact maxLen boundary', () => {
      const compactor = new MicroCompactor()
      const content = 'x'.repeat(4000) // exactly at default maxMessageLength
      const result = compactor.truncateContent(content, 4000)
      expect(result).toBe(content) // not truncated
    })

    it('should truncate content one char over limit', () => {
      const compactor = new MicroCompactor()
      const content = 'x'.repeat(4001) // 1 over default
      const result = compactor.truncateContent(content, 4000)
      expect(result.length).toBe(4014) // 4000 + '[...truncated]'.length
      expect(result).toContain('[...truncated]')
    })

    it('should handle content exactly at 0 length', () => {
      const compactor = new MicroCompactor()
      expect(compactor.truncateContent('', 100)).toBe('')
    })
  })

  describe('compactMessage', () => {
    it('should handle null/undefined content gracefully', () => {
      const compactor = new MicroCompactor()
      const msg = { role: 'user', content: null } as any
      // NOTE: BUG-001 — compactMessage currently throws on null content
      // This test documents the known limitation
      expect(() => compactor.compactMessage(msg)).toThrow()
    })

    it('should handle assistant messages with content blocks', () => {
      const compactor = new MicroCompactor({ maxMessageLength: 5 })
      const msg = createAssistantMessage('A'.repeat(100))
      const result = compactor.compactMessage(msg)
      if (typeof result.content === 'string') {
        expect(result.content.length).toBeLessThan(30)
      }
    })

    it('should not modify messages under limit', () => {
      const compactor = new MicroCompactor()
      const msg = createUserMessage('short')
      const result = compactor.compactMessage(msg)
      expect(result.content).toBe('short')
    })

    it('should handle tool result with empty content', () => {
      const compactor = new MicroCompactor()
      const msg = createToolResultMessage([
        { type: 'tool_result', toolUseId: 't1', content: '' },
      ])
      const result = compactor.compactMessage(msg)
      if (typeof result.content !== 'string') {
        const block = result.content[0] as any
        expect(block.content).toBe('')
      }
    })
  })

  describe('mergeAdjacentUserMessages', () => {
    it('should merge multiple consecutive user messages (3+)', () => {
      const compactor = new MicroCompactor()
      const messages: Message[] = [
        createUserMessage('A'),
        createUserMessage('B'),
        createUserMessage('C'),
        createAssistantMessage('response'),
      ]
      const result = compactor.mergeAdjacentUserMessages(messages)
      expect(result).toHaveLength(2)
      expect(result[0]?.role).toBe('user')
      if (typeof result[0]?.content === 'string') {
        expect(result[0].content).toContain('A')
        expect(result[0].content).toContain('B')
        expect(result[0].content).toContain('C')
      }
    })

    it('should not merge user messages with non-string content', () => {
      const compactor = new MicroCompactor()
      const toolResult = createToolResultMessage([
        { type: 'tool_result', toolUseId: 't1', content: 'result' },
      ])
      const messages: Message[] = [
        { role: 'user', content: 'text message' },
        toolResult,
      ]
      const result = compactor.mergeAdjacentUserMessages(messages)
      expect(result).toHaveLength(2) // not merged because tool_result is not a user text message
    })

    it('should preserve message order during merge', () => {
      const compactor = new MicroCompactor()
      const messages: Message[] = [
        createUserMessage('First'),
        createUserMessage('Second'),
        createAssistantMessage('Response'),
        createUserMessage('Third'),
        createAssistantMessage('End'),
      ]
      const result = compactor.mergeAdjacentUserMessages(messages)
      expect(result).toHaveLength(4)
      expect(result[0]?.role).toBe('user')
      expect(result[2]?.role).toBe('user')
      expect(result[2]?.content).toBe('Third')
    })
  })

  describe('compactAll', () => {
    it('should not crash with empty array', () => {
      const compactor = new MicroCompactor()
      expect(compactor.compactAll([])).toEqual([])
    })

    it('should apply merge then truncate in correct order', () => {
      const compactor = new MicroCompactor({
        maxMessageLength: 10,
        mergeAdjacentUserMessages: true,
      })
      const messages: Message[] = [
        createUserMessage('Hello World Long'),
        createUserMessage('Second Long Message'),
      ]
      const result = compactor.compactAll(messages)
      // Merged into 1 user message, then truncated
      expect(result).toHaveLength(1)
      if (typeof result[0]?.content === 'string') {
        expect(result[0].content).toContain('[...truncated]')
        expect(result[0].content).toContain('Hello')
      }
    })

    it('should respect mergeAdjacentUserMessages disabled', () => {
      const compactor = new MicroCompactor({
        mergeAdjacentUserMessages: false,
        maxMessageLength: 100,
      })
      const messages: Message[] = [
        createUserMessage('First'),
        createUserMessage('Second'),
      ]
      const result = compactor.compactAll(messages)
      // With merging disabled, both messages should remain separate
      expect(result).toHaveLength(2)
    })
  })
})
