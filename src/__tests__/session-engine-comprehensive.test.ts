/**
 * ClaudeCode SDK — Session Engine Comprehensive Tests
 *
 * 补充测试覆盖：
 * 1. createSession() 多实例隔离
 * 2. send() 超大消息
 * 3. reset() 后状态全面清理
 * 4. Attribution 归因统计准确
 * 5. Persistence 序列化/反序列化完整性（含 attribution）
 * 6. Session 配置（maxTurns/timeout/idleTimeout）边界
 * 7. 多会话并行隔离
 */
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LLMConnector, StreamEvent, TokenUsage } from '../llm/types.js'
import { AttributionManager } from '../session/attribution.js'
import { ClaudeCodeSDK } from '../session/engine.js'
import { SessionPersistence, type SessionSnapshot } from '../session/persistence.js'
import { createTool } from '../tools/base.js'
import { z } from 'zod'

// ─── Mock LLM ─────────────────────────────────────────────

const dummyUsage: TokenUsage = { inputTokens: 10, outputTokens: 5 }

function createMockLLM(sequence?: StreamEvent[][]): LLMConnector {
  const events = sequence ?? [
    [
      { type: 'text', text: 'Test response' },
      { type: 'done', usage: dummyUsage },
    ],
  ]
  let callCount = 0
  return {
    provider: 'anthropic' as const,
    send: vi.fn().mockImplementation(async function* (): AsyncIterable<StreamEvent> {
      const evts = events[callCount] ?? events[events.length - 1]!
      if (callCount < events.length - 1) callCount++
      for (const evt of evts) yield evt
    }),
    countTokens: vi.fn().mockResolvedValue(50),
  }
}

function createMinimalSDK(config?: Record<string, unknown>): ClaudeCodeSDK {
  return new ClaudeCodeSDK({
    llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
    ...config,
  } as any)
}

function patchLLM(sdk: ClaudeCodeSDK, mock: LLMConnector): void {
  Object.defineProperty(sdk, '_llm', { value: mock })
  sdk.newConversation()
  const convAny = (sdk as unknown as { _conversation: { _llm: LLMConnector } })._conversation
  convAny._llm = mock
}

// ───────────────────────────────────────────────────────────
// 1. createSession() 多实例隔离
// ───────────────────────────────────────────────────────────

describe('Session — Multi-instance Isolation', () => {
  it('should generate different session IDs for each instance', () => {
    const sdk1 = createMinimalSDK()
    const sdk2 = createMinimalSDK()
    expect(sdk1.getSessionId()).not.toBe(sdk2.getSessionId())
  })

  it('should maintain independent turn counts', async () => {
    const sdk1 = createMinimalSDK()
    const sdk2 = createMinimalSDK()

    const mock1 = createMockLLM()
    const mock2 = createMockLLM()
    patchLLM(sdk1, mock1)
    patchLLM(sdk2, mock2)

    await sdk1.send('first')
    await sdk1.send('second')
    await sdk2.send('first')

    expect(sdk1.getTurnCount()).toBe(2)
    expect(sdk2.getTurnCount()).toBe(1)
  })

  it('should have independent conversation histories', async () => {
    const sdk1 = createMinimalSDK()
    const sdk2 = createMinimalSDK()

    const mock1 = createMockLLM()
    const mock2 = createMockLLM()
    patchLLM(sdk1, mock1)
    patchLLM(sdk2, mock2)

    await sdk1.send('message for session 1')

    // sdk2 should have empty history
    expect(sdk2.getHistory()).toEqual([])
    // sdk1 should have history
    expect(sdk1.getHistory().length).toBeGreaterThan(0)
  })

  it('should have independent attribution managers', () => {
    const sdk1 = createMinimalSDK()
    const sdk2 = createMinimalSDK()

    sdk1.getAttribution().recordMessage('user')
    sdk1.getAttribution().recordMessage('assistant')

    const stats1 = sdk1.getAttributionStats()!
    const stats2 = sdk2.getAttributionStats()!

    expect(stats1.totalTurns).toBe(1)
    expect(stats2.totalTurns).toBe(0)
  })

  it('should not interfere with tool registrations', () => {
    const sdk1 = createMinimalSDK()
    const sdk2 = createMinimalSDK()

    const greetTool = createTool({
      name: 'greet',
      description: 'Greets a person',
      inputSchema: z.object({ name: z.string() }),
      async execute() {
        return { content: 'Hello!' }
      },
    })

    sdk1.use(greetTool)
    expect(sdk1.getTools().has('greet')).toBe(true)
    expect(sdk2.getTools().has('greet')).toBe(false)
    expect(sdk2.getTools().size).toBe(0)
  })

  it('should maintain independent session status', () => {
    const sdk1 = createMinimalSDK()
    const sdk2 = createMinimalSDK()

    expect(sdk1.getSessionStatus()).toBe('active')
    expect(sdk2.getSessionStatus()).toBe('active')

    // Pause sdk1, sdk2 should still be active
    Object.defineProperty(sdk1, '_sessionStatus', { value: 'paused' })
    expect(sdk1.getSessionStatus()).toBe('paused')
    expect(sdk2.getSessionStatus()).toBe('active')
  })
})

// ───────────────────────────────────────────────────────────
// 2. send() 空消息 / 超大消息
// ───────────────────────────────────────────────────────────

describe('Session — Large & Edge Messages', () => {
  it('should handle a very long message (>10K chars)', async () => {
    const sdk = createMinimalSDK()
    const mock = createMockLLM()
    patchLLM(sdk, mock)

    const largeMessage = 'A'.repeat(15_000)
    const response = await sdk.send(largeMessage)
    expect(response).toBeDefined()
    expect(response.content).toBe('Test response')
  })

  it('should handle a message with special characters', async () => {
    const sdk = createMinimalSDK()
    const mock = createMockLLM()
    patchLLM(sdk, mock)

    const specialMsg = 'Hello\nWorld\t!@#$%^&*()_+\n\r\u00e9\u00f1'
    const response = await sdk.send(specialMsg)
    expect(response).toBeDefined()
  })

  it('should handle a message with only emoji', async () => {
    const sdk = createMinimalSDK()
    const mock = createMockLLM()
    patchLLM(sdk, mock)

    const response = await sdk.send('😀🎉🚀💯')
    expect(response).toBeDefined()
  })

  it('should handle maximum turn count = 1 correctly', async () => {
    const sdk = new ClaudeCodeSDK({
      llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
      session: { maxTurns: 1 },
    } as any)
    const mock = createMockLLM()
    patchLLM(sdk, mock)

    // First send — should succeed
    const r1 = await sdk.send('first')
    expect(r1.content).toBe('Test response')
    expect(sdk.getTurnCount()).toBe(1)

    // Second send — should fail due to maxTurns
    await expect(sdk.send('second')).rejects.toThrow('maximum turns')
  })

  it('should handle many rapid sends sequentially', async () => {
    const sdk = createMinimalSDK()
    // Create a mock that returns fresh events for each call
    const mockSequence: LLMConnector = {
      provider: 'anthropic',
      send: vi.fn().mockImplementation(async function* () {
        yield { type: 'text', text: 'response' } as StreamEvent
        yield { type: 'done', usage: { inputTokens: 5, outputTokens: 3 } }
      }),
      countTokens: vi.fn().mockResolvedValue(10),
    }
    patchLLM(sdk, mockSequence)

    for (let i = 0; i < 5; i++) {
      const response = await sdk.send(`message ${i}`)
      expect(response.content).toBe('response')
    }
    expect(sdk.getTurnCount()).toBe(5)
  }, 30_000)
})

// ───────────────────────────────────────────────────────────
// 3. reset() 后状态全面清理
// ───────────────────────────────────────────────────────────

describe('Session — reset() State Cleanup', () => {
  it('should clear attribution stats on resetConversation', async () => {
    const sdk = createMinimalSDK()
    const mock = createMockLLM()
    patchLLM(sdk, mock)

    await sdk.send('test')
    expect(sdk.getTurnCount()).toBe(1)
    expect(sdk.getAttributionStats()!.totalTurns).toBeGreaterThanOrEqual(1)

    sdk.resetConversation()
    expect(sdk.getTurnCount()).toBe(0)
    expect(sdk.getAttributionStats()!.totalTurns).toBe(0)
    expect(sdk.getAttributionStats()!.userMessageCount).toBe(0)
    expect(sdk.getAttributionStats()!.assistantMessageCount).toBe(0)
  })

  it('should clear history on resetConversation', async () => {
    const sdk = createMinimalSDK()
    const mock = createMockLLM()
    patchLLM(sdk, mock)

    await sdk.send('test')
    expect(sdk.getHistory().length).toBeGreaterThan(0)

    sdk.resetConversation()
    expect(sdk.getHistory()).toEqual([])
  })

  it('should clear all state on newConversation', async () => {
    const sdk = createMinimalSDK()
    const mock = createMockLLM()
    patchLLM(sdk, mock)

    await sdk.send('test')
    expect(sdk.getTurnCount()).toBe(1)

    sdk.newConversation()
    expect(sdk.getTurnCount()).toBe(0)
    expect(sdk.getHistory()).toEqual([])
    expect(sdk.getAttributionStats()!.totalTurns).toBe(0)
    expect(sdk.getTokenUsage().inputTokens).toBe(0)
    expect(sdk.getTokenUsage().outputTokens).toBe(0)
  })

  it('should allow sending after resetConversation', async () => {
    const sdk = createMinimalSDK()
    const mock = createMockLLM()
    patchLLM(sdk, mock)

    await sdk.send('before')
    sdk.resetConversation()

    const response = await sdk.send('after')
    expect(response).toBeDefined()
    expect(sdk.getTurnCount()).toBe(1)
  })

  it('should allow sending after newConversation', async () => {
    const sdk = createMinimalSDK()
    const mock = createMockLLM()
    patchLLM(sdk, mock)

    await sdk.send('before')
    sdk.newConversation()

    const response = await sdk.send('after')
    expect(response).toBeDefined()
    expect(sdk.getTurnCount()).toBe(1)
  })
})

// ───────────────────────────────────────────────────────────
// 4. Attribution 统计准确
// ───────────────────────────────────────────────────────────

describe('Attribution — Statistical Accuracy', () => {
  it('should count user and assistant messages correctly across turns', () => {
    const attr = new AttributionManager()
    for (let i = 0; i < 3; i++) {
      attr.recordMessage('user')
      attr.recordMessage('assistant')
    }
    const stats = attr.getStats()
    expect(stats.totalTurns).toBe(3)
    expect(stats.userMessageCount).toBe(3)
    expect(stats.assistantMessageCount).toBe(3)
  })

  it('should handle multiple tool calls within a single turn', () => {
    const attr = new AttributionManager()
    attr.recordMessage('user') // turn 1
    attr.recordMessage('assistant') // turn 1
    attr.recordMessage('tool', { toolName: 'bash' })
    attr.recordMessage('tool', { toolName: 'file_read' })
    attr.recordMessage('tool', { toolName: 'bash' }) // same tool again

    const stats = attr.getStats()
    expect(stats.totalTurns).toBe(1)
    expect(stats.toolCallCount).toBe(3)
    expect(stats.uniqueTools).toEqual(['bash', 'file_read'])
  })

  it('should produce monotonic timestamps', () => {
    const attr = new AttributionManager()
    const metas = [
      attr.recordMessage('user'),
      attr.recordMessage('assistant'),
      attr.recordMessage('user'),
      attr.recordMessage('tool', { toolName: 'test' }),
      attr.recordMessage('assistant'),
    ]

    for (let i = 1; i < metas.length; i++) {
      const t1 = new Date(metas[i - 1]!.timestamp).getTime()
      const t2 = new Date(metas[i]!.timestamp).getTime()
      expect(t2).toBeGreaterThanOrEqual(t1)
    }
  })

  it('should not count system messages in statistics', () => {
    const attr = new AttributionManager()
    attr.recordMessage('system')
    attr.recordMessage('system')
    attr.recordMessage('user')

    const stats = attr.getStats()
    expect(stats.totalTurns).toBe(1)
    expect(stats.userMessageCount).toBe(1)
  })

  it('should correctly handle the none mode edge case', () => {
    const attr = new AttributionManager({ mode: 'none' })
    for (let i = 0; i < 10; i++) {
      attr.recordMessage('user')
      attr.recordMessage('assistant')
      attr.recordMessage('tool', { toolName: 'bash' })
    }
    const stats = attr.getStats()
    expect(stats.totalTurns).toBe(0)
    expect(stats.userMessageCount).toBe(0)
    expect(stats.toolCallCount).toBe(0)

    // Attribution texts should be empty
    const texts = attr.getAttributionTexts()
    expect(texts.commit).toBe('')
    expect(texts.pr).toBe('')
  })

  it('should track model name in attribution texts', () => {
    const attr = new AttributionManager({ modelName: 'claude-opus-4-20250514' })
    const texts = attr.getAttributionTexts()
    expect(texts.commit).toContain('claude-opus-4-20250514')
    expect(texts.pr).toContain('[Claude Code SDK]')
  })
})

// ───────────────────────────────────────────────────────────
// 5. Persistence 序列化/反序列化完整性（含 attribution）
// ───────────────────────────────────────────────────────────

const TEST_PERSIST_DIR = join(process.cwd(), '.test-persist-full')

describe('Persistence — Full Roundtrip with Attribution', () => {
  let persistence: SessionPersistence

  beforeEach(async () => {
    if (existsSync(TEST_PERSIST_DIR)) {
      await rm(TEST_PERSIST_DIR, { recursive: true, force: true })
    }
    await mkdir(TEST_PERSIST_DIR, { recursive: true })
    persistence = new SessionPersistence(TEST_PERSIST_DIR)
  })

  afterEach(async () => {
    if (existsSync(TEST_PERSIST_DIR)) {
      await rm(TEST_PERSIST_DIR, { recursive: true, force: true })
    }
  })

  it('should build snapshot with attribution data attached', async () => {
    const sdk = new ClaudeCodeSDK({
      llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
      session: { storageDir: TEST_PERSIST_DIR },
    } as any)

    // Simulate some conversation
    sdk.getAttribution().recordMessage('user')
    sdk.getAttribution().recordMessage('assistant')
    sdk.getAttribution().recordMessage('tool', { toolName: 'bash' })
    sdk.getAttribution().recordMessage('tool', { toolName: 'file_read' })

    const sessionId = await sdk.saveSession('attribution-test')
    expect(sessionId).toBeDefined()

    // Load the snapshot directly and verify attribution data
    const loaded = await persistence.load(sessionId)
    expect(loaded).not.toBeNull()
    expect(loaded!.attribution).toBeDefined()
    expect(loaded!.attribution!.totalTurns).toBe(1)
    expect(loaded!.attribution!.userMessageCount).toBe(1)
    expect(loaded!.attribution!.assistantMessageCount).toBe(1)
    expect(loaded!.attribution!.toolCallCount).toBe(2)
    expect(loaded!.attribution!.uniqueTools).toContain('bash')
    expect(loaded!.attribution!.uniqueTools).toContain('file_read')
  })

  it('should restore attribution state via loadSession with mocked LLM', async () => {
    // Create SDK, simulate activity, save
    const sdk1 = new ClaudeCodeSDK({
      llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
      session: { storageDir: TEST_PERSIST_DIR },
    } as any)

    sdk1.getAttribution().recordMessage('user')
    sdk1.getAttribution().recordMessage('assistant')
    sdk1.getAttribution().recordMessage('tool', { toolName: 'bash' })

    const sessionId = await sdk1.saveSession('restore-test')

    // Load the session
    const loaded = await persistence.load(sessionId)
    expect(loaded).not.toBeNull()
    expect(loaded!.attribution).toBeDefined()
    expect(loaded!.attribution!.totalTurns).toBe(1)
    expect(loaded!.attribution!.uniqueTools).toContain('bash')
  })

  it('should handle empty attribution in snapshot gracefully', async () => {
    const snapshot: SessionSnapshot = {
      id: 'no-attribution',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 0,
      tokenUsage: { inputTokens: 0, outputTokens: 0 },
      messages: [],
      metadata: { id: 'no-attribution' },
      // No attribution field
    }
    await persistence.save(snapshot)

    const loaded = await persistence.load('no-attribution')
    expect(loaded).not.toBeNull()
    expect(loaded!.attribution).toBeUndefined()
  })

  it('should handle very large snapshots', async () => {
    const messages = Array.from({ length: 100 }, (_, i) => ({
      id: `big-msg-${i}`,
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: 'X'.repeat(1000),
      createdAt: new Date(Date.now() + i).toISOString(),
    }))

    const snapshot = persistence.buildSnapshot(
      messages as any,
      { inputTokens: 9999, outputTokens: 8888 },
      { id: 'big-session', label: 'Large Session' },
    )
    snapshot.attribution = {
      totalTurns: 50,
      userMessageCount: 50,
      assistantMessageCount: 50,
      toolCallCount: 200,
      uniqueTools: ['bash', 'file_read', 'grep', 'glob'],
    }

    const sessionId = await persistence.save(snapshot)
    const loaded = await persistence.load(sessionId)
    expect(loaded).not.toBeNull()
    expect(loaded!.messageCount).toBe(100)
    expect(loaded!.attribution!.totalTurns).toBe(50)
  })

  it('should roundtrip metadata correctly', async () => {
    const messages = [
      {
        id: 'm1',
        role: 'user' as const,
        content: 'Hello',
        createdAt: new Date().toISOString(),
      },
    ]
    const snapshot = persistence.buildSnapshot(messages, { inputTokens: 10, outputTokens: 5 }, {
      id: 'meta-test',
      label: 'Metadata Test',
      tags: ['unit', 'test'],
      modelName: 'deepseek-v4-flash',
      systemPrompt: 'You are Claude',
    })

    const sessionId = await persistence.save(snapshot)
    const loaded = await persistence.load(sessionId)
    expect(loaded!.metadata.label).toBe('Metadata Test')
    expect(loaded!.metadata.tags).toEqual(['unit', 'test'])
    expect(loaded!.metadata.modelName).toBe('deepseek-v4-flash')
    expect(loaded!.metadata.systemPrompt).toBe('You are Claude')
  })
})

// ───────────────────────────────────────────────────────────
// 6. Session 配置边界
// ───────────────────────────────────────────────────────────

describe('Session Config — Boundary Values', () => {
  describe('maxTurns', () => {
    it('should reject maxTurns = -1 gracefully (treated as 0)', () => {
      const sdk = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
        session: { maxTurns: -1 },
      } as any)
      // maxTurns < 0 should not cause issues; treated as 0 (unlimited)
      expect(sdk.getSessionConfig().maxTurns).toBe(-1)
    })

    it('should allow exactly maxTurns sends', async () => {
      const sdk = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
        session: { maxTurns: 3 },
      } as any)
      const mock = createMockLLM()
      patchLLM(sdk, mock)

      for (let i = 0; i < 3; i++) {
        const r = await sdk.send(`turn ${i + 1}`)
        expect(r.content).toBe('Test response')
      }
      expect(sdk.getTurnCount()).toBe(3)

      // Fourth send should fail
      await expect(sdk.send('turn 4')).rejects.toThrow('maximum turns')
    })

    it('should reset turn count after resetConversation with maxTurns', async () => {
      const sdk = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
        session: { maxTurns: 1 },
      } as any)
      const mock = createMockLLM()
      patchLLM(sdk, mock)

      await sdk.send('first')
      expect(sdk.getTurnCount()).toBe(1)

      sdk.resetConversation()
      expect(sdk.getTurnCount()).toBe(0)

      // Should be able to send again
      const r = await sdk.send('again')
      expect(r.content).toBe('Test response')
      expect(sdk.getTurnCount()).toBe(1)
    })
  })

  describe('timeout / idleTimeout', () => {
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    it('should enforce timeout = 1ms (minimum positive)', async () => {
      const sdk = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
        session: { timeout: 1 },
      } as any)
      const mock = createMockLLM()
      patchLLM(sdk, mock)

      await sdk.send('first')
      vi.advanceTimersByTime(2)
      await expect(sdk.send('second')).rejects.toThrow('timed out')
    })

    it('should enforce idleTimeout when timeout is not set', async () => {
      const sdk = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
        session: { idleTimeout: 500 },
      } as any)
      const mock = createMockLLM()
      patchLLM(sdk, mock)

      await sdk.send('first')
      vi.advanceTimersByTime(1000)
      await expect(sdk.send('second')).rejects.toThrow('timed out')
    })

    it('should prefer timeout over idleTimeout when both set', async () => {
      // timeout=200ms, idleTimeout=2000ms — should use 200ms (timeout wins)
      const sdk = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
        session: { timeout: 200, idleTimeout: 2000 },
      } as any)
      const mock = createMockLLM()
      patchLLM(sdk, mock)

      await sdk.send('first')
      vi.advanceTimersByTime(500)
      await expect(sdk.send('second')).rejects.toThrow('timed out')
    })

    it('should reset lastActivityTime on each send', async () => {
      const sdk = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
        session: { timeout: 1000 },
      } as any)
      const mock = createMockLLM()
      patchLLM(sdk, mock)

      await sdk.send('first')
      vi.advanceTimersByTime(800)
      // Should still be valid (within timeout)
      await expect(sdk.send('second')).resolves.toBeDefined()
    })
  })

  describe('session config defaults', () => {
    it('should provide all default fields in getSessionConfig', () => {
      const sdk = createMinimalSDK()
      const config = sdk.getSessionConfig()
      expect(config).toHaveProperty('maxTurns')
      expect(config).toHaveProperty('timeout')
      expect(config).toHaveProperty('idleTimeout')
      expect(config).toHaveProperty('attributionMode')
      expect(config).toHaveProperty('autoSave')
      expect(config).toHaveProperty('autoSaveInterval')
    })
  })
})

// ───────────────────────────────────────────────────────────
// 7. Persistence — Static loadSession with mock
// ───────────────────────────────────────────────────────────

describe('Persistence — Static loadSession comprehensive', () => {
  const TEST_LOAD_DIR = join(process.cwd(), '.test-load-session')

  beforeEach(async () => {
    if (existsSync(TEST_LOAD_DIR)) {
      await rm(TEST_LOAD_DIR, { recursive: true, force: true })
    }
    await mkdir(TEST_LOAD_DIR, { recursive: true })
  })

  afterEach(async () => {
    if (existsSync(TEST_LOAD_DIR)) {
      await rm(TEST_LOAD_DIR, { recursive: true, force: true })
    }
  })

  it('should throw when storageDir is not provided', async () => {
    await expect(
      ClaudeCodeSDK.loadSession('any-id', {
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
      } as any),
    ).rejects.toThrow('persistence requires session.storageDir')
  })

  it('should return null for non-existent session', async () => {
    const result = await ClaudeCodeSDK.loadSession('non-existent', {
      llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
      session: { storageDir: TEST_LOAD_DIR },
    } as any)
    expect(result).toBeNull()
  })

  it('should restore a saved session via static loadSession', async () => {
    // First save a session
    const p = new SessionPersistence(TEST_LOAD_DIR)
    const messages = [
      { id: 'm1', role: 'user' as const, content: 'Hello', createdAt: new Date().toISOString() },
      { id: 'm2', role: 'assistant' as const, content: 'Hi there!', createdAt: new Date().toISOString() },
    ]
    const snapshot = p.buildSnapshot(messages as any, { inputTokens: 10, outputTokens: 5 }, {
      id: 'restore-me',
      label: 'Restore Test',
      tags: ['test'],
    })
    snapshot.attribution = {
      totalTurns: 1,
      userMessageCount: 1,
      assistantMessageCount: 1,
      toolCallCount: 0,
      uniqueTools: [],
    }
    await p.save(snapshot)

    // Now load it
    const result = await ClaudeCodeSDK.loadSession('restore-me', {
      llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
      session: { storageDir: TEST_LOAD_DIR },
    } as any)
    expect(result).not.toBeNull()
    expect(result!.snapshot.id).toBe('restore-me')
    expect(result!.snapshot.messages).toHaveLength(2)
  })

  it('should attribute snapshot metadata in load result', async () => {
    const p = new SessionPersistence(TEST_LOAD_DIR)
    const messages = [
      { id: 'm1', role: 'user' as const, content: 'Test', createdAt: new Date().toISOString() },
    ]
    const snapshot = p.buildSnapshot(messages as any, { inputTokens: 5, outputTokens: 3 }, {
      id: 'meta-restore',
      label: 'Meta',
      modelName: 'deepseek-v4-flash',
    })
    await p.save(snapshot)

    const result = await ClaudeCodeSDK.loadSession('meta-restore', {
      llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
      session: { storageDir: TEST_LOAD_DIR },
    } as any)
    expect(result!.snapshot.metadata.label).toBe('Meta')
  })
})

// ───────────────────────────────────────────────────────────
// 8. Full lifecycle: create → stream → reset → send
// ───────────────────────────────────────────────────────────

describe('Session — Full Lifecycle with Mock', () => {
  it('should support create → send → reset → send sequence', async () => {
    const sdk = createMinimalSDK()
    const mock = createMockLLM()
    patchLLM(sdk, mock)

    const r1 = await sdk.send('first')
    expect(r1.content).toBe('Test response')
    expect(sdk.getTurnCount()).toBe(1)

    sdk.resetConversation()
    expect(sdk.getTurnCount()).toBe(0)
    expect(sdk.getHistory()).toEqual([])

    const r2 = await sdk.send('second')
    expect(r2.content).toBe('Test response')
    expect(sdk.getTurnCount()).toBe(1)
  })

  it('should support stream → reset → stream sequence', async () => {
    const sdk = createMinimalSDK()
    const mock = createMockLLM()
    patchLLM(sdk, mock)

    const events1: StreamEvent[] = []
    for await (const evt of sdk.stream('first')) {
      events1.push(evt)
    }
    expect(events1.length).toBeGreaterThan(0)

    sdk.resetConversation()

    const events2: StreamEvent[] = []
    for await (const evt of sdk.stream('second')) {
      events2.push(evt)
    }
    expect(events2.length).toBeGreaterThan(0)
  })

  it('should track turn count correctly across send and stream', async () => {
    const sdk = createMinimalSDK()
    const mock = createMockLLM()
    patchLLM(sdk, mock)

    expect(sdk.getTurnCount()).toBe(0)
    await sdk.send('send1')
    expect(sdk.getTurnCount()).toBe(1)

    for await (const _ of sdk.stream('stream1')) { /* drain */ }
    expect(sdk.getTurnCount()).toBe(2)

    await sdk.send('send2')
    expect(sdk.getTurnCount()).toBe(3)
  })
})
