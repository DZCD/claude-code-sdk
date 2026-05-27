/**
 * ClaudeCode SDK — Attribution Manager Tests
 *
 * Tests for the Attribution system:
 * - Message source tracking (user/LLM/tool/internal)
 * - Conversation round attribution
 * - Attribution metadata
 * - Attribution texts generation (commit/PR)
 * - Serialization/deserialization
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { AttributionManager } from '../session/attribution.js'

describe('AttributionManager', () => {
  let attribution: AttributionManager

  beforeEach(() => {
    attribution = new AttributionManager()
  })

  describe('initial state', () => {
    it('should start with zero turns and no messages', () => {
      const stats = attribution.getStats()
      expect(stats.totalTurns).toBe(0)
      expect(stats.userMessageCount).toBe(0)
      expect(stats.assistantMessageCount).toBe(0)
      expect(stats.toolCallCount).toBe(0)
    })

    it('should have a valid startTime in ISO format', () => {
      const stats = attribution.getStats()
      expect(stats.startTime).toBeDefined()
      expect(() => new Date(stats.startTime)).not.toThrow()
    })
  })

  describe('message source tracking', () => {
    it('should record a user message and update stats', () => {
      const meta = attribution.recordMessage('user')
      expect(meta.source).toBe('user')
      expect(meta.turnNumber).toBe(1)

      const stats = attribution.getStats()
      expect(stats.totalTurns).toBe(1)
      expect(stats.userMessageCount).toBe(1)
      expect(stats.assistantMessageCount).toBe(0)
    })

    it('should record an assistant message', () => {
      attribution.recordMessage('user')
      const meta = attribution.recordMessage('assistant')
      expect(meta.source).toBe('assistant')
      expect(meta.turnNumber).toBe(1)

      const stats = attribution.getStats()
      expect(stats.totalTurns).toBe(1)
      expect(stats.userMessageCount).toBe(1)
      expect(stats.assistantMessageCount).toBe(1)
    })

    it('should record a tool message and track unique tools', () => {
      attribution.recordMessage('user')
      attribution.recordMessage('assistant')
      attribution.recordMessage('tool', { toolName: 'bash' })

      const stats = attribution.getStats()
      expect(stats.toolCallCount).toBe(1)
      expect(stats.uniqueTools).toContain('bash')
    })

    it('should track multiple unique tools', () => {
      attribution.recordMessage('user')
      attribution.recordMessage('assistant')
      attribution.recordMessage('tool', { toolName: 'bash' })
      attribution.recordMessage('tool', { toolName: 'file_read' })

      const stats = attribution.getStats()
      expect(stats.toolCallCount).toBe(2)
      expect(stats.uniqueTools).toContain('bash')
      expect(stats.uniqueTools).toContain('file_read')
      expect(stats.uniqueTools).toHaveLength(2)
    })

    it('should not duplicate tool names in uniqueTools', () => {
      attribution.recordMessage('user')
      attribution.recordMessage('assistant')
      attribution.recordMessage('tool', { toolName: 'bash' })
      attribution.recordMessage('tool', { toolName: 'bash' })

      const stats = attribution.getStats()
      expect(stats.toolCallCount).toBe(2)
      expect(stats.uniqueTools).toEqual(['bash'])
    })

    it('should record system messages', () => {
      attribution.recordMessage('system')

      const stats = attribution.getStats()
      expect(stats.totalTurns).toBe(0) // system doesn't count as a turn
    })
  })

  describe('turn number tracking', () => {
    it('should increment turn number on each user message', () => {
      // Turn 1
      const m1 = attribution.recordMessage('user')
      expect(m1.turnNumber).toBe(1)

      // Still turn 1 (assistant follows user)
      const a1 = attribution.recordMessage('assistant')
      expect(a1.turnNumber).toBe(1)

      // Turn 2
      const m2 = attribution.recordMessage('user')
      expect(m2.turnNumber).toBe(2)
    })

    it('should report correct current turn', () => {
      expect(attribution.getCurrentTurn()).toBe(0)

      attribution.recordMessage('user')
      expect(attribution.getCurrentTurn()).toBe(1)

      attribution.recordMessage('user')
      expect(attribution.getCurrentTurn()).toBe(2)
    })

    it('should handle tool calls within a turn', () => {
      attribution.recordMessage('user') // Turn 1
      attribution.recordMessage('assistant') // Turn 1
      attribution.recordMessage('tool', { toolName: 'bash' }) // Turn 1

      const stats = attribution.getStats()
      expect(stats.totalTurns).toBe(1)
      expect(stats.toolCallCount).toBe(1)
    })
  })

  describe('attribution metadata', () => {
    it('should include all required fields in metadata', () => {
      const meta = attribution.recordMessage('user', { toolName: 'test' })
      expect(meta).toHaveProperty('source')
      expect(meta).toHaveProperty('turnNumber')
      expect(meta).toHaveProperty('timestamp')
      expect(meta.sourceLabel).toBeUndefined() // user messages don't have sourceLabel from toolName
    })

    it('should include sourceLabel for tool messages', () => {
      const meta = attribution.recordMessage('tool', { toolName: 'bash' })
      expect(meta.sourceLabel).toBe('bash')
    })

    it('should include sourceLabel for assistant messages when specified', () => {
      const meta = attribution.recordMessage('assistant', {
        toolName: 'claude-sonnet-4',
      })
      expect(meta.sourceLabel).toBe('claude-sonnet-4')
    })

    it('should have valid ISO timestamp', () => {
      const meta = attribution.recordMessage('user')
      const ts = new Date(meta.timestamp)
      expect(ts.getTime()).not.toBeNaN()
    })
  })

  describe('attribution texts generation', () => {
    it('should generate commit attribution text', () => {
      const texts = attribution.getAttributionTexts()
      expect(texts.commit).toBeTruthy()
      expect(texts.commit).toContain('Co-Authored-By')
    })

    it('should generate PR attribution text', () => {
      const texts = attribution.getAttributionTexts()
      expect(texts.pr).toBeTruthy()
      expect(texts.pr).toContain('Claude Code')
    })

    it('should include model name in attribution text', () => {
      const attr = new AttributionManager({ modelName: 'claude-sonnet-4' })
      const texts = attr.getAttributionTexts()
      expect(texts.commit).toContain('claude-sonnet-4')
    })

    it('should return empty texts when mode is none', () => {
      const attr = new AttributionManager({ mode: 'none' })
      const texts = attr.getAttributionTexts()
      expect(texts.commit).toBe('')
      expect(texts.pr).toBe('')
    })
  })

  describe('reset', () => {
    it('should reset all state', () => {
      attribution.recordMessage('user')
      attribution.recordMessage('assistant')
      attribution.recordMessage('tool', { toolName: 'bash' })

      attribution.reset()

      const stats = attribution.getStats()
      expect(stats.totalTurns).toBe(0)
      expect(stats.userMessageCount).toBe(0)
      expect(stats.assistantMessageCount).toBe(0)
      expect(stats.toolCallCount).toBe(0)
      expect(stats.uniqueTools).toEqual([])
    })
  })

  describe('serialization', () => {
    it('should serialize to a snapshot', () => {
      attribution.recordMessage('user')
      attribution.recordMessage('assistant')
      attribution.recordMessage('tool', { toolName: 'grep' })

      const snapshot = attribution.serialize()
      expect(snapshot).toHaveProperty('totalTurns')
      expect(snapshot).toHaveProperty('userMessageCount')
      expect(snapshot).toHaveProperty('assistantMessageCount')
      expect(snapshot).toHaveProperty('toolCallCount')
      expect(snapshot).toHaveProperty('uniqueTools')
      expect(snapshot.totalTurns).toBe(1)
      expect(snapshot.userMessageCount).toBe(1)
    })

    it('should deserialize from a snapshot', () => {
      attribution.recordMessage('user')
      attribution.recordMessage('assistant')
      const snapshot = attribution.serialize()

      const restored = AttributionManager.deserialize(snapshot)
      const stats = restored.getStats()
      expect(stats.totalTurns).toBe(1)
      expect(stats.userMessageCount).toBe(1)
      expect(stats.assistantMessageCount).toBe(1)
    })
  })

  describe('mode configuration', () => {
    it('should track messages in simple mode', () => {
      const attr = new AttributionManager({ mode: 'simple' })
      attr.recordMessage('user')
      attr.recordMessage('assistant')

      const stats = attr.getStats()
      expect(stats.totalTurns).toBe(1)
      expect(stats.userMessageCount).toBe(1)
    })

    it('should track messages in full mode', () => {
      const attr = new AttributionManager({ mode: 'full' })
      attr.recordMessage('user')
      attr.recordMessage('tool', { toolName: 'bash' })

      const stats = attr.getStats()
      expect(stats.totalTurns).toBe(1)
      expect(stats.toolCallCount).toBe(1)
    })
  })
})
