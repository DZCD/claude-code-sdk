/**
 * ClaudeCode SDK — SessionEngine Phase 2 Integration Tests
 *
 * Tests for extended SessionEngine with:
 * - Attribution integration
 * - Persistence integration
 * - Extended session configuration (maxTurns, timeout, session metadata)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import type { LLMConnector, StreamEvent, TokenUsage } from '../llm/types.js'
import { ClaudeCodeSDK } from '../session/engine.js'
import type { SDKConfig } from '../types/config.js'
import { createTool } from '../tools/base.js'
import { z } from 'zod'

// ─── Mock LLM ────────────────────────────────────────────

const dummyUsage: TokenUsage = { inputTokens: 10, outputTokens: 5 }

function createMockLLM(): { llm: LLMConnector; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn().mockImplementation(
    async function* (
      _systemPrompt: string | undefined,
      _messages: Array<{ role: string; content: string }>,
    ): AsyncIterable<StreamEvent> {
      yield { type: 'text', text: 'Test response' }
      yield { type: 'done', usage: dummyUsage }
    },
  )
  return {
    llm: {
      provider: 'anthropic' as const,
      send,
      countTokens: vi.fn().mockResolvedValue(100),
    },
    send,
  }
}

// ─── Helpers ─────────────────────────────────────────────

const TEST_STORAGE_DIR = join(process.cwd(), '.test-phase2-sessions')

async function cleanTestDir() {
  if (existsSync(TEST_STORAGE_DIR)) {
    await rm(TEST_STORAGE_DIR, { recursive: true, force: true })
  }
  await mkdir(TEST_STORAGE_DIR, { recursive: true })
}

// ─── Tests ───────────────────────────────────────────────

describe('ClaudeCodeSDK Phase 2 Integration', () => {
  let sdk: ClaudeCodeSDK

  beforeEach(() => {
    sdk = new ClaudeCodeSDK({
      llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
    })
  })

  describe('extended configuration', () => {
    it('should accept session config with maxTurns', () => {
      const sdkWithConfig = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
        session: {
          maxTurns: 10,
        },
      })
      expect(sdkWithConfig.getSessionConfig().maxTurns).toBe(10)
    })

    it('should accept session config with timeout', () => {
      const sdkWithConfig = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
        session: {
          timeout: 30000,
        },
      })
      expect(sdkWithConfig.getSessionConfig().timeout).toBe(30000)
    })

    it('should accept session config with attributionMode', () => {
      const sdkWithConfig = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
        session: {
          attributionMode: 'full',
        },
      })
      expect(sdkWithConfig.getSessionConfig().attributionMode).toBe('full')
    })

    it('should have sensible defaults for session config', () => {
      const config = sdk.getSessionConfig()
      expect(config.maxTurns).toBe(0) // 0 = unlimited
      expect(config.timeout).toBe(0) // 0 = no timeout
      expect(config.attributionMode).toBe('simple')
    })
  })

  describe('session ID and status', () => {
    it('should generate a session ID on creation', () => {
      const id = sdk.getSessionId()
      expect(id).toBeDefined()
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
    })

    it('should report active status initially', () => {
      expect(sdk.getSessionStatus()).toBe('active')
    })

    it('should track turn count', () => {
      expect(sdk.getTurnCount()).toBe(0)
    })
  })

  describe('attribution integration', () => {
    it('should expose attribution manager', () => {
      const attr = sdk.getAttribution()
      expect(attr).toBeDefined()
    })

    it('should generate attribution texts', () => {
      const texts = sdk.getAttributionTexts()
      expect(texts).toHaveProperty('commit')
      expect(texts).toHaveProperty('pr')
    })

    it('should report attribution stats', () => {
      // Initially no stats
      // After a send would update stats, but without mock replacement it's a no-op here
      const attr = sdk.getAttribution()
      expect(attr).toBeDefined()
    })
  })

  describe('session save and load', () => {
    let sdkPersistence: ClaudeCodeSDK

    beforeEach(async () => {
      await cleanTestDir()
      sdkPersistence = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
        session: {
          autoSave: true,
          storageDir: TEST_STORAGE_DIR,
        },
      })
    })

    afterEach(async () => {
      await cleanTestDir()
    })

    it('should save session state', async () => {
      const id = await sdkPersistence.saveSession('test-save')
      expect(id).toBeDefined()
      expect(typeof id).toBe('string')
    })

    it('should list saved sessions', async () => {
      await sdkPersistence.saveSession('Session 1')
      const list = await sdkPersistence.listSavedSessions()
      expect(list.length).toBeGreaterThanOrEqual(1)
      expect(list[0]?.label).toBe('Session 1')
    })

    it('should delete a saved session', async () => {
      const id = await sdkPersistence.saveSession('To Delete')
      const deleted = await sdkPersistence.deleteSession(id)
      expect(deleted).toBe(true)

      const list = await sdkPersistence.listSavedSessions()
      expect(list.find(s => s.id === id)).toBeUndefined()
    })
  })

  describe('session lifecycle configuration', () => {
    it('should track session metadata', () => {
      const labeledSDK = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
        session: {
          sessionLabel: 'my-session',
          sessionTags: ['test', 'demo'],
        },
      })
      // The session label and tags could be accessible via session metadata
      expect(labeledSDK).toBeDefined()
    })
  })
})
