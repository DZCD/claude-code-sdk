/**
 * Tests for VertexConnector
 *
 * Uses vitest mock to replace @anthropic-ai/vertex-sdk with a mock implementation
 * that simulates the streaming API.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { VertexConnector } from '../vertex.js'
import type { VertexConfig } from '../types.js'

// ─── Mock @anthropic-ai/vertex-sdk ──────────────────────

const mockCreateStream = vi.fn()
const mockCountTokens = vi.fn()

vi.mock('@anthropic-ai/vertex-sdk', () => {
  class MockAnthropicVertex {
    messages = {
      create: mockCreateStream,
      countTokens: mockCountTokens,
    }
  }
  return { AnthropicVertex: MockAnthropicVertex }
})

// ─── Helpers ──────────────────────────────────────────────

function makeConfig(overrides: Partial<VertexConfig> = {}): VertexConfig {
  return {
    provider: 'vertex',
    model: 'claude-sonnet-4@20250514',
    projectId: 'my-gcp-project',
    region: 'us-east5',
    ...overrides,
  }
}

/** Create an async generator that yields stream events */
async function* makeStream(events: unknown[]) {
  for (const event of events) {
    yield event
  }
}

describe('VertexConnector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─── Construction ──────────────────────────────────────

  it('should create connector with valid config', () => {
    const connector = new VertexConnector(makeConfig())
    expect(connector.provider).toBe('vertex')
  })

  it('should create connector with minimal config', () => {
    const connector = new VertexConnector(
      makeConfig({ region: undefined }),
    )
    expect(connector.provider).toBe('vertex')
  })

  // ─── send() — Text response ────────────────────────────

  it('should stream text response', async () => {
    const connector = new VertexConnector(makeConfig())
    const events = [
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Hello' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' world' } },
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
    expect(callArgs?.model).toBe('claude-sonnet-4@20250514')
    expect(callArgs?.stream).toBe(true)
  })

  // ─── send() — Tool use ────────────────────────────────

  it('should stream tool_use events', async () => {
    const connector = new VertexConnector(makeConfig())
    const toolInput = { command: 'ls -la' }
    const events = [
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tu_456', name: 'bash', input: toolInput },
      },
      { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { input_tokens: 20, output_tokens: 8 } },
      { type: 'message_stop' },
    ]

    mockCreateStream.mockResolvedValue(makeStream(events))

    const collected: unknown[] = []
    for await (const event of connector.send(undefined, [{ role: 'user', content: 'Run command' }], [])) {
      collected.push(event)
      if (event.type === 'done') break
    }

    expect(collected).toHaveLength(3)
    const toolUseStart = collected[0] as Record<string, unknown>
    expect(toolUseStart.type).toBe('tool_use_start')
    expect(toolUseStart.id).toBe('tu_456')
    expect(toolUseStart.name).toBe('bash')

    const toolUseEnd = collected[1] as Record<string, unknown>
    expect(toolUseEnd.type).toBe('tool_use_end')
    expect(toolUseEnd.id).toBe('tu_456')
  })

  // ─── send() — System prompt ────────────────────────────

  it('should pass system prompt to the API', async () => {
    const connector = new VertexConnector(makeConfig())
    const events = [
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Understood' } },
      { type: 'message_stop' },
    ]

    mockCreateStream.mockResolvedValue(makeStream(events))

    const results: string[] = []
    for await (const event of connector.send('You are a code assistant', [{ role: 'user', content: 'Help' }], [])) {
      if (event.type === 'text') results.push(event.text)
      if (event.type === 'done') break
    }

    expect(results).toEqual(['Understood'])
    const callArgs = mockCreateStream.mock.calls[0]?.[0]
    expect(callArgs?.system).toBeDefined()
    expect(callArgs?.system[0]?.text).toBe('You are a code assistant')
  })

  // ─── send() — Error handling ───────────────────────────

  it('should yield error event on API failure', async () => {
    const connector = new VertexConnector(makeConfig())
    mockCreateStream.mockRejectedValue(new Error('Vertex API error'))

    const errors: Error[] = []
    for await (const event of connector.send(undefined, [{ role: 'user', content: 'Hi' }], [])) {
      if (event.type === 'error') errors.push(event.error)
    }

    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toBe('Vertex API error')
  })

  // ─── send() — Tool definitions ─────────────────────────

  it('should pass tool definitions to the API', async () => {
    const connector = new VertexConnector(makeConfig())
    const events = [
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'OK' } },
      { type: 'message_stop' },
    ]

    mockCreateStream.mockResolvedValue(makeStream(events))

    const tools = [
      {
        name: 'read_file',
        description: 'Read a file',
        input_schema: { type: 'object' as const, properties: { path: { type: 'string' } }, required: ['path'] },
      },
    ]

    for await (const _event of connector.send(undefined, [{ role: 'user', content: 'Read' }], tools)) {
      if (_event.type === 'done') break
    }

    const callArgs = mockCreateStream.mock.calls[0]?.[0]
    expect(callArgs?.tools).toHaveLength(1)
    expect(callArgs?.tools[0]?.name).toBe('read_file')
  })

  // ─── countTokens() — Via API ───────────────────────────

  it('should count tokens via API', async () => {
    const connector = new VertexConnector(makeConfig())
    mockCountTokens.mockResolvedValue({ input_tokens: 42 })

    const count = await connector.countTokens([
      { role: 'user', content: 'Some text here' },
    ])

    expect(count).toBe(42)
    expect(mockCountTokens).toHaveBeenCalledTimes(1)
    expect(mockCountTokens.mock.calls[0]?.[0]?.model).toBe('claude-sonnet-4@20250514')
  })

  // ─── countTokens() — Fallback on failure ──────────────

  it('should fall back to estimation when countTokens API fails', async () => {
    const connector = new VertexConnector(makeConfig())
    mockCountTokens.mockRejectedValue(new Error('API not available'))

    const count = await connector.countTokens([
      { role: 'user', content: 'Hello' },  // 5 chars / 4 = 1.25 → ceil = 2
    ])

    expect(count).toBe(2)
  })

  // ─── send() — Empty messages ───────────────────────────

  it('should handle empty messages gracefully', async () => {
    const connector = new VertexConnector(makeConfig())
    const events: string[] = []
    for await (const event of connector.send(undefined, [], [])) {
      events.push(event.type)
    }
    expect(events).toEqual(['done'])
    expect(mockCreateStream).not.toHaveBeenCalled()
  })

  // ─── send() — Usage tracking ──────────────────────────

  it('should capture usage from message_delta', async () => {
    const connector = new VertexConnector(makeConfig())
    const events = [
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Hello' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { input_tokens: 30, output_tokens: 5 } },
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

    expect(capturedUsage).toEqual({ inputTokens: 30, outputTokens: 5 })
  })

  // ─── isVertexConfig ────────────────────────────────────

  it('should identify vertex config', async () => {
    const { isVertexConfig } = await import('../vertex.js')
    expect(isVertexConfig({ provider: 'vertex' })).toBe(true)
    expect(isVertexConfig({ provider: 'bedrock' })).toBe(false)
    expect(isVertexConfig({ provider: 'foundry' })).toBe(false)
  })
})
