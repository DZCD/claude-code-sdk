/**
 * Tests for Feedback Loop — 用户反馈注入机制
 *
 * Phase 3C — D2
 */
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ask } from '../ask/index.js'
import { FeedbackInjector } from '../feedback/index.js'
import type { FeedbackContext, FeedbackInput, FeedbackOptions } from '../feedback/index.js'
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

const failTool = createTool({
  name: 'fail',
  description: 'Always fails',
  inputSchema: z.object({ reason: z.string().optional() }),
  async execute() {
    return {
      data: null,
      content: 'Error: something went wrong',
      isError: true,
    }
  },
})

// ─── FeedbackInjector Tests ───────────────────────────────

describe('FeedbackInjector', () => {
  it('should create with default options', () => {
    const injector = new FeedbackInjector({ mode: 'manual' })
    expect(injector).toBeTruthy()
  })

  it('should return null from getAutoFeedback when no errors', () => {
    const injector = new FeedbackInjector({ mode: 'auto' })
    const result = injector.getAutoFeedback([{ id: 't1', name: 'echo', input: {}, result: 'ok', isError: false }])
    expect(result).toBeNull()
  })

  it('should return feedback from getAutoFeedback when errors exist', () => {
    const injector = new FeedbackInjector({ mode: 'auto' })
    const result = injector.getAutoFeedback([
      { id: 't1', name: 'echo', input: {}, result: 'ok', isError: false },
      {
        id: 't2',
        name: 'fail',
        input: {},
        result: 'Error: something went wrong',
        isError: true,
      },
    ])
    expect(result).not.toBeNull()
    expect(result!.text).toContain('The following tool calls failed')
    expect(result!.text).toContain('fail')
  })

  it('should return null from getAutoFeedback for empty toolCalls', () => {
    const injector = new FeedbackInjector({ mode: 'auto' })
    expect(injector.getAutoFeedback([])).toBeNull()
  })

  it('should apply text feedback to messages', () => {
    const injector = new FeedbackInjector({ mode: 'manual' })
    const messages = [createUserMessage('Hello')]

    const result = injector.applyFeedback(messages, {
      text: 'Correction: please retry',
    })

    expect(result.length).toBe(2)
    expect(result[1]!.role).toBe('user')
    expect(result[1]!.content).toBe('Correction: please retry')
  })

  it('should apply tool overrides to messages', () => {
    const injector = new FeedbackInjector({ mode: 'manual' })
    const messages = [
      createUserMessage('Hello'),
      {
        id: 'msg-1',
        role: 'user' as const,
        content: 'Echo: wrong',
        createdAt: new Date().toISOString(),
      },
    ]

    const result = injector.applyFeedback(messages, {
      toolOverrides: [{ toolUseId: 'nonexistent', correctedResult: 'fixed' }],
    })

    // Should add a correction message
    expect(result.length).toBe(3)
    const lastMsg = result[result.length - 1]!
    expect(lastMsg.content).toContain('overridden')

    // If override matches existing tool result, update it
    const messagesWithToolResult = [
      createUserMessage('Hello'),
      {
        id: 'msg-result-t1',
        role: 'user' as const,
        content: 'Echo: wrong',
        createdAt: new Date().toISOString(),
        // @ts-expect-error test metadata
        _toolUseId: 't1',
      },
    ]

    const result2 = injector.applyFeedback(messagesWithToolResult, {
      toolOverrides: [{ toolUseId: 't1', correctedResult: 'Echo: fixed' }],
    })

    // Should find and update the matching tool result message
    const updatedMsg = result2.find((m) => '_toolUseId' in m && m._toolUseId === 't1')
    expect(updatedMsg).toBeTruthy()
    if (updatedMsg) {
      expect((updatedMsg as any).content).toBe('Echo: fixed')
    }
  })

  it('should waitForFeedback and return input when callback returns data', async () => {
    const injector = new FeedbackInjector({
      mode: 'manual',
      onFeedback: async () => ({ text: 'User correction' }),
    })

    const context: FeedbackContext = {
      text: 'LLM output',
      toolCalls: [],
      messages: [createUserMessage('Hi')],
    }

    const result = await injector.waitForFeedback(context)
    expect(result).toEqual({ text: 'User correction' })
  })

  it('should waitForFeedback and return null when callback returns null', async () => {
    const injector = new FeedbackInjector({
      mode: 'manual',
      onFeedback: async () => null,
    })

    const context: FeedbackContext = {
      text: 'LLM output',
      toolCalls: [],
      messages: [createUserMessage('Hi')],
    }

    const result = await injector.waitForFeedback(context)
    expect(result).toBeNull()
  })

  it('should timeout waitForFeedback and return null', async () => {
    const injector = new FeedbackInjector({
      mode: 'manual',
      onFeedback: async () => {
        // Simulate a delay that would exceed timeout
        await new Promise((r) => setTimeout(r, 100))
        return { text: 'Too late' }
      },
      timeout: 10, // very short timeout
    })

    const context: FeedbackContext = {
      text: 'LLM output',
      toolCalls: [],
      messages: [createUserMessage('Hi')],
    }

    const result = await injector.waitForFeedback(context)
    // Should timeout and return null
    expect(result).toBeNull()
  })
})

// ─── ask() with feedback Integration Tests ────────────────

describe('ask() with feedback', () => {
  it('should work with feedback disabled (same as normal ask)', async () => {
    const llm = createMockLLM([
      [
        { type: 'text', text: 'Hello' },
        { type: 'done', usage: { inputTokens: 5, outputTokens: 3 } },
      ],
    ])
    const registry = new ToolRegistry()
    const messages = [createUserMessage('Hi')]

    const result = await ask(llm, {
      messages,
      tools: registry,
      options: {
        feedback: { mode: 'disabled' },
      },
    })

    expect(result.text).toBe('Hello')
    expect(result.toolCalls).toHaveLength(0)
  })

  it('should inject user feedback text when onFeedback returns correction', async () => {
    // Two turns: first with tool call, then feedback adds correction, then second LLM call
    const llm = createMockLLM([
      // Turn 1: LLM calls a tool
      [
        { type: 'text', text: 'Let me check' },
        {
          type: 'tool_use_start',
          id: 't1',
          name: 'echo',
          input: { message: 'data' },
        },
        { type: 'tool_use_end', id: 't1', output: '{"message":"data"}' },
        { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
      ],
      // Turn 2: After feedback injected, LLM responds again
      [
        { type: 'text', text: 'After correction: ' },
        { type: 'done', usage: { inputTokens: 15, outputTokens: 8 } },
      ],
    ])

    const registry = new ToolRegistry()
    registry.register(echoTool)
    const messages = [createUserMessage('Check data')]

    let feedbackCallCount = 0
    const onFeedback = vi.fn().mockImplementation(async () => {
      feedbackCallCount++
      if (feedbackCallCount === 1) {
        return { text: 'Actually, check the other field' }
      }
      return null // Stop after one feedback round
    })

    const result = await ask(llm, {
      messages,
      tools: registry,
      options: {
        feedback: { mode: 'manual', onFeedback },
      },
    })

    // onFeedback should have been called (once after tool call, once after text response)
    expect(onFeedback).toHaveBeenCalledTimes(2)

    // Should have tool call recorded
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0]!.name).toBe('echo')

    // Should include both LLM outputs
    expect(result.text).toContain('Let me check')
    expect(result.text).toContain('After correction')
  })

  it('should skip feedback when onFeedback returns null', async () => {
    const llm = createMockLLM([
      [
        { type: 'text', text: 'Initial response' },
        { type: 'done', usage: { inputTokens: 5, outputTokens: 3 } },
      ],
    ])
    const registry = new ToolRegistry()
    const messages = [createUserMessage('Hi')]
    const onFeedback = vi.fn().mockResolvedValue(null)

    const result = await ask(llm, {
      messages,
      tools: registry,
      options: {
        feedback: { mode: 'manual', onFeedback },
      },
    })

    expect(onFeedback).toHaveBeenCalledTimes(1)
    expect(result.text).toBe('Initial response')
  })

  it('should auto-correct when tool errors occur in auto mode', async () => {
    const llm = createMockLLM([
      // Turn 1: LLM calls a tool that will fail
      [
        { type: 'text', text: 'Trying...' },
        { type: 'tool_use_start', id: 't1', name: 'fail', input: {} },
        { type: 'tool_use_end', id: 't1', output: '{}' },
        { type: 'done', usage: { inputTokens: 8, outputTokens: 4 } },
      ],
      // Turn 2: After auto-correction, LLM retries
      [
        { type: 'text', text: 'Retrying with echo' },
        {
          type: 'tool_use_start',
          id: 't2',
          name: 'echo',
          input: { message: 'retry' },
        },
        { type: 'tool_use_end', id: 't2', output: '{"message":"retry"}' },
        { type: 'done', usage: { inputTokens: 12, outputTokens: 6 } },
      ],
      // Turn 3: Final response
      [
        { type: 'text', text: 'Done' },
        { type: 'done', usage: { inputTokens: 5, outputTokens: 3 } },
      ],
    ])

    const registry = new ToolRegistry()
    registry.register(echoTool)
    registry.register(failTool)
    const messages = [createUserMessage('Do something dangerous')]

    const result = await ask(llm, {
      messages,
      tools: registry,
      options: {
        feedback: { mode: 'auto' },
      },
    })

    // Should have at least 2 tool calls (the failed one + the retry)
    expect(result.toolCalls.length).toBeGreaterThanOrEqual(2)

    // First tool call should be the failed one
    expect(result.toolCalls[0]!.isError).toBe(true)

    // Text should include the auto-correction message
    expect(result.text).toContain('Trying...')
    expect(result.text).toContain('Done')
  })

  it('should allow multiple feedback rounds', async () => {
    // Two rounds of feedback
    let feedbackCount = 0
    const onFeedback = vi.fn().mockImplementation(async () => {
      feedbackCount++
      if (feedbackCount <= 2) {
        return { text: `Feedback round ${feedbackCount}` }
      }
      return null
    })

    // LLM sequence: 3 non-tool turns (original + 2 feedback responses)
    const llm = createMockLLM([
      [
        { type: 'text', text: 'First' },
        { type: 'done', usage: { inputTokens: 5, outputTokens: 3 } },
      ],
      [
        { type: 'text', text: 'Second' },
        { type: 'done', usage: { inputTokens: 5, outputTokens: 3 } },
      ],
      [
        { type: 'text', text: 'Third' },
        { type: 'done', usage: { inputTokens: 5, outputTokens: 3 } },
      ],
    ])

    const registry = new ToolRegistry()
    const messages = [createUserMessage('Start')]

    const result = await ask(llm, {
      messages,
      tools: registry,
      options: {
        feedback: { mode: 'manual', onFeedback },
      },
    })

    expect(onFeedback).toHaveBeenCalledTimes(3)
    expect(result.text).toBe('FirstSecondThird')
  })
})
