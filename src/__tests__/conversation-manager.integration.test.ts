/**
 * Integration Tests — ConversationManager
 *
 * Tests the ConversationManager with mock LLM responses.
 * Covers: text responses, tool_use → tool_result loop,
 * max_consecutive_tool_uses limit, auto-compact feature.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ConversationManager } from '../conversation/manager.js'
import type { LLMConnector, StreamEvent, TokenUsage } from '../llm/types.js'
import { createTool } from '../tools/base.js'
import { ToolRegistry } from '../tools/registry.js'
import type { Tool, ToolContext, ToolResult } from '../types/tool.js'

// ─── Mock LLM Connector Factory ──────────────────────────

function createMockLLM(sequence: StreamEvent[][]): LLMConnector {
  let callCount = 0
  const mockSend = vi.fn().mockImplementation(async function* (
    _systemPrompt: string | undefined,
    _messages: Array<{ role: string; content: string }>,
    _tools: Array<{
      name: string
      description: string
      input_schema: Record<string, unknown>
    }>,
  ): AsyncIterable<StreamEvent> {
    const events = sequence[callCount] ?? []
    if (sequence.length > 0) {
      callCount = Math.min(callCount + 1, sequence.length - 1)
    }
    for (const event of events) {
      yield event
    }
  })

  const mockCountTokens = vi.fn().mockResolvedValue(100)

  return {
    provider: 'anthropic' as const,
    send: mockSend,
    countTokens: mockCountTokens,
  }
}

// ─── Test Tools ──────────────────────────────────────────

const echoSchema = z.object({ message: z.string() })

const echoTool = createTool({
  name: 'echo',
  description: 'Echoes back the input',
  inputSchema: echoSchema,
  async execute(input, _context) {
    return { data: input.message, content: `Echo: ${input.message}` }
  },
})

const calcSchema = z.object({
  a: z.number(),
  b: z.number(),
})

const calcTool = createTool({
  name: 'calculator',
  description: 'Adds two numbers',
  inputSchema: calcSchema,
  async execute(input) {
    const sum = input.a + input.b
    return { data: sum, content: `Result: ${sum}` }
  },
})

// ─── Tests ───────────────────────────────────────────────

describe('ConversationManager Integration', () => {
  let mockLLM: LLMConnector
  let registry: ToolRegistry
  let cm: ConversationManager

  beforeEach(() => {
    registry = new ToolRegistry()
    registry.register(echoTool, calcTool)
  })

  describe('mock LLM — text response', () => {
    it('should yield text events from mock LLM', async () => {
      mockLLM = createMockLLM([
        [
          { type: 'text' as const, text: 'Hello' },
          { type: 'text' as const, text: ' world' },
          {
            type: 'done' as const,
            usage: { inputTokens: 10, outputTokens: 5 },
          },
        ],
      ])
      cm = new ConversationManager(mockLLM, registry, 'You are a helpful assistant.')

      const events: StreamEvent[] = []
      for await (const event of cm.send('Say hi')) {
        events.push(event)
      }

      expect(events).toHaveLength(3)
      expect(events[0]).toEqual({ type: 'text', text: 'Hello' })
      expect(events[1]).toEqual({ type: 'text', text: ' world' })
      expect(events[2]).toEqual({
        type: 'done',
        usage: { inputTokens: 10, outputTokens: 5 },
      })
    })

    it('should track token usage after done event', async () => {
      mockLLM = createMockLLM([
        [
          { type: 'text' as const, text: 'Reply' },
          {
            type: 'done' as const,
            usage: { inputTokens: 15, outputTokens: 8 },
          },
        ],
      ])
      cm = new ConversationManager(mockLLM, registry)

      for await (const _event of cm.send('Hi')) {
        // consume
      }

      const usage = cm.getTokenUsage()
      expect(usage.inputTokens).toBe(15)
      expect(usage.outputTokens).toBe(8)
    })

    it('should add user message to history after send', async () => {
      mockLLM = createMockLLM([
        [
          { type: 'text' as const, text: 'OK' },
          { type: 'done' as const, usage: { inputTokens: 5, outputTokens: 2 } },
        ],
      ])
      cm = new ConversationManager(mockLLM, registry)

      for await (const _event of cm.send('Hello there')) {
        // consume
      }

      const history = cm.getHistory()
      expect(history).toHaveLength(2) // user message + assistant response
      expect(history[0]?.role).toBe('user')
      expect(history[0]?.content).toBe('Hello there')
      expect(history[1]?.role).toBe('assistant')
      expect(Array.isArray(history[1]?.content)).toBe(true)
      expect((history[1]?.content as Array<{ text: string }>)[0]?.text).toBe('OK')
    })
  })

  describe('mock LLM — tool_use → tool_result loop', () => {
    it('should execute tool calls and continue the loop', async () => {
      // LLM returns: text → tool_use_start → tool_use_end → done (no more tools)
      mockLLM = createMockLLM([
        [
          { type: 'text' as const, text: 'Let me check' },
          {
            type: 'tool_use_start' as const,
            id: 'tool1',
            name: 'echo',
            input: { message: 'hello' },
          },
          {
            type: 'tool_use_end' as const,
            id: 'tool1',
            output: '{"message":"hello"}',
          },
          {
            type: 'done' as const,
            usage: { inputTokens: 20, outputTokens: 15 },
          },
        ],
        // Second LLM call (after tool result) → just text
        [
          { type: 'text' as const, text: 'Done with tool' },
          {
            type: 'done' as const,
            usage: { inputTokens: 30, outputTokens: 10 },
          },
        ],
      ])
      cm = new ConversationManager(mockLLM, registry)

      const events: StreamEvent[] = []
      for await (const event of cm.send('Use echo tool')) {
        events.push(event)
      }

      // Should have: text + tool_use_start + tool_use_end + done + text + done
      expect(events.length).toBeGreaterThan(3)

      const toolUseEvents = events.filter((e) => e.type === 'tool_use_start')
      expect(toolUseEvents).toHaveLength(1)
      if (toolUseEvents[0]?.type === 'tool_use_start') {
        expect(toolUseEvents[0].name).toBe('echo')
      }

      // Check that tool result was added to history (as proper ToolResultBlock[])
      const history = cm.getHistory()
      const toolResults = history.filter(
        (m) => m.role === 'user' && typeof m.content !== 'string' && m.content.some((c) => c.type === 'tool_result'),
      )
      expect(toolResults).toHaveLength(1)
      const trMsg = toolResults[0]!
      const trBlock = (trMsg.content as Array<{ type: string }>).find((c) => c.type === 'tool_result')
      expect(trBlock).toBeDefined()
    })

    it('should handle multiple tool calls in one turn', async () => {
      mockLLM = createMockLLM([
        [
          {
            type: 'tool_use_start' as const,
            id: 't1',
            name: 'echo',
            input: { message: 'a' },
          },
          {
            type: 'tool_use_end' as const,
            id: 't1',
            output: '{"message":"a"}',
          },
          {
            type: 'tool_use_start' as const,
            id: 't2',
            name: 'calculator',
            input: { a: 1, b: 2 },
          },
          { type: 'tool_use_end' as const, id: 't2', output: '{"a":1,"b":2}' },
          {
            type: 'done' as const,
            usage: { inputTokens: 25, outputTokens: 20 },
          },
        ],
        [
          { type: 'text' as const, text: 'All done' },
          {
            type: 'done' as const,
            usage: { inputTokens: 35, outputTokens: 5 },
          },
        ],
      ])
      cm = new ConversationManager(mockLLM, registry)

      const events: StreamEvent[] = []
      for await (const event of cm.send('Use both tools')) {
        events.push(event)
      }

      const toolUseStarts = events.filter((e) => e.type === 'tool_use_start')
      expect(toolUseStarts).toHaveLength(2)

      const history = cm.getHistory()
      const toolResults = history.filter(
        (m) => m.role === 'user' && typeof m.content !== 'string' && m.content.some((c) => c.type === 'tool_result'),
      )
      expect(toolResults).toHaveLength(2)
    })

    it('should handle empty response from LLM (no tools, no text)', async () => {
      mockLLM = createMockLLM([[{ type: 'done' as const, usage: { inputTokens: 5, outputTokens: 1 } }]])
      cm = new ConversationManager(mockLLM, registry)

      const events: StreamEvent[] = []
      for await (const event of cm.send('Hello')) {
        events.push(event)
      }

      expect(events).toHaveLength(1)
      expect(events[0]?.type).toBe('done')
    })
  })

  describe('max_consecutive_tool_uses limit', () => {
    it('should stop after exceeding max tool call depth', async () => {
      // LLM always returns tool_use — infinite loop
      const alwaysTool = createMockLLM([
        [
          {
            type: 'tool_use_start' as const,
            id: 'loop',
            name: 'echo',
            input: { message: 'x' },
          },
          {
            type: 'tool_use_end' as const,
            id: 'loop',
            output: '{"message":"x"}',
          },
          {
            type: 'done' as const,
            usage: { inputTokens: 10, outputTokens: 5 },
          },
        ],
      ])
      // Override the sequence logic to always return the same tool response
      const simpleMock: LLMConnector = {
        provider: 'anthropic',
        send: async function* () {
          yield {
            type: 'tool_use_start' as const,
            id: 'loop',
            name: 'echo',
            input: { message: 'x' },
          }
          yield {
            type: 'tool_use_end' as const,
            id: 'loop',
            output: '{"message":"x"}',
          }
          yield {
            type: 'done' as const,
            usage: { inputTokens: 10, outputTokens: 5 },
          }
        },
        countTokens: vi.fn().mockResolvedValue(100),
      }

      cm = new ConversationManager(simpleMock, registry, 'Test')

      const events: StreamEvent[] = []
      for await (const event of cm.send('Loop please', {
        maxToolCallDepth: 3,
      })) {
        events.push(event)
      }

      // Should have an error event about exceeding max depth
      const errorEvents = events.filter((e) => e.type === 'error')
      expect(errorEvents.length).toBeGreaterThanOrEqual(1)
      if (errorEvents[0]?.type === 'error') {
        expect(errorEvents[0].error.message).toContain('maximum tool call depth')
      }

      // Should have exactly 3 tool_use_start events before error
      const toolUses = events.filter((e) => e.type === 'tool_use_start')
      expect(toolUses).toHaveLength(3)
    })

    it('should work with default maxToolCallDepth (50)', async () => {
      // Just verify it doesn't error on a short conversation
      mockLLM = createMockLLM([
        [
          { type: 'text' as const, text: 'Hello' },
          { type: 'done' as const, usage: { inputTokens: 5, outputTokens: 2 } },
        ],
      ])
      cm = new ConversationManager(mockLLM, registry)

      const events: StreamEvent[] = []
      for await (const event of cm.send('Hi')) {
        events.push(event)
      }

      const errors = events.filter((e) => e.type === 'error')
      expect(errors).toHaveLength(0)
    })
  })

  describe('conversation management', () => {
    it('should reset conversation state', async () => {
      mockLLM = createMockLLM([
        [
          { type: 'text' as const, text: 'OK' },
          { type: 'done' as const, usage: { inputTokens: 5, outputTokens: 3 } },
        ],
      ])
      cm = new ConversationManager(mockLLM, registry)

      for await (const _event of cm.send('Hi')) {
        // consume
      }

      expect(cm.messageCount).toBeGreaterThan(0)
      expect(cm.getTokenUsage().inputTokens).toBeGreaterThan(0)

      cm.reset()

      expect(cm.messageCount).toBe(0)
      expect(cm.getTokenUsage().inputTokens).toBe(0)
      expect(cm.getTokenUsage().outputTokens).toBe(0)
    })

    it('should support manual message addition', () => {
      mockLLM = createMockLLM([[]])
      cm = new ConversationManager(mockLLM, registry)

      cm.addMessage({
        id: 'manual-1',
        role: 'system',
        content: 'Custom system prompt',
      })

      expect(cm.messageCount).toBe(1)
      const history = cm.getHistory()
      expect(history[0]?.role).toBe('system')
      expect(history[0]?.content).toBe('Custom system prompt')
    })
  })

  describe('mock LLM — edge cases', () => {
    it('should handle tool_use_end with non-JSON output', async () => {
      mockLLM = createMockLLM([
        [
          {
            type: 'tool_use_start' as const,
            id: 't1',
            name: 'echo',
            input: { message: 'hi' },
          },
          {
            type: 'tool_use_end' as const,
            id: 't1',
            output: 'raw string output',
          },
          {
            type: 'done' as const,
            usage: { inputTokens: 10, outputTokens: 5 },
          },
        ],
        [
          { type: 'text' as const, text: 'Done' },
          {
            type: 'done' as const,
            usage: { inputTokens: 15, outputTokens: 3 },
          },
        ],
      ])
      cm = new ConversationManager(mockLLM, registry)

      const events: StreamEvent[] = []
      for await (const event of cm.send('Use tool')) {
        events.push(event)
      }

      // Should not crash; should complete the loop
      const errors = events.filter((e) => e.type === 'error')
      expect(errors).toHaveLength(0)
    })

    it('should propagate LLM error events', async () => {
      const errorMock: LLMConnector = {
        provider: 'anthropic',
        send: async function* () {
          yield {
            type: 'error' as const,
            error: new Error('API rate limit exceeded'),
          }
        },
        countTokens: vi.fn().mockResolvedValue(100),
      }
      cm = new ConversationManager(errorMock, registry)

      const events: StreamEvent[] = []
      for await (const event of cm.send('Hi')) {
        events.push(event)
      }

      expect(events).toHaveLength(1)
      expect(events[0]?.type).toBe('error')
      if (events[0]?.type === 'error') {
        expect(events[0].error.message).toBe('API rate limit exceeded')
      }
    })
  })
})

// ─── Mock LLM with compact simulation ────────────────────

describe('ConversationManager — message passing to LLM', () => {
  it('should pass system prompt to LLM', async () => {
    const sendSpy = vi.fn().mockImplementation(async function* (): AsyncIterable<StreamEvent> {
      yield { type: 'text', text: 'OK' }
      yield { type: 'done', usage: { inputTokens: 5, outputTokens: 2 } }
    })

    const mockLLM: LLMConnector = {
      provider: 'anthropic',
      send: sendSpy,
      countTokens: vi.fn().mockResolvedValue(100),
    }

    const cm = new ConversationManager(mockLLM, new ToolRegistry(), 'Custom system prompt')

    for await (const _event of cm.send('Test')) {
      // consume
    }

    expect(sendSpy).toHaveBeenCalledTimes(1)
    // Check that system prompt was passed as first arg
    const callArgs = sendSpy.mock.calls[0]
    expect(callArgs?.[0]).toBe('Custom system prompt')
  })

  it('should pass conversation messages to LLM', async () => {
    const sendSpy = vi.fn().mockImplementation(async function* (): AsyncIterable<StreamEvent> {
      yield { type: 'text', text: 'Reply' }
      yield { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } }
    })

    const mockLLM: LLMConnector = {
      provider: 'anthropic',
      send: sendSpy,
      countTokens: vi.fn().mockResolvedValue(100),
    }

    const cm = new ConversationManager(mockLLM, new ToolRegistry())

    for await (const _event of cm.send('First message')) {
      // consume
    }
    for await (const _event of cm.send('Second message')) {
      // consume
    }

    // Second call should include first message history
    expect(sendSpy).toHaveBeenCalledTimes(2)
    const secondCallMessages = sendSpy.mock.calls[1]?.[1]
    expect(secondCallMessages).toBeDefined()
    if (secondCallMessages) {
      const contents = secondCallMessages.map((m: { role: string; content: string }) => m.content)
      expect(contents).toContain('First message')
      expect(contents).toContain('Second message')
    }
  })
})
