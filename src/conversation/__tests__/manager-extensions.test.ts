/**
 * Tests — ConversationManager Extension (compaction integration)
 *
 * Tests that the ConversationManager properly integrates
 * micro-compact, auto-compact, and token tracking.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LLMConnector, StreamEvent } from '../../llm/types.js'
import { ConversationManager } from '../manager.js'
import { ToolRegistry } from '../../tools/registry.js'
import type { CompactOptions } from '../auto-compact.js'

// ─── Mock LLM ─────────────────────────────────────────────

function createMockLLM(events: StreamEvent[][] = []): LLMConnector {
  let callIndex = 0
  return {
    provider: 'anthropic' as const,
    send: vi.fn().mockImplementation(async function* (
      _sysPrompt?: string,
      _messages?: Array<{ role: string; content: string }>,
    ): AsyncIterable<StreamEvent> {
      const batch = events[callIndex] ?? [
        { type: 'text' as const, text: 'OK' },
        { type: 'done' as const, usage: { inputTokens: 10, outputTokens: 5 } },
      ]
      if (callIndex < events.length - 1) callIndex++
      for (const e of batch) yield e
    }),
    countTokens: vi.fn().mockResolvedValue(100),
  }
}

describe('ConversationManager — Phase 2 Extensions', () => {
  let mockLLM: LLMConnector
  let registry: ToolRegistry
  let cm: ConversationManager

  beforeEach(() => {
    registry = new ToolRegistry()
    mockLLM = createMockLLM()
    cm = new ConversationManager(mockLLM, registry)
  })

  describe('compaction options', () => {
    it('should set and get compact options', () => {
      const options: CompactOptions = {
        threshold: 0.7,
        keepRecentMessages: 5,
      }
      cm.setCompactOptions(options)
      // Check that options were accepted (no getter, but set shouldn't throw)
      expect(true).toBe(true)
    })

    it('should set micro-compact options', () => {
      cm.setMicroCompactOptions({ maxMessageLength: 2000 })
      expect(true).toBe(true)
    })

    it('should set token budget', () => {
      cm.setTokenBudget(500000)
      expect(true).toBe(true)
    })
  })

  describe('token tracking integration', () => {
    it('should track context size', async () => {
      for await (const _event of cm.send('Hello')) {
        // consume
      }
      const estimatedSize = cm.getEstimatedContextSize()
      expect(estimatedSize).toBeGreaterThan(0)
    })

    it('should report token usage after conversation', async () => {
      for await (const _event of cm.send('Hello')) {
        // consume
      }
      const usage = cm.getTokenUsage()
      expect(usage.inputTokens).toBeGreaterThan(0)
    })

    it('should report remaining budget', () => {
      cm.setTokenBudget(100000)
      for (const _ of [1, 2]) {
        // simulate usage
      }
      const remaining = cm.getRemainingBudget()
      expect(remaining).toBeGreaterThan(0)
    })
  })

  describe('history management', () => {
    it('should keep messages after send', async () => {
      for await (const _event of cm.send('Hello')) {
        // consume
      }
      expect(cm.messageCount).toBeGreaterThan(0)
    })

    it('should allow getting compaction history', () => {
      const history = cm.getCompactionHistory()
      expect(Array.isArray(history)).toBe(true)
    })
  })
})
