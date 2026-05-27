import { existsSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
/**
 * ClaudeCode SDK — Session Persistence Tests
 *
 * Tests for session state serialization/deserialization,
 * save/load, session restore logic, and interruption detection.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionPersistence } from '../session/persistence.js'
import type { Message, TokenUsage } from '../types/message.js'

// ─── Helpers ──────────────────────────────────────────────

const TEST_STORAGE_DIR = join(process.cwd(), '.test-sessions')

function makeMessages(count: number): Message[] {
  const messages: Message[] = []
  for (let i = 0; i < count; i++) {
    messages.push({
      id: `msg-${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}`,
      createdAt: new Date(Date.now() + i * 1000).toISOString(),
    })
  }
  return messages
}

const testTokenUsage: TokenUsage = {
  inputTokens: 500,
  outputTokens: 200,
}

describe('SessionPersistence', () => {
  let persistence: SessionPersistence

  beforeEach(async () => {
    // Ensure clean test directory
    if (existsSync(TEST_STORAGE_DIR)) {
      await rm(TEST_STORAGE_DIR, { recursive: true, force: true })
    }
    await mkdir(TEST_STORAGE_DIR, { recursive: true })
    persistence = new SessionPersistence(TEST_STORAGE_DIR)
  })

  afterEach(async () => {
    if (existsSync(TEST_STORAGE_DIR)) {
      await rm(TEST_STORAGE_DIR, { recursive: true, force: true })
    }
  })

  describe('snapshot building', () => {
    it('should build a session snapshot from messages and token usage', () => {
      const messages = makeMessages(3)
      const snapshot = persistence.buildSnapshot(messages, testTokenUsage)

      expect(snapshot.id).toBeDefined()
      expect(snapshot.messageCount).toBe(3)
      expect(snapshot.tokenUsage).toEqual(testTokenUsage)
      expect(snapshot.messages).toHaveLength(3)
      expect(snapshot.createdAt).toBeDefined()
      expect(snapshot.updatedAt).toBeDefined()
    })

    it('should include message data in snapshot', () => {
      const messages = makeMessages(2)
      const snapshot = persistence.buildSnapshot(messages, testTokenUsage)

      expect(snapshot.messages[0]?.id).toBe('msg-0')
      expect(snapshot.messages[0]?.role).toBe('user')
      expect(snapshot.messages[0]?.content).toBe('Message 0')
    })

    it('should include metadata when provided', () => {
      const messages = makeMessages(1)
      const snapshot = persistence.buildSnapshot(messages, testTokenUsage, {
        id: 'test-session-1',
        label: 'Test Session',
        tags: ['test', 'demo'],
        modelName: 'claude-sonnet-4',
        systemPrompt: 'You are a helpful assistant',
      })

      expect(snapshot.metadata.id).toBe('test-session-1')
      expect(snapshot.metadata.label).toBe('Test Session')
      expect(snapshot.metadata.tags).toEqual(['test', 'demo'])
      expect(snapshot.metadata.modelName).toBe('claude-sonnet-4')
      expect(snapshot.metadata.systemPrompt).toBe('You are a helpful assistant')
    })

    it('should generate a default session id when not provided', () => {
      const messages = makeMessages(1)
      const snapshot = persistence.buildSnapshot(messages, testTokenUsage)

      expect(snapshot.id).toBeTruthy()
      expect(snapshot.metadata.id).toBe(snapshot.id)
    })

    it('should handle empty messages array', () => {
      const snapshot = persistence.buildSnapshot([], testTokenUsage)

      expect(snapshot.messageCount).toBe(0)
      expect(snapshot.messages).toEqual([])
    })
  })

  describe('save and load', () => {
    it('should save a snapshot to disk and return its id', async () => {
      const messages = makeMessages(2)
      const snapshot = persistence.buildSnapshot(messages, testTokenUsage)

      const sessionId = await persistence.save(snapshot)
      expect(sessionId).toBe(snapshot.id)

      // Verify file exists
      const filePath = join(TEST_STORAGE_DIR, `${sessionId}.json`)
      expect(existsSync(filePath)).toBe(true)
    })

    it('should load a previously saved session', async () => {
      const messages = makeMessages(3)
      const snapshot = persistence.buildSnapshot(messages, testTokenUsage, {
        label: 'Test Load',
      })

      const sessionId = await persistence.save(snapshot)
      const loaded = await persistence.load(sessionId)

      expect(loaded).not.toBeNull()
      expect(loaded!.id).toBe(sessionId)
      expect(loaded!.messageCount).toBe(3)
      expect(loaded!.metadata.label).toBe('Test Load')
      expect(loaded!.messages).toHaveLength(3)
    })

    it('should return null for non-existent session', async () => {
      const result = await persistence.load('non-existent-id')
      expect(result).toBeNull()
    })

    it('should persist messages correctly', async () => {
      const messages = makeMessages(5)
      const snapshot = persistence.buildSnapshot(messages, testTokenUsage)
      const sessionId = await persistence.save(snapshot)

      const loaded = await persistence.load(sessionId)
      for (let i = 0; i < 5; i++) {
        expect(loaded!.messages[i]?.id).toBe(`msg-${i}`)
        expect(loaded!.messages[i]?.role).toBe(i % 2 === 0 ? 'user' : 'assistant')
        expect(loaded!.messages[i]?.content).toBe(`Message ${i}`)
      }
    })

    it('should overwrite existing session on save with same id', async () => {
      const messages1 = makeMessages(1)
      const snapshot1 = persistence.buildSnapshot(messages1, testTokenUsage, {
        id: 'same-id',
        label: 'First',
      })
      await persistence.save(snapshot1)

      const messages2 = makeMessages(2)
      const snapshot2 = persistence.buildSnapshot(messages2, testTokenUsage, {
        id: 'same-id',
        label: 'Second',
      })
      await persistence.save(snapshot2)

      const loaded = await persistence.load('same-id')
      expect(loaded!.metadata.label).toBe('Second')
      expect(loaded!.messageCount).toBe(2)
    })
  })

  describe('list and delete', () => {
    it('should list all saved sessions', async () => {
      const m1 = makeMessages(1)
      const s1 = persistence.buildSnapshot(m1, testTokenUsage, {
        id: 'session-1',
        label: 'S1',
      })
      await persistence.save(s1)

      const m2 = makeMessages(2)
      const s2 = persistence.buildSnapshot(m2, testTokenUsage, {
        id: 'session-2',
        label: 'S2',
      })
      await persistence.save(s2)

      const list = await persistence.listSessions()
      expect(list).toHaveLength(2)
      expect(list.map((s) => s.id)).toContain('session-1')
      expect(list.map((s) => s.id)).toContain('session-2')
    })

    it('should delete a saved session', async () => {
      const messages = makeMessages(1)
      const snapshot = persistence.buildSnapshot(messages, testTokenUsage, {
        id: 'delete-me',
      })
      await persistence.save(snapshot)

      const deleted = await persistence.delete('delete-me')
      expect(deleted).toBe(true)
      expect(existsSync(join(TEST_STORAGE_DIR, 'delete-me.json'))).toBe(false)
    })

    it('should return false when deleting non-existent session', async () => {
      const result = await persistence.delete('does-not-exist')
      expect(result).toBe(false)
    })

    it('should exclude deleted sessions from list', async () => {
      const messages = makeMessages(1)
      const s1 = persistence.buildSnapshot(messages, testTokenUsage, {
        id: 'keep',
      })
      const s2 = persistence.buildSnapshot(messages, testTokenUsage, {
        id: 'remove',
      })
      await persistence.save(s1)
      await persistence.save(s2)

      await persistence.delete('remove')
      const list = await persistence.listSessions()
      expect(list).toHaveLength(1)
      expect(list[0]?.id).toBe('keep')
    })
  })

  describe('restore messages', () => {
    it('should restore messages from a snapshot', () => {
      const messages = makeMessages(3)
      const snapshot = persistence.buildSnapshot(messages, testTokenUsage)

      const restored = persistence.restoreMessages(snapshot)
      expect(restored).toHaveLength(3)
      expect(restored[0]?.id).toBe('msg-0')
      expect(restored[1]?.id).toBe('msg-1')
    })

    it('should return valid Message objects', () => {
      const messages = makeMessages(1)
      const snapshot = persistence.buildSnapshot(messages, testTokenUsage)

      const restored = persistence.restoreMessages(snapshot)
      expect(restored[0]).toHaveProperty('id')
      expect(restored[0]).toHaveProperty('role')
      expect(restored[0]).toHaveProperty('content')
      expect(restored[0]).toHaveProperty('createdAt')
    })
  })

  describe('can restore', () => {
    it('should return true for valid snapshot', () => {
      const messages = makeMessages(2)
      const snapshot = persistence.buildSnapshot(messages, testTokenUsage)

      expect(persistence.canRestore(snapshot)).toBe(true)
    })

    it('should return false for empty snapshot', () => {
      const snapshot = persistence.buildSnapshot([], testTokenUsage, {
        id: 'empty',
      })

      expect(persistence.canRestore(snapshot)).toBe(false)
    })
  })

  describe('interruption detection', () => {
    // Reference: conversationRecovery.ts detectTurnInterruption
    it('should detect no interruption on empty messages', () => {
      const result = persistence.detectInterruption([])
      expect(result.interrupted).toBe(false)
    })

    it('should detect no interruption when last message is assistant', () => {
      const messages: Message[] = [
        {
          id: '1',
          role: 'user',
          content: 'Hi',
          createdAt: '2024-01-01T00:00:00Z',
        },
        {
          id: '2',
          role: 'assistant',
          content: 'Hello!',
          createdAt: '2024-01-01T00:00:01Z',
        },
      ]
      const result = persistence.detectInterruption(messages)
      expect(result.interrupted).toBe(false)
      expect(result.lastTurnComplete).toBe(true)
    })

    it('should detect interruption when last message is user', () => {
      const messages: Message[] = [
        {
          id: '1',
          role: 'user',
          content: 'Turn 1',
          createdAt: '2024-01-01T00:00:00Z',
        },
        {
          id: '2',
          role: 'assistant',
          content: 'Response 1',
          createdAt: '2024-01-01T00:00:01Z',
        },
        {
          id: '3',
          role: 'user',
          content: 'Incomplete turn',
          createdAt: '2024-01-01T00:00:02Z',
        },
      ]
      const result = persistence.detectInterruption(messages)
      expect(result.interrupted).toBe(true)
      expect(result.lastTurnComplete).toBe(false)
    })

    it('should detect interruption ending on tool result (unmatched)', () => {
      const messages: Message[] = [
        {
          id: '1',
          role: 'user',
          content: 'Use tool',
          createdAt: '2024-01-01T00:00:00Z',
        },
        {
          id: '2',
          role: 'assistant',
          content: 'Running...',
          createdAt: '2024-01-01T00:00:01Z',
        },
        {
          id: '3',
          role: 'user',
          content: [
            {
              type: 'tool_result',
              toolUseId: 't1',
              content: 'Done',
            },
          ],
          createdAt: '2024-01-01T00:00:02Z',
        },
      ]
      const result = persistence.detectInterruption(messages)
      expect(result.lastTurnComplete).toBe(false)
    })

    it('should handle single user message as interrupted', () => {
      const messages: Message[] = [
        {
          id: '1',
          role: 'user',
          content: 'Hello?',
          createdAt: '2024-01-01T00:00:00Z',
        },
      ]
      const result = persistence.detectInterruption(messages)
      expect(result.interrupted).toBe(true)
      expect(result.lastTurnComplete).toBe(false)
    })
  })
})
