/**
 * Tests for FoundryConnector
 *
 * Uses vitest mock to replace @anthropic-ai/foundry-sdk with a mock implementation
 * that simulates the streaming API.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FoundryConnector } from '../foundry.js'
import type { FoundryConfig } from '../types.js'

// ─── Mock @anthropic-ai/foundry-sdk ──────────────────────

const mockCreateStream = vi.fn()
const mockCountTokens = vi.fn()

vi.mock('@anthropic-ai/foundry-sdk', () => {
  class MockAnthropicFoundry {
    messages = {
      create: mockCreateStream,
      countTokens: mockCountTokens,
    }
  }
  return { AnthropicFoundry: MockAnthropicFoundry }
})

// ─── Helpers ──────────────────────────────────────────────

function makeConfig(overrides: Partial<FoundryConfig> = {}): FoundryConfig {
  return {
    provider: 'foundry',
    model: 'claude-sonnet-4',
    resourceName: 'my-azure-resource',
    apiKey: 'az-api-key',
    ...overrides,
  }
}

/** Create an async generator that yields stream events */
async function* makeStream(events: unknown[]) {
  for (const event of events) {
    yield event
  }
}

describe('FoundryConnector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─── Construction ──────────────────────────────────────

  it('should create connector with valid config', () => {
    const connector = new FoundryConnector(makeConfig())
    expect(connector.provider).toBe('foundry')
  })

  it('should create connector without API key (uses Azure AD)', () => {
    const connector = new FoundryConnector(
      makeConfig({ apiKey: undefined }),
    )
    expect(connector.provider).toBe('foundry')
  })

  // ─── send() — Text response ────────────────────────────

  it('should stream text response', async () => {
    const connector = new FoundryConnector(makeConfig())
    const events = [
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Hello' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' from Foundry' } },
      { type: 'message_stop' },
    ]

    mockCreateStream.mockResolvedValue(makeStream(events))

    const results: string[] = []
    for await (const event of connector.send(undefined, [{ role: 'user', content: 'Hi' }], [])) {
      if (event.type === 'text') results.push(event.text)
      if (event.type === 'done') break
    }

    expect(results).toEqual(['Hello', ' from Foundry'])
    expect(mockCreateStream).toHaveBeenCalledTimes(1)
    const callArgs = mockCreateStream.mock.calls[0]?.[0]
    expect(callArgs?.model).toBe('claude-sonnet-4')
    expect(callArgs?.stream).toBe(true)
  })

  // ─── send() — Tool use ────────────────────────────────

  it('should stream tool_use events', async () => {
    const connector = new FoundryConnector(makeConfig())
    const toolInput = { query: 'find files', max_results: 5 }
    const events = [
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tu_789', name: 'grep', input: toolInput },
      },
      { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { input_tokens: 15, output_tokens: 6 } },
      { type: 'message_stop' },
    ]

    mockCreateStream.mockResolvedValue(makeStream(events))

    const collected: unknown[] = []
    for await (const event of connector.send(undefined, [{ role: 'user', content: 'Search' }], [])) {
      collected.push(event)
      if (event.type === 'done') break
    }

    expect(collected).toHaveLength(3)
    const toolUseStart = collected[0] as Record<string, unknown>
    expect(toolUseStart.type).toBe('tool_use_start')
    expect(toolUseStart.id).toBe('tu_789')
    expect(toolUseStart.name).toBe('grep')

    const toolUseEnd = collected[1] as Record<string, unknown>
    expect(toolUseEnd.type).toBe('tool_use_end')
    expect(toolUseEnd.id).toBe('tu_789')
  })

  // ─── send() — System prompt ────────────────────────────

  it('should pass system prompt to the API', async () => {
    const connector = new FoundryConnector(makeConfig())
    const events = [
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'OK' } },
      { type: 'message_stop' },
    ]

    mockCreateStream.mockResolvedValue(makeStream(events))

    for await (const _event of connector.send('You are a helpful AI', [{ role: 'user', content: 'Hi' }], [])) {
      if (_event.type === 'done') break
    }

    const callArgs = mockCreateStream.mock.calls[0]?.[0]
    expect(callArgs?.system).toBeDefined()
    expect(callArgs?.system[0]?.text).toBe('You are a helpful AI')
  })

  // ─── send() — Error handling ───────────────────────────

  it('should yield error event on API failure', async () => {
    const connector = new FoundryConnector(makeConfig())
    mockCreateStream.mockRejectedValue(new Error('Foundry API error'))

    const errors: Error[] = []
    for await (const event of connector.send(undefined, [{ role: 'user', content: 'Hi' }], [])) {
      if (event.type === 'error') errors.push(event.error)
    }

    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toBe('Foundry API error')
  })

  // ─── send() — Tool definitions ─────────────────────────

  it('should pass tool definitions to the API', async () => {
    const connector = new FoundryConnector(makeConfig())
    const events = [
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'OK' } },
      { type: 'message_stop' },
    ]

    mockCreateStream.mockResolvedValue(makeStream(events))

    const tools = [
      {
        name: 'web_search',
        description: 'Search the web',
        input_schema: { type: 'object' as const, properties: { q: { type: 'string' } }, required: ['q'] },
      },
    ]

    for await (const _event of connector.send(undefined, [{ role: 'user', content: 'Search' }], tools)) {
      if (_event.type === 'done') break
    }

    const callArgs = mockCreateStream.mock.calls[0]?.[0]
    expect(callArgs?.tools).toHaveLength(1)
    expect(callArgs?.tools[0]?.name).toBe('web_search')
  })

  // ─── send() — With options ─────────────────────────────

  it('should pass maxTokens from options', async () => {
    const connector = new FoundryConnector(makeConfig())
    const events = [
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Short' } },
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
    const connector = new FoundryConnector(makeConfig())
    mockCountTokens.mockResolvedValue({ input_tokens: 77 })

    const count = await connector.countTokens([
      { role: 'user', content: 'Count these tokens' },
    ])

    expect(count).toBe(77)
    expect(mockCountTokens).toHaveBeenCalledTimes(1)
  })

  // ─── countTokens() — Fallback on failure ──────────────

  it('should fall back to estimation when countTokens API fails', async () => {
    const connector = new FoundryConnector(makeConfig())
    mockCountTokens.mockRejectedValue(new Error('Not supported'))

    const count = await connector.countTokens([
      { role: 'user', content: 'Test' },  // 4 chars / 4 = 1
    ])

    expect(count).toBe(1)
  })

  // ─── isFoundryConfig ───────────────────────────────────

  it('should identify foundry config', async () => {
    const { isFoundryConfig } = await import('../foundry.js')
    expect(isFoundryConfig({ provider: 'foundry' })).toBe(true)
    expect(isFoundryConfig({ provider: 'bedrock' })).toBe(false)
    expect(isFoundryConfig({ provider: 'anthropic' })).toBe(false)
  })
})
