/**
 * Tests — MicroCompactor
 *
 * Individual message-level compression strategies.
 */
import { describe, expect, it } from 'vitest'
import type { Message } from '../../types/message.js'
import { createAssistantMessage, createToolResultMessage, createUserMessage } from '../../types/message.js'
import { MicroCompactor } from '../micro-compact.js'

describe('MicroCompactor', () => {
  describe('truncateContent', () => {
    it('should truncate long content', () => {
      const compactor = new MicroCompactor({ maxMessageLength: 10 })
      const result = compactor.truncateContent('Hello, this is a long message', 10)
      expect(result.length).toBeLessThanOrEqual(24) // 10 + "[...truncated]".length
      expect(result).toContain('[...truncated]')
    })

    it('should not truncate short content', () => {
      const compactor = new MicroCompactor()
      const result = compactor.truncateContent('Short', 100)
      expect(result).toBe('Short')
    })

    it('should handle empty content', () => {
      const compactor = new MicroCompactor()
      expect(compactor.truncateContent('', 100)).toBe('')
    })
  })

  describe('compactMessage', () => {
    it('should truncate long user messages', () => {
      const compactor = new MicroCompactor({ maxMessageLength: 20 })
      const msg = createUserMessage('A'.repeat(100))
      const result = compactor.compactMessage(msg)
      expect(typeof result.content).toBe('string')
      if (typeof result.content === 'string') {
        expect(result.content.length).toBeLessThan(100)
        expect(result.content).toContain('[...truncated]')
      }
    })

    it('should not truncate short messages', () => {
      const compactor = new MicroCompactor()
      const msg = createUserMessage('Short message')
      const result = compactor.compactMessage(msg)
      expect(result.content).toBe('Short message')
    })

    it('should truncate long tool results', () => {
      const compactor = new MicroCompactor({ maxToolResultLength: 10 })
      const msg = createToolResultMessage([
        {
          type: 'tool_result',
          toolUseId: 't1',
          content: 'A'.repeat(100),
        },
      ])
      const result = compactor.compactMessage(msg)
      if (typeof result.content !== 'string') {
        const block = result.content[0]
        if (block && 'content' in block) {
          expect(block.content.length).toBeLessThan(100)
          expect(block.content).toContain('[...truncated]')
        }
      }
    })
  })

  describe('mergeAdjacentUserMessages', () => {
    it('should merge adjacent user messages', () => {
      const compactor = new MicroCompactor()
      const messages: Message[] = [
        createUserMessage('Hello'),
        createUserMessage('World'),
        createAssistantMessage('Response'),
      ]
      const result = compactor.mergeAdjacentUserMessages(messages)
      expect(result).toHaveLength(2)
      expect(result[0]?.role).toBe('user')
      if (typeof result[0]?.content === 'string') {
        expect(result[0].content).toContain('Hello')
        expect(result[0].content).toContain('World')
      }
    })

    it('should not merge non-adjacent user messages', () => {
      const compactor = new MicroCompactor()
      const messages: Message[] = [
        createUserMessage('First'),
        createAssistantMessage('Response'),
        createUserMessage('Second'),
      ]
      const result = compactor.mergeAdjacentUserMessages(messages)
      expect(result).toHaveLength(3)
    })

    it('should handle empty array', () => {
      const compactor = new MicroCompactor()
      expect(compactor.mergeAdjacentUserMessages([])).toEqual([])
    })

    it('should handle single message', () => {
      const compactor = new MicroCompactor()
      const messages = [createUserMessage('Alone')]
      expect(compactor.mergeAdjacentUserMessages(messages)).toHaveLength(1)
    })
  })

  describe('compactAll', () => {
    it('should apply all compaction strategies', () => {
      const compactor = new MicroCompactor({
        maxMessageLength: 20,
        maxToolResultLength: 10,
        mergeAdjacentUserMessages: true,
      })
      const messages: Message[] = [
        createUserMessage('A'.repeat(50)),
        createUserMessage('B'.repeat(50)),
        createAssistantMessage('C'.repeat(50)),
        createToolResultMessage([{ type: 'tool_result', toolUseId: 't1', content: 'D'.repeat(50) }]),
      ]
      const result = compactor.compactAll(messages)

      // After merging adjacent users: 3 messages
      expect(result).toHaveLength(3)

      // First message: merged and truncated
      if (typeof result[0]?.content === 'string') {
        expect(result[0].content).toContain('[...truncated]')
      }
    })

    it('should handle empty array', () => {
      const compactor = new MicroCompactor()
      expect(compactor.compactAll([])).toEqual([])
    })
  })

  describe('options', () => {
    it('should use default options', () => {
      const compactor = new MicroCompactor()
      // Should not truncate a 3000-char message since default is 4000
      const msg = createUserMessage('x'.repeat(3000))
      const result = compactor.compactMessage(msg)
      expect(result.content).toBe('x'.repeat(3000))
    })

    it('should respect custom maxMessageLength', () => {
      const compactor = new MicroCompactor({ maxMessageLength: 5 })
      const msg = createUserMessage('Hello World')
      const result = compactor.compactMessage(msg)
      if (typeof result.content === 'string') {
        expect(result.content.length).toBeLessThan(20)
      }
    })
  })
})
