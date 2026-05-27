/**
 * Integration Tests — SessionEngine (ClaudeCodeSDK)
 *
 * Tests the full session lifecycle with mock LLM.
 * Covers: send, stream, session lifecycle, permission checks,
 * tool registration, conversation reset/new.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { LLMConnector, StreamEvent, TokenUsage } from '../llm/types.js'
import { ClaudeCodeSDK, type SessionResponse } from '../session/engine.js'
import { createTool } from '../tools/base.js'
import type { SDKConfig } from '../types/config.js'

// ─── Mock LLM Factory ────────────────────────────────────

function createMockLLM(sequence: StreamEvent[][]): LLMConnector {
  let callCount = 0
  return {
    provider: 'anthropic' as const,
    send: vi.fn().mockImplementation(async function* (
      _systemPrompt: string | undefined,
      _messages: Array<{ role: string; content: string }>,
    ): AsyncIterable<StreamEvent> {
      const events = sequence[callCount] ?? []
      if (callCount < sequence.length - 1) {
        callCount++
      }
      for (const event of events) {
        yield event
      }
    }),
    countTokens: vi.fn().mockResolvedValue(100),
  }
}

// ─── Test Tools ──────────────────────────────────────────

const greetTool = createTool({
  name: 'greet',
  description: 'Greets a person',
  inputSchema: z.object({ name: z.string() }),
  async execute(input) {
    return { data: input.name, content: `Hello, ${input.name}!` }
  },
})

const addTool = createTool({
  name: 'add',
  description: 'Adds two numbers',
  inputSchema: z.object({ a: z.number(), b: z.number() }),
  async execute(input) {
    const result = input.a + input.b
    return { data: result, content: `Result: ${result}` }
  },
})

// ─── Helper: Create SDK with mock LLM ────────────────────

function createSDK(
  sequence: StreamEvent[][],
  config?: Partial<SDKConfig>,
): {
  sdk: ClaudeCodeSDK
  mockSend: ReturnType<typeof vi.fn>
} {
  const mockLLM = createMockLLM(sequence)
  const sdk = new ClaudeCodeSDK(
    config ?? {
      llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
    },
  )
  // Override the internal LLM with our mock
  // We need to replace it after construction
  Object.defineProperty(sdk, '_llm', { value: mockLLM })
  Object.defineProperty(sdk, '_conversation', {
    value: new (class {
      async *send(msg: string) {
        for await (const evt of mockLLM.send(undefined, [], [])) {
          yield evt
        }
      }
      getHistory() {
        return []
      }
      reset() {}
      getTokenUsage() {
        return { inputTokens: 0, outputTokens: 0 }
      }
    })(),
  })

  return { sdk, mockSend: mockLLM.send as ReturnType<typeof vi.fn> }
}

// ─── Tests ───────────────────────────────────────────────

describe('ClaudeCodeSDK Integration', () => {
  let sdk: ClaudeCodeSDK

  beforeEach(() => {
    // We'll create fresh SDK in each test
  })

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = ''
  })

  describe('session lifecycle', () => {
    it('should create SDK with config and register tools', () => {
      sdk = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
      })
      expect(sdk).toBeInstanceOf(ClaudeCodeSDK)
      expect(sdk.getTools()).toBeDefined()
      expect(sdk.getPermissions()).toBeDefined()
    })

    it('should register tools via use() and chain', () => {
      sdk = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
      })
      const ret = sdk.use(greetTool, addTool)
      expect(ret).toBe(sdk) // chaining
      expect(sdk.getTools().has('greet')).toBe(true)
      expect(sdk.getTools().has('add')).toBe(true)
      expect(sdk.getTools().size).toBe(2)
    })

    it('should start with empty conversation', () => {
      sdk = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
      })
      expect(sdk.getHistory()).toEqual([])
    })
  })

  describe('send() with mock LLM', () => {
    it('should return text content from send()', async () => {
      const mockLLM = createMockLLM([
        [
          { type: 'text', text: 'Hello, world!' },
          { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
        ],
      ])

      sdk = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
      })

      // Patch llm
      const sdkAny = sdk as unknown as {
        _llm: LLMConnector
        _conversation: ConversationManager
      }
      sdkAny._llm = mockLLM

      // Recreate conversation to use new LLM
      sdk.newConversation()
      const convAny = sdkAny._conversation as unknown as { _llm: LLMConnector }
      convAny._llm = mockLLM

      const response = await sdk.send('Hello')
      expect(response.content).toBe('Hello, world!')
      expect(response.usage.inputTokens).toBe(10)
      expect(response.usage.outputTokens).toBe(5)
    })

    it('should handle streaming via stream()', async () => {
      const mockLLM = createMockLLM([
        [
          { type: 'text', text: 'Part 1' },
          { type: 'text', text: ' Part 2' },
          { type: 'done', usage: { inputTokens: 5, outputTokens: 8 } },
        ],
      ])

      sdk = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
      })

      const sdkAny = sdk as unknown as {
        _llm: LLMConnector
        _conversation: { _llm: LLMConnector }
      }
      sdkAny._llm = mockLLM
      sdk.newConversation()
      sdkAny._conversation._llm = mockLLM

      const events: StreamEvent[] = []
      for await (const event of sdk.stream('Hi')) {
        events.push(event)
      }

      expect(events).toHaveLength(3)
      expect(events[0]).toEqual({ type: 'text', text: 'Part 1' })
    })
  })

  describe('tool calls through SDK', () => {
    it('should report tool calls in session response', async () => {
      const mockLLM = createMockLLM([
        [
          { type: 'text', text: 'Let me calculate' },
          {
            type: 'tool_use_start',
            id: 't1',
            name: 'add',
            input: { a: 3, b: 4 },
          },
          { type: 'tool_use_end', id: 't1', output: '{"a":3,"b":4}' },
          { type: 'done', usage: { inputTokens: 20, outputTokens: 15 } },
        ],
        [
          { type: 'text', text: 'The answer is 7' },
          { type: 'done', usage: { inputTokens: 30, outputTokens: 5 } },
        ],
      ])

      sdk = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
      })
      sdk.use(addTool)

      const sdkAny = sdk as unknown as {
        _llm: LLMConnector
        _conversation: { _llm: LLMConnector }
      }
      sdkAny._llm = mockLLM
      sdk.newConversation()
      sdkAny._conversation._llm = mockLLM

      const response = await sdk.send('Add 3 and 4')

      // Should contain the final text
      expect(response.content).toContain('The answer is 7')
      // Should have recorded tool calls
      expect(response.toolCalls).toHaveLength(1)
      expect(response.toolCalls[0]?.toolName).toBe('add')
      expect(response.toolCalls[0]?.input).toEqual({ a: 3, b: 4 })
    })
  })

  describe('conversation management', () => {
    it('should reset conversation state', () => {
      sdk = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
      })

      // Manually add some state via the conversation manager
      sdk.getPermissions() // access just to verify

      // Add a message to history via internal access
      const conv = (
        sdk as unknown as {
          _conversation: { addMessage: (m: unknown) => void }
        }
      )._conversation
      conv.addMessage({
        id: 'test',
        role: 'user',
        content: 'Hello',
        createdAt: new Date().toISOString(),
      })

      expect(sdk.getHistory()).toHaveLength(1)

      sdk.resetConversation()
      expect(sdk.getHistory()).toEqual([])
    })

    it('should create a new conversation via newConversation', () => {
      sdk = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
      })
      sdk.use(greetTool)

      const oldConv = (sdk as unknown as { _conversation: object })._conversation
      sdk.newConversation()
      const newConv = (sdk as unknown as { _conversation: object })._conversation

      // Should be a different conversation instance
      expect(newConv).not.toBe(oldConv)
      // Tools should still be registered
      expect(sdk.getTools().has('greet')).toBe(true)
    })
  })

  describe('permission integration', () => {
    it('should set permission mode via withPermissionMode', () => {
      sdk = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
      })
      sdk.withPermissionMode('plan')
      expect(sdk.getPermissions().getMode()).toBe('plan')
    })

    it('should add permission rules via withPermissionRules', () => {
      sdk = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
      })
      sdk.withPermissionRules([
        {
          pattern: 'dangerous_tool',
          behavior: 'deny',
          source: 'user' as const,
        },
      ])
      expect(sdk.getPermissions().getRules()).toHaveLength(1)
    })
  })

  describe('config access', () => {
    it('should expose config manager', () => {
      sdk = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'test-key', model: 'test-model' },
        permissionMode: 'manual',
      })
      const config = sdk.getConfig()
      expect(config.getConfig().llm.apiKey).toBe('test-key')
      expect(config.getConfig().permissionMode).toBe('manual')
    })

    it('should expose LLM connector', () => {
      sdk = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'test-key', model: 'test-model' },
      })
      const llm = sdk.getLLM()
      expect(llm.provider).toBe('anthropic')
    })
  })

  describe('session error handling', () => {
    it('should throw error when LLM returns error', async () => {
      const errorMock: LLMConnector = {
        provider: 'anthropic',
        send: async function* () {
          yield { type: 'error', error: new Error('LLM error occurred') }
        },
        countTokens: vi.fn().mockResolvedValue(100),
      }

      sdk = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
      })

      const sdkAny = sdk as unknown as { _llm: LLMConnector }
      sdkAny._llm = errorMock
      sdk.newConversation() // recreate conversation with new LLM

      await expect(sdk.send('Hi')).rejects.toThrow('LLM error occurred')
    })

    it('should not throw for stream() error — yields error event', async () => {
      const errorMock: LLMConnector = {
        provider: 'anthropic',
        send: async function* () {
          yield { type: 'error', error: new Error('Stream error') }
        },
        countTokens: vi.fn().mockResolvedValue(100),
      }

      sdk = new ClaudeCodeSDK({
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'test-model' },
      })

      const sdkAny = sdk as unknown as { _llm: LLMConnector }
      sdkAny._llm = errorMock
      sdk.newConversation() // recreate conversation with new LLM

      // stream() should not throw but yield error event
      let caughtError: Error | null = null
      let sawErrorEvent = false
      try {
        for await (const event of sdk.stream('Hi')) {
          if (event.type === 'error') {
            sawErrorEvent = true
            caughtError = event.error
          }
        }
      } catch (e) {
        caughtError = e as Error
      }

      // Error should be yielded as an event, not thrown
      expect(sawErrorEvent).toBe(true)
      expect(caughtError?.message).toBe('Stream error')
    })
  })
})
