/**
 * Tests — AutoCompactor
 *
 * Context-aware auto-compaction for conversation history.
 */
import { describe, it, expect, vi } from 'vitest'
import { AutoCompactor } from '../auto-compact.js'
import type { Message } from '../../types/message.js'
import { createUserMessage, createAssistantMessage } from '../../types/message.js'

function createAssistantWithUsage(usageTokens: number): Message {
  return {
    ...createAssistantMessage('test'),
    usage: { inputTokens: usageTokens, outputTokens: 100 },
  } as Message
}

describe('AutoCompactor', () => {
  describe('needsCompact', () => {
    it('should return true when context exceeds threshold (80%)', () => {
      const compactor = new AutoCompactor({ threshold: 0.8, contextWindowSize: 1000 })
      // Simulate 900 tokens used out of 1000
      const messages: Message[] = [
        createAssistantWithUsage(800),
        createUserMessage('more content that adds up'),
      ]
      expect(compactor.needsCompact(messages, 1000)).toBe(true)
    })

    it('should return false when context is under threshold', () => {
      const compactor = new AutoCompactor({ threshold: 0.8, contextWindowSize: 1000 })
      const messages: Message[] = [
        createAssistantWithUsage(100),
      ]
      expect(compactor.needsCompact(messages, 1000)).toBe(false)
    })

    it('should return false for empty messages', () => {
      const compactor = new AutoCompactor()
      expect(compactor.needsCompact([], 200000)).toBe(false)
    })

    it('should use default threshold of 0.8', () => {
      const compactor = new AutoCompactor()
      // Default context window is 200000, 80% = 160000
      const messages: Message[] = [
        createAssistantWithUsage(170000),
      ]
      expect(compactor.needsCompact(messages, 200000)).toBe(true)
    })
  })

  describe('getCompactCandidates', () => {
    it('should return messages to compact (keeping recent)', () => {
      const compactor = new AutoCompactor({ keepRecentMessages: 2 })
      const messages: Message[] = [
        createUserMessage('old message 1'),
        createUserMessage('old message 2'),
        createUserMessage('old message 3'),
        createAssistantMessage('recent response 1'),
        createAssistantMessage('recent response 2'),
      ]
      const candidates = compactor.getCompactCandidates(messages)
      // Should keep last 2, so first 3 are candidates
      expect(candidates).toHaveLength(3)
      expect(candidates[0]?.content).toBe('old message 1')
      expect(candidates[1]?.content).toBe('old message 2')
    })

    it('should return empty array when fewer messages than keep count', () => {
      const compactor = new AutoCompactor({ keepRecentMessages: 5 })
      const messages: Message[] = [
        createUserMessage('only one'),
      ]
      expect(compactor.getCompactCandidates(messages)).toEqual([])
    })

    it('should keep system messages from candidates', () => {
      const compactor = new AutoCompactor({ keepRecentMessages: 1 })
      const messages: Message[] = [
        { role: 'system', content: 'system prompt' },
        createUserMessage('user message'),
        createAssistantMessage('response'),
      ]
      const candidates = compactor.getCompactCandidates(messages)
      // System message should be excluded from candidates
      expect(candidates).toHaveLength(1)
    })
  })

  describe('compact', () => {
    it('should return compacted=false when no compaction needed', async () => {
      const compactor = new AutoCompactor({ threshold: 0.9, contextWindowSize: 1000 })
      const messages: Message[] = [createUserMessage('short')]
      const result = await compactor.compact(messages, null)
      expect(result.compacted).toBe(false)
    })

    it('should perform in-memory truncation-style compaction when no LLM provided', async () => {
      const compactor = new AutoCompactor({
        threshold: 0.2, // Low threshold to trigger easily
        keepRecentMessages: 2,
        contextWindowSize: 1000,
      })
      // Long messages to exceed the 200-token threshold
      const messages: Message[] = Array.from({ length: 10 }, (_, i) =>
        createUserMessage(`Message number ${i} `.repeat(50))
      )
      const result = await compactor.compact(messages, null)
      expect(result.compacted).toBe(true)
      expect(result.finalCount).toBeLessThan(result.originalCount)
    })

    it('should use LLM summary when provided', async () => {
      const compactor = new AutoCompactor({
        threshold: 0.2,
        keepRecentMessages: 2,
        contextWindowSize: 1000,
      })

      const mockLLM = {
        summarize: vi.fn().mockResolvedValue('Summary of old messages'),
      }

      // Long messages to exceed threshold
      const messages: Message[] = Array.from({ length: 10 }, (_, i) =>
        createUserMessage(`Message ${i} `.repeat(50))
      )

      const result = await compactor.compact(messages, mockLLM)
      expect(result.compacted).toBe(true)
      expect(mockLLM.summarize).toHaveBeenCalled()
      expect(result.summary).toBe('Summary of old messages')
    })

    it('should handle empty messages gracefully', async () => {
      const compactor = new AutoCompactor()
      const result = await compactor.compact([], null)
      expect(result.compacted).toBe(false)
      expect(result.originalCount).toBe(0)
    })
  })
})
