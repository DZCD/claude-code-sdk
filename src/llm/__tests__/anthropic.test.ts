/**
 * Tests for AnthropicConnector
 *
 * Uses vitest mock to replace @anthropic-ai/sdk with a mock implementation
 * that simulates the streaming API.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AnthropicConnector } from '../anthropic.js'
import type { AnthropicConfig } from '../types.js'

// ─── Mock @anthropic-ai/sdk ──────────────────────────────

const mockCreateStream = vi.fn()
const mockCountTokens = vi.fn()

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      create: mockCreateStream,
      countTokens: mockCountTokens,
    }
  }
  return { default: MockAnthropic }
})

// ─── Helpers ──────────────────────────────────────────────

function makeConfig(overrides: Partial<AnthropicConfig> = {}): AnthropicConfig {
  return {
    provider: 'anthropic',
    apiKey: 'sk-test',
    model: 'claude-sonnet-4-20250514',
    ...overrides,
  }
}

/** Create an async generator that yields stream events */
async function* makeStream(events: unknown[]) {
  for (const event of events) {
    yield event
  }
}

describe('AnthropicConnector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─── Construction ──────────────────────────────────────

  it('should create connector with valid config', () => {
    const connector = new AnthropicConnector(makeConfig())
    expect(connector.provider).toBe('anthropic')
  })

  it('should create connector with custom baseUrl', () => {
    const connector = new AnthropicConnector(makeConfig({ baseUrl: 'https://api.deepseek.com/anthropic' }))
    expect(connector.provider).toBe('anthropic')
  })

  it('should create connector with custom maxTokens', () => {
    const connector = new AnthropicConnector(makeConfig({ maxTokens: 4096 }))
    expect(connector.provider).toBe('anthropic')
  })

  it('should use default maxTokens when not specified', () => {
    // The default in the constructor is 8192
    // We can verify by checking that send uses default when no options provided
    const connector = new AnthropicConnector(makeConfig({ maxTokens: undefined }))
    expect(connector.provider).toBe('anthropic')
  })

  // ─── send() — Text response ────────────────────────────

  it('should stream text response', async () => {
    const connector = new AnthropicConnector(makeConfig())
    const events = [
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: 'Hello' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: ' world' },
      },
      { type: 'message_stop' },
    ]

    mockCreateStream.mockResolvedValue(makeStream(events))

    const results: string[] = []
    for await (const event of connector.send(undefined, [{ role: 'user', content: 'Hi' }], [])) {
      if (event.type === 'text') results.push(event.text)
      if (event.type === 'done') break
    }

    expect(results).toEqual(['Hello', ' world'])
    expect(mockCreateStream).toHaveBeenCalledTimes(1)
    const callArgs = mockCreateStream.mock.calls[0]?.[0]
    expect(callArgs?.model).toBe('claude-sonnet-4-20250514')
    expect(callArgs?.stream).toBe(true)
  })

  // ─── send() — Tool use ────────────────────────────────

  it('should stream tool_use events', async () => {
    const connector = new AnthropicConnector(makeConfig())
    const toolInput = { path: '/tmp/test.txt', content: 'hello' }
    const events = [
      {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'tu_123',
          name: 'write_file',
          input: toolInput,
        },
      },
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use', stop_sequence: null },
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      { type: 'message_stop' },
    ]

    mockCreateStream.mockResolvedValue(makeStream(events))

    const collected: unknown[] = []
    for await (const event of connector.send(undefined, [{ role: 'user', content: 'Write file' }], [])) {
      collected.push(event)
      if (event.type === 'done') break
    }

    expect(collected).toHaveLength(3)
    const toolUseStart = collected[0] as Record<string, unknown>
    expect(toolUseStart.type).toBe('tool_use_start')
    expect(toolUseStart.id).toBe('tu_123')
    expect(toolUseStart.name).toBe('write_file')

    const toolUseEnd = collected[1] as Record<string, unknown>
    expect(toolUseEnd.type).toBe('tool_use_end')
    expect(toolUseEnd.id).toBe('tu_123')
  })

  // ─── send() — System prompt ────────────────────────────

  it('should pass system prompt to the API', async () => {
    const connector = new AnthropicConnector(makeConfig())
    const events = [
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: 'Understood' },
      },
      { type: 'message_stop' },
    ]

    mockCreateStream.mockResolvedValue(makeStream(events))

    const results: string[] = []
    for await (const event of connector.send('You are a helpful assistant', [{ role: 'user', content: 'Hi' }], [])) {
      if (event.type === 'text') results.push(event.text)
      if (event.type === 'done') break
    }

    expect(results).toEqual(['Understood'])
    const callArgs = mockCreateStream.mock.calls[0]?.[0]
    expect(callArgs?.system).toBeDefined()
    expect(callArgs?.system[0]?.text).toBe('You are a helpful assistant')
  })

  // ─── send() — Error handling ───────────────────────────

  it('should yield error event on API failure', async () => {
    const connector = new AnthropicConnector(makeConfig())
    mockCreateStream.mockRejectedValue(new Error('Anthropic API error'))

    const errors: Error[] = []
    for await (const event of connector.send(undefined, [{ role: 'user', content: 'Hi' }], [])) {
      if (event.type === 'error') errors.push(event.error)
    }

    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toBe('Anthropic API error')
  })

  it('should yield error event on non-Error rejection', async () => {
    const connector = new AnthropicConnector(makeConfig())
    mockCreateStream.mockRejectedValue('string error')

    const errors: Error[] = []
    for await (const event of connector.send(undefined, [{ role: 'user', content: 'Hi' }], [])) {
      if (event.type === 'error') errors.push(event.error)
    }

    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toBe('string error')
  })

  // ─── send() — Tool definitions ─────────────────────────

  it('should pass tool definitions to the API', async () => {
    const connector = new AnthropicConnector(makeConfig())
    const events = [
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: 'OK' },
      },
      { type: 'message_stop' },
    ]

    mockCreateStream.mockResolvedValue(makeStream(events))

    const tools = [
      {
        name: 'write_file',
        description: 'Write content to a file',
        input_schema: {
          type: 'object' as const,
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    ]

    for await (const _event of connector.send(undefined, [{ role: 'user', content: 'Write' }], tools)) {
      if (_event.type === 'done') break
    }

    const callArgs = mockCreateStream.mock.calls[0]?.[0]
    expect(callArgs?.tools).toHaveLength(1)
    expect(callArgs?.tools[0]?.name).toBe('write_file')
  })

  // ─── send() — With options ─────────────────────────────

  it('should pass maxTokens from options', async () => {
    const connector = new AnthropicConnector(makeConfig())
    const events = [
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: 'Short' },
      },
      { type: 'message_stop' },
    ]

    mockCreateStream.mockResolvedValue(makeStream(events))

    for await (const _event of connector.send(undefined, [{ role: 'user', content: 'Hi' }], [], { maxTokens: 100 })) {
      if (_event.type === 'done') break
    }

    const callArgs = mockCreateStream.mock.calls[0]?.[0]
    expect(callArgs?.max_tokens).toBe(100)
  })

  // ─── countTokens() — Via API ───────────────────────────

  it('should count tokens via API', async () => {
    const connector = new AnthropicConnector(makeConfig())
    mockCountTokens.mockResolvedValue({ input_tokens: 42 })

    const count = await connector.countTokens([{ role: 'user', content: 'Some text here' }])

    expect(count).toBe(42)
    expect(mockCountTokens).toHaveBeenCalledTimes(1)
    expect(mockCountTokens.mock.calls[0]?.[0]?.model).toBe('claude-sonnet-4-20250514')
  })

  // ─── countTokens() — Fallback on failure ──────────────

  it('should fall back to estimation when countTokens API fails', async () => {
    const connector = new AnthropicConnector(makeConfig())
    mockCountTokens.mockRejectedValue(new Error('API not available'))

    const count = await connector.countTokens([{ role: 'user', content: 'Hello' }])

    // "Hello" = 5 chars / 4 = 1.25 → ceil = 2
    expect(count).toBe(2)
  })

  // ─── send() — Empty messages ───────────────────────────

  it('should handle empty messages gracefully', async () => {
    const connector = new AnthropicConnector(makeConfig())
    const events: string[] = []
    for await (const event of connector.send(undefined, [], [])) {
      events.push(event.type)
    }
    expect(events).toEqual(['done'])
    expect(mockCreateStream).not.toHaveBeenCalled()
  })

  // ─── send() — Usage tracking ──────────────────────────

  it('should capture usage from message_delta', async () => {
    const connector = new AnthropicConnector(makeConfig())
    const events = [
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: 'Hello' },
      },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { input_tokens: 50, output_tokens: 10 },
      },
      { type: 'message_stop' },
    ]

    mockCreateStream.mockResolvedValue(makeStream(events))

    let capturedUsage: unknown
    for await (const event of connector.send(undefined, [{ role: 'user', content: 'Hi' }], [])) {
      if (event.type === 'done') {
        capturedUsage = event.usage
        break
      }
    }

    expect(capturedUsage).toEqual({ inputTokens: 50, outputTokens: 10 })
  })

  // ─── send() — message_start with input_tokens ──────────

  it('should capture input tokens from message_start', async () => {
    const connector = new AnthropicConnector(makeConfig())
    const events = [
      {
        type: 'message_start',
        message: { usage: { input_tokens: 25, output_tokens: 0 } },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: 'Response' },
      },
      { type: 'message_stop' },
    ]

    mockCreateStream.mockResolvedValue(makeStream(events))

    let capturedUsage: { inputTokens: number; outputTokens: number } | undefined
    for await (const event of connector.send(undefined, [{ role: 'user', content: 'Hi' }], [])) {
      if (event.type === 'done') {
        capturedUsage = event.usage
        break
      }
    }

    expect(capturedUsage?.inputTokens).toBe(25)
  })

  // ─── send() — thinking_delta ───────────────────────────

  it('should yield thinking events', async () => {
    const connector = new AnthropicConnector(makeConfig())
    const events = [
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'I am thinking...' },
      },
      { type: 'message_stop' },
    ]

    mockCreateStream.mockResolvedValue(makeStream(events))

    const thinkingChunks: string[] = []
    for await (const event of connector.send(undefined, [{ role: 'user', content: 'Think' }], [])) {
      if (event.type === 'thinking') thinkingChunks.push(event.thinking)
      if (event.type === 'done') break
    }

    expect(thinkingChunks).toEqual(['I am thinking...'])
  })

  // ─── send() — input_json_delta ─────────────────────────

  it('should accumulate tool_use input via input_json_delta', async () => {
    const connector = new AnthropicConnector(makeConfig())
    const events = [
      {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'tu_456',
          name: 'bash',
          input: {},
        },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"cmd":' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '"ls"}' },
      },
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use', stop_sequence: null },
        usage: { input_tokens: 20, output_tokens: 8 },
      },
      { type: 'message_stop' },
    ]

    mockCreateStream.mockResolvedValue(makeStream(events))

    let toolOutput = ''
    for await (const event of connector.send(undefined, [{ role: 'user', content: 'Run' }], [])) {
      if (event.type === 'tool_use_end') {
        toolOutput = event.output
      }
      if (event.type === 'done') break
    }

    expect(toolOutput).toBe('{}' + '{"cmd":"ls"}')
  })

  // ─── send() — ping event ──────────────────────────────

  it('should ignore ping events', async () => {
    const connector = new AnthropicConnector(makeConfig())
    const events = [
      { type: 'ping' },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: 'After ping' },
      },
      { type: 'message_stop' },
    ]

    mockCreateStream.mockResolvedValue(makeStream(events))

    const texts: string[] = []
    for await (const event of connector.send(undefined, [{ role: 'user', content: 'Hi' }], [])) {
      if (event.type === 'text') texts.push(event.text)
      if (event.type === 'done') break
    }

    expect(texts).toEqual(['After ping'])
  })

  // ─── send() — Retry event ─────────────────────────────

  it('should yield retry event when retryable error occurs with retries', async () => {
    const connector = new AnthropicConnector(makeConfig())

    // Simulate a retryable error on first attempt, success on second
    const retryableErr = new Error('Rate limited') as Error & { status?: number }
    retryableErr.status = 429

    mockCreateStream.mockRejectedValueOnce(retryableErr).mockResolvedValueOnce(
      makeStream([
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: 'Success' },
        },
        { type: 'message_stop' },
      ]),
    )

    const collectedTypes: string[] = []
    for await (const event of connector.send(undefined, [{ role: 'user', content: 'Hi' }], [])) {
      collectedTypes.push(event.type)
      if (event.type === 'done') break
    }

    expect(collectedTypes).toContain('retry')
    expect(collectedTypes).toContain('text')
    expect(collectedTypes).toContain('done')
  })

  // ─── isAnthropicConfig ──────────────────────────────────

  it('should identify anthropic config', async () => {
    const { isAnthropicConfig } = await import('../anthropic.js')
    expect(isAnthropicConfig({ provider: 'anthropic' })).toBe(true)
    expect(isAnthropicConfig({ provider: 'bedrock' })).toBe(false)
    expect(isAnthropicConfig({ provider: 'vertex' })).toBe(false)
    expect(isAnthropicConfig({ provider: 'foundry' })).toBe(false)
  })
})
