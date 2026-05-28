/**
 * Boundary & Edge-Case Tests — Session Engine, Attribution, Persistence
 *
 * Covers the boundary and error conditions that aren't exercised by
 * the main integration tests:
 *   - engine.ts: empty message, empty tools, session status transitions,
 *     maxTurns limit, timeout enforcement, persistence without config
 *   - attribution.ts: mode 'none' edge cases, rapid concurrency behaviour
 *   - persistence.ts: IO errors (corrupted JSON, missing dir, failed writes)
 */
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LLMConnector, StreamEvent } from '../llm/types.js'
import { ClaudeCodeSDK } from '../session/engine.js'
import { type Message, createUserMessage } from '../types/message.js'
import type { SessionSnapshot } from '../session/persistence.js'
import { SessionPersistence } from '../session/persistence.js'
import { AttributionManager } from '../session/attribution.js'

// ─── Mock LLM Helpers ────────────────────────────────────

function mockLLMWithEvents(events: StreamEvent[]): LLMConnector {
  return {
    provider: 'anthropic' as const,
    send: vi.fn().mockImplementation(async function* (): AsyncIterable<StreamEvent> {
      for (const evt of events) {
        yield evt
      }
    }),
    countTokens: vi.fn().mockResolvedValue(50),
  }
}

function createMinimalSDK(): ClaudeCodeSDK {
  return new ClaudeCodeSDK({
    llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
  })
}

// ─── Helper: patch internal LLM ──────────────────────────

function patchLLM(sdk: ClaudeCodeSDK, mock: LLMConnector): void {
  Object.defineProperty(sdk, '_llm', { value: mock })
  // Recreate conversation so it picks up the new LLM
  sdk.newConversation()
  // Patch the conversation's internal LLM too
  const convAny = (sdk as unknown as { _conversation: { _llm: LLMConnector } })._conversation
  convAny._llm = mock
}

// ──────────────────────────────────────────────────────────
// Session Engine — Boundary Cases
// ──────────────────────────────────────────────────────────

describe('ClaudeCodeSDK — Boundary Cases', () => {
  describe('empty / edge registrations', () => {
    it('should tolerate use() with no tools (empty registration)', () => {
      const sdk = createMinimalSDK()
      // Call use() with no arguments — should not throw
      expect(() => (sdk as any).use()).not.toThrow()
      // Tools registry should still exist and be empty
      expect(sdk.getTools().size).toBe(0)
    })

    it('should still function with zero registered tools', () => {
      const sdk = createMinimalSDK()
      expect(sdk.getTools().size).toBe(0)
      expect(sdk.getTools().getAll()).toEqual([])
    })
  })

  describe('empty message send/stream', () => {
    it('should handle send with empty string gracefully', async () => {
      const sdk = createMinimalSDK()
      const mockLLM = mockLLMWithEvents([
        { type: 'text', text: '' },
        { type: 'done', usage: { inputTokens: 1, outputTokens: 0 } },
      ])
      patchLLM(sdk, mockLLM)

      const response = await sdk.send('')
      // An empty message may be forwarded to the LLM; we just verify it
      // doesn't crash and returns a well-formed response object.
      expect(response).toBeDefined()
      expect(response).toHaveProperty('content')
      expect(response).toHaveProperty('usage')
      expect(response).toHaveProperty('toolCalls')
    })

    it('should handle stream with empty string gracefully', async () => {
      const sdk = createMinimalSDK()
      const mockLLM = mockLLMWithEvents([
        { type: 'text', text: '' },
        { type: 'done', usage: { inputTokens: 1, outputTokens: 0 } },
      ])
      patchLLM(sdk, mockLLM)

      const events: StreamEvent[] = []
      for await (const evt of sdk.stream('   ')) {
        events.push(evt)
      }
      expect(events.length).toBeGreaterThan(0)
      expect(events[events.length - 1]?.type).toBe('done')
    })

    it('should handle whitespace-only message', async () => {
      const sdk = createMinimalSDK()
      const mockLLM = mockLLMWithEvents([
        { type: 'text', text: 'ok' },
        { type: 'done', usage: { inputTokens: 2, outputTokens: 1 } },
      ])
      patchLLM(sdk, mockLLM)

      const response = await sdk.send('   ')
      expect(response.content).toBe('ok')
    })
  })

  describe('session status transitions', () => {
    it('should block send() when session is paused', async () => {
      const sdk = createMinimalSDK()
      Object.defineProperty(sdk, '_sessionStatus', { value: 'paused' })

      await expect(sdk.send('hello')).rejects.toThrow('Session is paused')
    })

    it('should block stream() when session is paused', () => {
      const sdk = createMinimalSDK()
      Object.defineProperty(sdk, '_sessionStatus', { value: 'paused' })
      // _checkSessionLimits() is called synchronously inside stream()
      expect(() => sdk.stream('hello')).toThrow('Session is paused')
    })

    it('should block send() when session is completed', async () => {
      const sdk = createMinimalSDK()
      Object.defineProperty(sdk, '_sessionStatus', { value: 'completed' })

      await expect(sdk.send('hello')).rejects.toThrow('Session is completed')
    })

    it('should block send() when session is archived', async () => {
      const sdk = createMinimalSDK()
      Object.defineProperty(sdk, '_sessionStatus', { value: 'archived' })

      await expect(sdk.send('hello')).rejects.toThrow('Session is archived')
    })

    it('should block stream() when session is completed', () => {
      const sdk = createMinimalSDK()
      Object.defineProperty(sdk, '_sessionStatus', { value: 'completed' })
      // _checkSessionLimits() is called synchronously inside stream()
      expect(() => sdk.stream('hello')).toThrow('Session is completed')
    })
  })

  describe('maxTurns enforcement', () => {
    it('should throw when maxTurns is exceeded via send()', async () => {
      const sdk = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
        session: { maxTurns: 1 },
      })
      const mock = mockLLMWithEvents([
        { type: 'text', text: 'ok' },
        { type: 'done', usage: { inputTokens: 5, outputTokens: 3 } },
      ])
      patchLLM(sdk, mock)

      // Turn 1 — allowed
      const r1 = await sdk.send('first')
      expect(r1.content).toBe('ok')

      // Turn 2 — should hit maxTurns
      await expect(sdk.send('second')).rejects.toThrow('maximum turns')
    })

    it('should throw when maxTurns is exceeded via stream()', () => {
      const sdk = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
        session: { maxTurns: 3 },
      })
      // Manually set turn count beyond max
      Object.defineProperty(sdk, '_turnCount', { value: 5 })
      // Now stream() should throw synchronously
      expect(() => sdk.stream('exceed')).toThrow('maximum turns')
    })

    it('should not limit when maxTurns is 0 (unlimited)', async () => {
      const sdk = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
        session: { maxTurns: 0 },
      })
      const mock = mockLLMWithEvents([
        { type: 'text', text: 'a' },
        { type: 'done', usage: { inputTokens: 2, outputTokens: 1 } },
        { type: 'text', text: 'b' },
        { type: 'done', usage: { inputTokens: 3, outputTokens: 2 } },
      ])
      patchLLM(sdk, mock)

      // Unlimited turns — should not throw
      await expect(sdk.send('first')).resolves.toBeDefined()
      await expect(sdk.send('second')).resolves.toBeDefined()
    })

    it('should reset turn count on resetConversation', async () => {
      const sdk = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
        session: { maxTurns: 2 },
      })
      const mock = mockLLMWithEvents([
        { type: 'text', text: 'ok' },
        { type: 'done', usage: { inputTokens: 2, outputTokens: 1 } },
      ])
      patchLLM(sdk, mock)

      await sdk.send('first')
      expect(sdk.getTurnCount()).toBe(1)

      sdk.resetConversation()
      expect(sdk.getTurnCount()).toBe(0)

      // After reset, we can send again
      const r2 = await sdk.send('again')
      expect(r2.content).toBe('ok')
      expect(sdk.getTurnCount()).toBe(1)
    })
  })

  describe('timeout enforcement', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should throw on send() when session has timed out', async () => {
      const sdk = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
        session: { timeout: 100 }, // 100ms timeout
      })
      const mock = mockLLMWithEvents([
        { type: 'text', text: 'ok' },
        { type: 'done', usage: { inputTokens: 2, outputTokens: 1 } },
      ])
      patchLLM(sdk, mock)

      // First send succeeds
      await sdk.send('first')

      // Advance time beyond timeout
      vi.advanceTimersByTime(200)

      // Second send should fail due to timeout
      await expect(sdk.send('second')).rejects.toThrow('timed out')
    })

    it('should throw on stream() when session has timed out', () => {
      const sdk = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
        session: { timeout: 50 },
      })
      // Set lastActivityTime far in the past
      Object.defineProperty(sdk, '_lastActivityTime', { value: Date.now() - 99999 })
      // stream() throws synchronously from _checkSessionLimits()
      expect(() => sdk.stream('second')).toThrow('timed out')
    })

    it('should not timeout when timeout is 0 (no timeout)', async () => {
      const sdk = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
        session: { timeout: 0 },
      })
      const mock = mockLLMWithEvents([
        { type: 'text', text: 'a' },
        { type: 'done', usage: { inputTokens: 2, outputTokens: 1 } },
        { type: 'text', text: 'b' },
        { type: 'done', usage: { inputTokens: 3, outputTokens: 2 } },
      ])
      patchLLM(sdk, mock)

      await sdk.send('first')
      vi.advanceTimersByTime(999999) // huge time but no timeout set
      await expect(sdk.send('second')).resolves.toBeDefined()
    })
  })
})

// ──────────────────────────────────────────────────────────
// Attribution — Edge Cases
// ──────────────────────────────────────────────────────────

describe('AttributionManager — Edge Cases', () => {
  describe('mode=none behaviour', () => {
    it('should not increment counters in none mode', () => {
      const attr = new AttributionManager({ mode: 'none' })
      attr.recordMessage('user')
      attr.recordMessage('assistant')
      attr.recordMessage('tool', { toolName: 'bash' })

      const stats = attr.getStats()
      // In 'none' mode, recordMessage returns early before incrementing
      expect(stats.totalTurns).toBe(0)
      expect(stats.userMessageCount).toBe(0)
      expect(stats.assistantMessageCount).toBe(0)
      expect(stats.toolCallCount).toBe(0)
    })

    it('should return empty attribution texts in none mode', () => {
      const attr = new AttributionManager({ mode: 'none' })
      const texts = attr.getAttributionTexts()
      expect(texts.commit).toBe('')
      expect(texts.pr).toBe('')
    })

    it('should return zero turn number metadata in none mode', () => {
      const attr = new AttributionManager({ mode: 'none' })
      const meta = attr.recordMessage('user')
      expect(meta.turnNumber).toBe(0)
      expect(meta.source).toBe('user')
    })
  })

  describe('rapid / concurrent recording', () => {
    it('should handle rapid sequential recording without issues', () => {
      const attr = new AttributionManager()
      for (let i = 0; i < 100; i++) {
        attr.recordMessage('user')
        attr.recordMessage('assistant')
      }
      const stats = attr.getStats()
      expect(stats.totalTurns).toBe(100)
      expect(stats.userMessageCount).toBe(100)
      expect(stats.assistantMessageCount).toBe(100)
    })

    it('should handle tool name with special characters', () => {
      const attr = new AttributionManager()
      attr.recordMessage('user')
      attr.recordMessage('assistant')
      attr.recordMessage('tool', { toolName: 'my-tool_v2.0@special' })
      const stats = attr.getStats()
      expect(stats.uniqueTools).toContain('my-tool_v2.0@special')
    })

    it('should handle tool recording without toolName option', () => {
      const attr = new AttributionManager()
      attr.recordMessage('user')
      attr.recordMessage('assistant')
      const meta = attr.recordMessage('tool')
      // No toolName provided — sourceLabel will be undefined
      expect(meta.sourceLabel).toBeUndefined()
      const stats = attr.getStats()
      expect(stats.toolCallCount).toBe(1)
      expect(stats.uniqueTools).toEqual([])
    })

    it('should ensure timestamps are monotonic', () => {
      const attr = new AttributionManager()
      const timestamps: string[] = []
      for (let i = 0; i < 10; i++) {
        const meta = attr.recordMessage('user')
        timestamps.push(meta.timestamp)
      }
      // Each subsequent timestamp should be >= previous
      for (let i = 1; i < timestamps.length; i++) {
        expect(new Date(timestamps[i]).getTime()).toBeGreaterThanOrEqual(
          new Date(timestamps[i - 1]).getTime(),
        )
      }
    })
  })

  describe('empty session / edge state', () => {
    it('should return empty stats for freshly created manager', () => {
      const attr = new AttributionManager()
      const stats = attr.getStats()
      expect(stats.uniqueTools).toEqual([])
      expect(stats.totalTurns).toBe(0)
      expect(stats.userMessageCount).toBe(0)
      expect(stats.assistantMessageCount).toBe(0)
      expect(stats.toolCallCount).toBe(0)
    })

    it('should handle reset on clean manager without error', () => {
      const attr = new AttributionManager()
      expect(() => attr.reset()).not.toThrow()
      const stats = attr.getStats()
      expect(stats.totalTurns).toBe(0)
    })

    it('should serialize empty state correctly', () => {
      const attr = new AttributionManager()
      const snapshot = attr.serialize()
      expect(snapshot.totalTurns).toBe(0)
      expect(snapshot.uniqueTools).toEqual([])
      expect(snapshot.userMessageCount).toBe(0)
    })

    it('should deserialize and produce correct stats', () => {
      const snapshot = {
        totalTurns: 5,
        userMessageCount: 5,
        assistantMessageCount: 8,
        toolCallCount: 12,
        uniqueTools: ['bash', 'file_read'],
        startTime: '2026-01-01T00:00:00.000Z',
        lastActivityTime: '2026-01-01T01:00:00.000Z',
        modelName: 'claude-sonnet-4',
        mode: 'full' as const,
      }
      const restored = AttributionManager.deserialize(snapshot)
      const stats = restored.getStats()
      expect(stats.totalTurns).toBe(5)
      expect(stats.userMessageCount).toBe(5)
      expect(stats.assistantMessageCount).toBe(8)
      expect(stats.toolCallCount).toBe(12)
      expect(stats.uniqueTools).toEqual(['bash', 'file_read'])
    })
  })
})

// ──────────────────────────────────────────────────────────
// Persistence — IO Error Handling & Edge Cases
// ──────────────────────────────────────────────────────────

const TEST_IO_DIR = join(process.cwd(), '.test-persistence-io')

describe('SessionPersistence — IO Error Handling', () => {
  let persistence: SessionPersistence

  beforeEach(async () => {
    if (existsSync(TEST_IO_DIR)) {
      await rm(TEST_IO_DIR, { recursive: true, force: true })
    }
    await mkdir(TEST_IO_DIR, { recursive: true })
    persistence = new SessionPersistence(TEST_IO_DIR)
  })

  afterEach(async () => {
    if (existsSync(TEST_IO_DIR)) {
      await rm(TEST_IO_DIR, { recursive: true, force: true })
    }
  })

  function makeBasicSnapshot(id = 'test-session'): SessionSnapshot {
    return {
      id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 1,
      tokenUsage: { inputTokens: 10, outputTokens: 5 },
      messages: [
        { id: 'msg-1', role: 'user', content: 'Hello', createdAt: new Date().toISOString() },
      ],
      metadata: { id, label: 'Test' },
    }
  }

  describe('corrupt / invalid data', () => {
    it('should return null for non-existent session file', async () => {
      const result = await persistence.load('non-existent-id')
      expect(result).toBeNull()
    })

    it('should return null for corrupted JSON file', async () => {
      // Write invalid JSON
      await writeFile(join(TEST_IO_DIR, 'corrupt.json'), 'this is not json', 'utf-8')
      const result = await persistence.load('corrupt')
      expect(result).toBeNull()
    })

    it('should skip corrupted files when listing sessions', async () => {
      // Write one valid and one corrupted file
      const valid = makeBasicSnapshot('valid-session')
      await persistence.save(valid)
      await writeFile(join(TEST_IO_DIR, 'corrupt.json'), '{invalid', 'utf-8')
      await writeFile(join(TEST_IO_DIR, 'also-bad.json'), 'not json', 'utf-8')

      const list = await persistence.listSessions()
      // Should include only the valid session
      expect(list.length).toBe(1)
      expect(list[0]?.id).toBe('valid-session')
    })

    it('should handle missing fields in snapshot gracefully', async () => {
      // Save then partially corrupt the metadata
      const snapshot = makeBasicSnapshot('partial')
      await persistence.save(snapshot)

      // Overwrite with missing metadata fields
      const partialData = JSON.stringify({
        id: 'partial',
        messageCount: 1,
        messages: snapshot.messages,
        // No tokenUsage, no metadata, no createdAt
      })
      await writeFile(join(TEST_IO_DIR, 'partial.json'), partialData, 'utf-8')

      const loaded = await persistence.load('partial')
      // Should still load (JSON.parse works), even if fields are missing
      expect(loaded).not.toBeNull()
      expect(loaded!.id).toBe('partial')
      // Missing fields will be undefined
      expect(loaded!.tokenUsage).toBeUndefined()
    })
  })

  describe('storage directory handling', () => {
    it('should create storage directory on first save', async () => {
      const newDir = join(process.cwd(), '.test-auto-create-dir')
      const p = new SessionPersistence(newDir)
      try {
        const snapshot = makeBasicSnapshot('auto-create')
        await p.save(snapshot)
        expect(existsSync(newDir)).toBe(true)
        expect(existsSync(join(newDir, 'auto-create.json'))).toBe(true)
      } finally {
        await rm(newDir, { recursive: true, force: true })
      }
    })

    it('should work with default storage directory', () => {
      // Using no args uses process.cwd() + '/.sessions'
      const p = new SessionPersistence()
      expect(p.storageDir).toContain('.sessions')
    })
  })

  describe('delete edge cases', () => {
    it('should return false when deleting non-existent session', async () => {
      const result = await persistence.delete('non-existent')
      expect(result).toBe(false)
    })

    it('should not throw when deleting already deleted session', async () => {
      const snapshot = makeBasicSnapshot('to-delete')
      await persistence.save(snapshot)
      await persistence.delete('to-delete')

      // Deleting again should return false (already gone)
      const result = await persistence.delete('to-delete')
      expect(result).toBe(false)
    })
  })

  describe('restore edge cases', () => {
    it('should return empty array for empty messages', () => {
      const snapshot: SessionSnapshot = {
        id: 'empty',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messageCount: 0,
        tokenUsage: { inputTokens: 0, outputTokens: 0 },
        messages: [],
        metadata: { id: 'empty' },
      }
      const restored = persistence.restoreMessages(snapshot)
      expect(restored).toEqual([])
    })

    it('should handle string content messages', () => {
      const snapshot = makeBasicSnapshot('string-content')
      const restored = persistence.restoreMessages(snapshot)
      expect(restored[0]?.content).toBe('Hello')
      expect(typeof restored[0]?.content).toBe('string')
    })

    it('should handle content block messages', () => {
      const snapshot = makeBasicSnapshot('blocks')
      snapshot.messages = [
        {
          id: 'msg-block',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello block' }],
          createdAt: new Date().toISOString(),
        },
      ]
      const restored = persistence.restoreMessages(snapshot)
      expect(Array.isArray(restored[0]?.content)).toBe(true)
    })
  })
})

// ──────────────────────────────────────────────────────────
// ClaudeCodeSDK — Persistence Boundary Cases
// ──────────────────────────────────────────────────────────

describe('ClaudeCodeSDK Persistence — Config Missing', () => {
  it('should throw when saveSession is called without storageDir', async () => {
    const sdk = createMinimalSDK()
    await expect(sdk.saveSession()).rejects.toThrow(
      'Session persistence is not configured',
    )
  })

  it('should throw when listSavedSessions is called without storageDir', async () => {
    const sdk = createMinimalSDK()
    await expect(sdk.listSavedSessions()).rejects.toThrow(
      'Session persistence is not configured',
    )
  })

  it('should throw when deleteSession is called without storageDir', async () => {
    const sdk = createMinimalSDK()
    await expect(sdk.deleteSession('any-id')).rejects.toThrow(
      'Session persistence is not configured',
    )
  })

  it('should return null from static loadSession without storageDir', async () => {
    const config = {
      llm: { provider: 'anthropic' as const, apiKey: 'sk-test', model: 'test-model' },
    }
    await expect(
      ClaudeCodeSDK.loadSession('any-id', config),
    ).rejects.toThrow('Session persistence requires session.storageDir')
  })
})
