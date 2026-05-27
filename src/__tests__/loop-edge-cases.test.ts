/**
 * Supplementary Tests — Conversation Loop & Edge Cases
 *
 * Tests for conversationLoop directly and edge cases
 * that improve coverage on uncovered branches.
 */
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { conversationLoop } from '../conversation/loop.js'
import type { LLMConnector, StreamEvent } from '../llm/types.js'
import { createTool } from '../tools/base.js'
import { ToolRegistry } from '../tools/registry.js'
import { createUserMessage } from '../types/message.js'

// ─── Mock LLM ────────────────────────────────────────────

function createMockLLM(sequence: StreamEvent[][]): LLMConnector {
  let idx = 0
  return {
    provider: 'anthropic' as const,
    send: async function* () {
      const events = sequence[idx] ?? []
      if (idx < sequence.length - 1) idx++
      for (const e of events) yield e
    },
    countTokens: vi.fn().mockResolvedValue(100),
  }
}

const echoTool = createTool({
  name: 'echo',
  description: 'echo',
  inputSchema: z.object({ message: z.string() }),
  async execute(input) {
    return { data: input.message, content: `Echo: ${input.message}` }
  },
})

describe('conversationLoop edge cases', () => {
  it('should handle aborted signal with tool calls', async () => {
    const ac = new AbortController()
    // First call yields a tool_use — triggers a second iteration where abort is checked
    const mockLLM: LLMConnector = {
      provider: 'anthropic',
      send: async function* () {
        if (!ac.signal.aborted) {
          yield {
            type: 'tool_use_start',
            id: 't1',
            name: 'echo',
            input: { message: 'x' },
          }
          yield { type: 'tool_use_end', id: 't1', output: '{"message":"x"}' }
          yield { type: 'done', usage: { inputTokens: 1, outputTokens: 1 } }
        }
      },
      countTokens: vi.fn().mockResolvedValue(100),
    }

    const registry = new ToolRegistry()
    registry.register(echoTool)

    const messages = [createUserMessage('Hi')]
    ac.abort() // Pre-abort the signal

    const events: StreamEvent[] = []
    for await (const event of conversationLoop(mockLLM, 'test', messages, registry, {
      signal: ac.signal,
      maxToolCallDepth: 5,
    })) {
      events.push(event)
    }

    // Should immediately yield error for aborted signal
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('error')
  })

  it('should handle thinking events', async () => {
    const mockLLM = createMockLLM([
      [
        { type: 'thinking', thinking: 'Hmm, let me think...' },
        { type: 'text', text: 'Answer' },
        { type: 'done', usage: { inputTokens: 5, outputTokens: 3 } },
      ],
    ])

    const registry = new ToolRegistry()
    const messages = [createUserMessage('Think')]
    const events: StreamEvent[] = []
    for await (const event of conversationLoop(mockLLM, 'test', messages, registry)) {
      events.push(event)
    }

    const thinking = events.filter((e) => e.type === 'thinking')
    expect(thinking).toHaveLength(1)
    if (thinking[0]?.type === 'thinking') {
      expect(thinking[0].thinking).toContain('Hmm')
    }
  })

  it('should pass ping events through', async () => {
    const mockLLM = createMockLLM([
      [
        { type: 'ping' as const },
        { type: 'text', text: 'Still here' },
        { type: 'done', usage: { inputTokens: 2, outputTokens: 2 } },
      ],
    ])

    const registry = new ToolRegistry()
    const messages = [createUserMessage('Ping test')]
    const events: StreamEvent[] = []
    for await (const event of conversationLoop(mockLLM, 'test', messages, registry)) {
      events.push(event)
    }

    const pings = events.filter((e) => e.type === 'ping')
    expect(pings).toHaveLength(1)
  })

  it('should abort on signal during tool execution', async () => {
    const ac = new AbortController()
    // This LLM returns a tool_use, loop will try to execute it
    // then on next iteration, signal.aborted is checked
    const mockLLM: LLMConnector = {
      provider: 'anthropic',
      send: async function* () {
        yield {
          type: 'tool_use_start',
          id: 't1',
          name: 'echo',
          input: { message: 'hi' },
        }
        yield { type: 'tool_use_end', id: 't1', output: '{"message":"hi"}' }
        yield { type: 'done', usage: { inputTokens: 5, outputTokens: 3 } }
      },
      countTokens: vi.fn().mockResolvedValue(100),
    }

    const registry = new ToolRegistry()
    registry.register(echoTool)
    const messages = [createUserMessage('Do tool')]

    // In the while loop, before streaming, it checks signal.aborted
    // So we need to abort BEFORE the loop runs, which happens on the second iteration
    // after tool results are added

    const events: StreamEvent[] = []
    for await (const event of conversationLoop(mockLLM, 'test', messages, registry, {
      signal: ac.signal,
      maxToolCallDepth: 3,
    })) {
      // Abort after the first tool_use_start event
      // This means tool execution will see the aborted signal
      if (event.type === 'tool_use_start') {
        ac.abort()
      }
      events.push(event)
    }

    // Should still complete but include tool_use_start and tool_use_end
    // The abort happens during tool execution phase of first iteration
    const toolStarts = events.filter((e) => e.type === 'tool_use_start')
    expect(toolStarts).toHaveLength(1)
    const errors = events.filter((e) => e.type === 'error')
    // Should have abort error because tool execution is aborted
    expect(errors.length).toBeGreaterThanOrEqual(1)
  })
})
