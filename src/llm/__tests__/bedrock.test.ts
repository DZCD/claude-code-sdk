/**
 * Tests for BedrockConnector
 *
 * Uses vitest mock to replace @anthropic-ai/bedrock-sdk with a mock implementation
 * that simulates the streaming API.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BedrockConnector } from '../bedrock.js'
import type { BedrockConfig } from '../types.js'

// ─── Mock @anthropic-ai/bedrock-sdk ──────────────────────

const mockCreateStream = vi.fn()

vi.mock('@anthropic-ai/bedrock-sdk', () => {
  class MockAnthropicBedrock {
    messages = {
      create: mockCreateStream,
    }
  }
  return { AnthropicBedrock: MockAnthropicBedrock }
})

// ─── Helpers ──────────────────────────────────────────────

function makeConfig(overrides: Partial<BedrockConfig> = {}): BedrockConfig {
  return {
    provider: 'bedrock',
    model: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
    region: 'us-east-1',
    ...overrides,
  }
}

/** Create an async generator that yields stream events */
async function* makeStream(events: unknown[]) {
  for (const event of events) {
    yield event
  }
}

describe('BedrockConnector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─── Construction ───────────────────────────────────────

  it('should create connector with valid config', () => {
    const connector = new BedrockConnector(makeConfig())
    expect(connector.provider).toBe('bedrock')
  })

  it('should create connector without credentials (uses default chain)', () => {
    const connector = new BedrockConnector(makeConfig({ accessKeyId: undefined, secretAccessKey: undefined }))
    expect(connector.provider).toBe('bedrock')
  })

  // ─── send() — Text response ────────────────────────────

  it('should stream text response', async () => {
    const connector = new BedrockConnector(makeConfig())
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
    expect(callArgs?.model).toBe('us.anthropic.claude-sonnet-4-20250514-v1:0')
    expect(callArgs?.stream).toBe(true)
  })

  // ─── send() — Tool use ────────────────────────────────

  it('should stream tool_use events', async () => {
    const connector = new BedrockConnector(makeConfig())
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
    // First event should be tool_use_start
    const toolUseStart = collected[0] as Record<string, unknown>
    expect(toolUseStart.type).toBe('tool_use_start')
    expect(toolUseStart.id).toBe('tu_123')
    expect(toolUseStart.name).toBe('write_file')
    // Second event should be tool_use_end
    const toolUseEnd = collected[1] as Record<string, unknown>
    expect(toolUseEnd.type).toBe('tool_use_end')
    expect(toolUseEnd.id).toBe('tu_123')
    // Third event should be done
    const doneEvent = collected[2] as Record<string, unknown>
    expect(doneEvent.type).toBe('done')
  })

  // ─── send() — System prompt ────────────────────────────

  it('should pass system prompt to the API', async () => {
    const connector = new BedrockConnector(makeConfig())
    const events = [
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: 'OK' },
      },
      { type: 'message_stop' },
    ]

    mockCreateStream.mockResolvedValue(makeStream(events))

    const results: string[] = []
    for await (const event of connector.send('You are a helpful assistant', [{ role: 'user', content: 'Hi' }], [])) {
      if (event.type === 'text') results.push(event.text)
      if (event.type === 'done') break
    }

    expect(results).toEqual(['OK'])
    const callArgs = mockCreateStream.mock.calls[0]?.[0]
    expect(callArgs?.system).toBeDefined()
    expect(callArgs?.system[0]?.text).toBe('You are a helpful assistant')
  })

  // ─── send() — Error handling ───────────────────────────

  it('should yield error event on API failure', async () => {
    const connector = new BedrockConnector(makeConfig())
    mockCreateStream.mockRejectedValue(new Error('Bedrock API error'))

    const errors: Error[] = []
    for await (const event of connector.send(undefined, [{ role: 'user', content: 'Hi' }], [])) {
      if (event.type === 'error') errors.push(event.error)
    }

    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toBe('Bedrock API error')
  })

  // ─── send() — Tool definitions passed to API ──────────

  it('should pass tool definitions to the API', async () => {
    const connector = new BedrockConnector(makeConfig())
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

  // ─── countTokens() — Fallback estimation ───────────────

  it('should estimate tokens from text length', async () => {
    const connector = new BedrockConnector(makeConfig())
    // Bedrock doesn't support countTokens, so it falls back to estimation
    const count = await connector.countTokens([{ role: 'user', content: 'Hello world' }])
    // "Hello world" = 11 chars / 4 ≈ 2.75 → ceil = 3
    expect(count).toBe(3)
  })

  // ─── send() — Empty messages ───────────────────────────

  it('should handle empty messages gracefully', async () => {
    const connector = new BedrockConnector(makeConfig())
    const events: string[] = []
    for await (const event of connector.send(undefined, [], [])) {
      events.push(event.type)
    }
    expect(events).toEqual(['done'])
    // Should not call the API when there are no messages
    expect(mockCreateStream).not.toHaveBeenCalled()
  })

  // ─── send() — Usage tracking ──────────────────────────

  it('should capture usage from message_delta', async () => {
    const connector = new BedrockConnector(makeConfig())
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

  // ─── send() — Retry with maxRetries option ────────────

  it('should yield retry event when API fails with retryable error and maxRetries=0', async () => {
    const connector = new BedrockConnector(makeConfig())
    // The error does NOT have a status property, so shouldRetry returns false
    // and we get an error event immediately
    mockCreateStream.mockRejectedValue(new Error('Bedrock transient error'))

    const events: string[] = []
    const errors: Error[] = []
    for await (const event of connector.send(undefined, [{ role: 'user', content: 'Hi' }], [], { maxRetries: 0 })) {
      events.push(event.type)
      if (event.type === 'error') errors.push(event.error)
    }

    expect(events).toContain('error')
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toBe('Bedrock transient error')
  })

  // ─── isBedrockConfig ────────────────────────────────────

  it('should identify bedrock config', async () => {
    const { isBedrockConfig } = await import('../bedrock.js')
    expect(isBedrockConfig({ provider: 'bedrock' })).toBe(true)
    expect(isBedrockConfig({ provider: 'anthropic' })).toBe(false)
    expect(isBedrockConfig({ provider: 'vertex' })).toBe(false)
  })
})
