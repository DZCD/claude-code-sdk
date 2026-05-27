/**
 * Tests for ask / askStream — Tool Call 自动执行循环
 *
 * Phase 3B — B2
 */
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ask, askStream } from '../ask/index.js'
import type { AskResult } from '../ask/index.js'
import type { LLMConnector, StreamEvent, TokenUsage } from '../llm/types.js'
import { createTool } from '../tools/base.js'
import { ToolRegistry } from '../tools/registry.js'
import { createUserMessage } from '../types/message.js'

// ─── Mock LLM Factory ─────────────────────────────────────

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

// ─── Test Tools ───────────────────────────────────────────

const echoTool = createTool({
  name: 'echo',
  description: 'Echoes input back',
  inputSchema: z.object({ message: z.string() }),
  async execute(input) {
    return { data: input.message, content: `Echo: ${input.message}` }
  },
})

const addTool = createTool({
  name: 'add',
  description: 'Adds two numbers',
  inputSchema: z.object({ a: z.number(), b: z.number() }),
  async execute(input) {
    const sum = input.a + input.b
    return { data: sum, content: String(sum) }
  },
})

// ─── Tests ────────────────────────────────────────────────

describe('ask()', () => {
  it('should return text from a single non-tool response', async () => {
    const llm = createMockLLM([
      [
        { type: 'text', text: 'Hello from LLM' },
        { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
      ],
    ])
    const registry = new ToolRegistry()
    const messages = [createUserMessage('Hi')]

    const result = await ask(llm, {
      messages,
      tools: registry,
    })

    expect(result.text).toBe('Hello from LLM')
    expect(result.toolCalls).toHaveLength(0)
    expect(result.usage.inputTokens).toBe(10)
    expect(result.usage.outputTokens).toBe(5)
    expect(result.messages).toEqual(messages)
  })

  it('should auto-execute a single tool call and return result', async () => {
    const llm = createMockLLM([
      [
        { type: 'text', text: 'Let me check' },
        {
          type: 'tool_use_start',
          id: 't1',
          name: 'echo',
          input: { message: 'test' },
        },
        { type: 'tool_use_end', id: 't1', output: '{"message":"test"}' },
        { type: 'done', usage: { inputTokens: 15, outputTokens: 10 } },
      ],
      [
        { type: 'text', text: 'Done: Echo: test' },
        { type: 'done', usage: { inputTokens: 20, outputTokens: 8 } },
      ],
    ])
    const registry = new ToolRegistry()
    registry.register(echoTool)
    const messages = [createUserMessage('Say echo')]

    const result = await ask(llm, { messages, tools: registry })

    expect(result.text).toBe('Let me checkDone: Echo: test')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0]!.name).toBe('echo')
    expect(result.toolCalls[0]!.result).toBe('Echo: test')
    expect(result.usage.inputTokens).toBe(35) // 15 + 20
    expect(result.usage.outputTokens).toBe(18) // 10 + 8
  })

  it('should handle multi-turn tool chaining', async () => {
    const llm = createMockLLM([
      [
        { type: 'text', text: 'Adding...' },
        {
          type: 'tool_use_start',
          id: 't1',
          name: 'add',
          input: { a: 1, b: 2 },
        },
        { type: 'tool_use_end', id: 't1', output: '{"a":1,"b":2}' },
        { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
      ],
      [
        { type: 'text', text: 'Result: 3' },
        {
          type: 'tool_use_start',
          id: 't2',
          name: 'add',
          input: { a: 3, b: 4 },
        },
        { type: 'tool_use_end', id: 't2', output: '{"a":3,"b":4}' },
        { type: 'done', usage: { inputTokens: 15, outputTokens: 8 } },
      ],
      [
        { type: 'text', text: 'Final: 7' },
        { type: 'done', usage: { inputTokens: 20, outputTokens: 10 } },
      ],
    ])
    const registry = new ToolRegistry()
    registry.register(addTool)
    const messages = [createUserMessage('Add 1+2 then 3+4')]

    const result = await ask(llm, { messages, tools: registry })

    expect(result.toolCalls).toHaveLength(2)
    expect(result.toolCalls[0]!.name).toBe('add')
    expect(result.toolCalls[1]!.name).toBe('add')
    expect(result.text).toBe('Adding...Result: 3Final: 7')
    expect(result.usage.inputTokens).toBe(45)
  })

  it('should respect maxToolCallDepth limit', async () => {
    // Create an LLM that always calls a tool
    const makeToolTurn = (id: string): StreamEvent[] => [
      { type: 'tool_use_start', id, name: 'echo', input: { message: 'x' } },
      { type: 'tool_use_end', id, output: '{"message":"x"}' },
      { type: 'done', usage: { inputTokens: 5, outputTokens: 3 } },
    ]
    const sequence: StreamEvent[][] = []
    for (let i = 0; i < 5; i++) sequence.push(makeToolTurn(`t${i}`))
    // After depth exhausted, one more turn from loop
    sequence.push([
      { type: 'text', text: 'Over limit' },
      { type: 'done', usage: { inputTokens: 1, outputTokens: 1 } },
    ])

    const llm = createMockLLM(sequence)
    const registry = new ToolRegistry()
    registry.register(echoTool)
    const messages = [createUserMessage('Loop')]

    const result = await ask(llm, {
      messages,
      tools: registry,
      options: { maxToolCallDepth: 2 },
    })

    // Should have 2 tool calls (depth limit)
    expect(result.toolCalls).toHaveLength(2)
  })

  it('should call onToolCall hook for each tool invocation', async () => {
    const llm = createMockLLM([
      [
        {
          type: 'tool_use_start',
          id: 't1',
          name: 'echo',
          input: { message: 'test' },
        },
        { type: 'tool_use_end', id: 't1', output: '{"message":"test"}' },
        { type: 'done', usage: { inputTokens: 5, outputTokens: 3 } },
      ],
      [
        { type: 'text', text: 'Done' },
        { type: 'done', usage: { inputTokens: 5, outputTokens: 3 } },
      ],
    ])
    const registry = new ToolRegistry()
    registry.register(echoTool)
    const messages = [createUserMessage('Hi')]

    const onToolCall = vi.fn().mockResolvedValue(true)

    await ask(llm, {
      messages,
      tools: registry,
      options: { onToolCall },
    })

    expect(onToolCall).toHaveBeenCalledTimes(1)
    expect(onToolCall).toHaveBeenCalledWith('echo', { message: 'test' })
  })

  it('should skip tool execution when onToolCall returns false', async () => {
    const llm = createMockLLM([
      [
        {
          type: 'tool_use_start',
          id: 't1',
          name: 'echo',
          input: { message: 'test' },
        },
        { type: 'tool_use_end', id: 't1', output: '{"message":"test"}' },
        { type: 'done', usage: { inputTokens: 5, outputTokens: 3 } },
      ],
    ])
    const registry = new ToolRegistry()
    registry.register(echoTool)
    const messages = [createUserMessage('Hi')]
    const executeSpy = vi.spyOn(registry, 'execute')

    await ask(llm, {
      messages,
      tools: registry,
      options: { onToolCall: () => false },
    })

    // Tool should NOT have been executed
    expect(executeSpy).not.toHaveBeenCalled()
  })

  it('should not execute tools when autoExecuteTools=false', async () => {
    const llm = createMockLLM([
      [
        {
          type: 'tool_use_start',
          id: 't1',
          name: 'echo',
          input: { message: 'test' },
        },
        { type: 'tool_use_end', id: 't1', output: '{"message":"test"}' },
        { type: 'done', usage: { inputTokens: 5, outputTokens: 3 } },
      ],
      [
        { type: 'text', text: 'Skipped' },
        { type: 'done', usage: { inputTokens: 5, outputTokens: 3 } },
      ],
    ])
    const registry = new ToolRegistry()
    registry.register(echoTool)
    const messages = [createUserMessage('Hi')]
    const executeSpy = vi.spyOn(registry, 'execute')

    const result = await ask(llm, {
      messages,
      tools: registry,
      options: { autoExecuteTools: false },
    })

    expect(executeSpy).not.toHaveBeenCalled()
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0]!.result).toBe('') // No result when not executed
  })

  it('should handle abort signal', async () => {
    const ac = new AbortController()
    const llm: LLMConnector = {
      provider: 'anthropic',
      send: async function* () {
        ac.abort()
        yield { type: 'error', error: new Error('Aborted') }
      },
      countTokens: vi.fn().mockResolvedValue(100),
    }
    const registry = new ToolRegistry()
    const messages = [createUserMessage('Hi')]

    await expect(ask(llm, { messages, tools: registry, options: { signal: ac.signal } })).rejects.toThrow('Aborted')
  })

  it('should return messages with tool results injected', async () => {
    const llm = createMockLLM([
      [
        { type: 'text', text: 'Calling tool' },
        {
          type: 'tool_use_start',
          id: 't1',
          name: 'echo',
          input: { message: 'x' },
        },
        { type: 'tool_use_end', id: 't1', output: '{"message":"x"}' },
        { type: 'done', usage: { inputTokens: 5, outputTokens: 3 } },
      ],
      [
        { type: 'text', text: 'Done' },
        { type: 'done', usage: { inputTokens: 5, outputTokens: 3 } },
      ],
    ])
    const registry = new ToolRegistry()
    registry.register(echoTool)
    const messages = [createUserMessage('Hi')]

    const result = await ask(llm, { messages, tools: registry })

    // Original messages + tool result message injected
    expect(result.messages.length).toBeGreaterThanOrEqual(2)
    // Last message should contain the tool result
    const lastMsg = result.messages[result.messages.length - 1]
    expect(lastMsg!.content).toBe('Echo: x')
  })
})

describe('askStream()', () => {
  it('should yield intermediate events and final result', async () => {
    const llm = createMockLLM([
      [
        { type: 'text', text: 'Hello' },
        { type: 'done', usage: { inputTokens: 5, outputTokens: 3 } },
      ],
    ])
    const registry = new ToolRegistry()
    const messages = [createUserMessage('Hi')]

    const events: Array<StreamEvent | { type: 'result'; result: AskResult }> = []
    for await (const event of askStream(llm, { messages, tools: registry })) {
      events.push(event)
    }

    // Should include both the text event and the final result
    const textEvents = events.filter((e): e is StreamEvent & { type: 'text' } => e.type === 'text')
    const resultEvents = events.filter((e): e is { type: 'result'; result: AskResult } => e.type === 'result')

    expect(textEvents.length).toBeGreaterThanOrEqual(1)
    expect(textEvents[0]!.text).toBe('Hello')
    expect(resultEvents).toHaveLength(1)
    expect(resultEvents[0]!.result.text).toBe('Hello')
  })

  it('should yield tool events when tools are called', async () => {
    const llm = createMockLLM([
      [
        { type: 'text', text: 'Running' },
        {
          type: 'tool_use_start',
          id: 't1',
          name: 'echo',
          input: { message: 'x' },
        },
        { type: 'tool_use_end', id: 't1', output: '{"message":"x"}' },
        { type: 'done', usage: { inputTokens: 5, outputTokens: 3 } },
      ],
      [
        { type: 'text', text: 'Done' },
        { type: 'done', usage: { inputTokens: 5, outputTokens: 3 } },
      ],
    ])
    const registry = new ToolRegistry()
    registry.register(echoTool)
    const messages = [createUserMessage('Hi')]

    const events: Array<StreamEvent | { type: 'result'; result: AskResult }> = []
    for await (const event of askStream(llm, { messages, tools: registry })) {
      events.push(event)
    }

    const types = events.map((e) => e.type)
    expect(types).toContain('tool_use_start')
    expect(types).toContain('tool_use_end')
    expect(types).toContain('result')

    const resultEvent = events.find((e): e is { type: 'result'; result: AskResult } => e.type === 'result')
    expect(resultEvent?.result.toolCalls).toHaveLength(1)
  })
})
