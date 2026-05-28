/**
 * Edge-case tests for Streaming module — abnormal input,
 * large streams, and boundary conditions.
 *
 * Complements existing tests in src/streaming/__tests__/consumer.test.ts.
 */
import { describe, expect, it, vi } from 'vitest'
import type { StreamEvent } from '../../llm/types.js'
import { StreamConsumer, createStreamConsumer, streamToBlocks, streamToText } from '../consumer.js'
import type { StreamBlock } from '../types.js'

// ─── Helpers ───────────────────────────────────────────────

async function* mockStream(events: StreamEvent[]): AsyncIterable<StreamEvent> {
  for (const e of events) yield e
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = []
  for await (const item of iter) items.push(item)
  return items
}

// ─── streamToBlocks — Abnormal Input ──────────────────────

describe('streamToBlocks — Abnormal Input', () => {
  it('should handle tool_use_end without matching start (orphaned end)', async () => {
    const stream = mockStream([
      { type: 'tool_use_end', id: 'orphan-1', output: 'result', isError: false },
      { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } },
    ])

    const result = await collect(streamToBlocks(stream))
    expect(result).toHaveLength(0)
  })

  it('should handle multiple tool_use_start for same id (override)', async () => {
    const stream = mockStream([
      {
        type: 'tool_use_start',
        id: 'tu-1',
        name: 'first',
        input: { cmd: 'first' },
      },
      {
        type: 'tool_use_start',
        id: 'tu-1',
        name: 'second',
        input: { cmd: 'second' },
      },
      { type: 'tool_use_end', id: 'tu-1', output: 'result', isError: false },
      { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } },
    ])

    const result = await collect(streamToBlocks(stream))
    expect(result).toHaveLength(1)
    // The second start overrides the first in the Map
    const block = result[0] as any
    expect(block.name).toBe('second')
    expect(block.input).toEqual({ cmd: 'second' })
  })

  it('should handle tool_use with undefined output', async () => {
    const stream = mockStream([
      {
        type: 'tool_use_start',
        id: 'tu-1',
        name: 'bash',
        input: { cmd: 'ls' },
      },
      { type: 'tool_use_end', id: 'tu-1', output: undefined as any, isError: false },
      { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } },
    ])

    const result = await collect(streamToBlocks(stream))
    expect(result).toHaveLength(1)
    expect((result[0] as any).result).toBeUndefined()
  })

  it('should handle stream with only ping events', async () => {
    const stream = mockStream([
      { type: 'ping' },
      { type: 'ping' },
      { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } },
    ])

    const text = await collect(streamToText(stream))
    expect(text).toEqual([])

    const blocks = await collect(streamToBlocks(stream))
    expect(blocks).toEqual([])
  })

  it('should handle stream that errors immediately', async () => {
    const stream = mockStream([{ type: 'error', error: new Error('Immediate failure') }])

    const text = await collect(streamToText(stream))
    expect(text).toEqual([])

    const blocks = await collect(streamToBlocks(stream))
    expect(blocks).toEqual([])
  })

  it('should handle stream with only retry events', async () => {
    const stream = mockStream([
      { type: 'retry', attempt: 1, delayMs: 100, error: 'rate limit' },
      { type: 'retry', attempt: 2, delayMs: 200, error: 'still rate limited' },
      { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } },
    ])

    const text = await collect(streamToText(stream))
    expect(text).toEqual([])

    const blocks = await collect(streamToBlocks(stream))
    expect(blocks).toEqual([])
  })
})

// ─── streamToText — Edge Cases ────────────────────────────

describe('streamToText — Edge Cases', () => {
  it('should stop at first done event', async () => {
    const stream = mockStream([
      { type: 'text', text: 'Before' },
      { type: 'done', usage: { inputTokens: 1, outputTokens: 1 } },
      { type: 'text', text: 'After' },
    ])

    const result = await collect(streamToText(stream))
    expect(result).toEqual(['Before'])
  })

  it('should stop at first error event', async () => {
    const stream = mockStream([
      { type: 'text', text: 'Part 1' },
      { type: 'error', error: new Error('API Error') },
      { type: 'text', text: 'Part 2' },
    ])

    const result = await collect(streamToText(stream))
    expect(result).toEqual(['Part 1'])
  })

  it('should handle empty stream', async () => {
    const stream = mockStream([])
    const result = await collect(streamToText(stream))
    expect(result).toEqual([])
  })
})

// ─── Large Stream Performance ─────────────────────────────

describe('Streaming — Large Stream Performance', () => {
  it('should handle 1000 text events in streamToText', async () => {
    const events: StreamEvent[] = []
    for (let i = 0; i < 1000; i++) {
      events.push({ type: 'text', text: `chunk-${i}` })
    }
    events.push({ type: 'done', usage: { inputTokens: 100, outputTokens: 100 } })

    const stream = mockStream(events)
    const result = await collect(streamToText(stream))
    expect(result).toHaveLength(1000)
    expect(result[0]).toBe('chunk-0')
    expect(result[999]).toBe('chunk-999')
  })

  it('should handle 500 tool uses in streamToBlocks', async () => {
    const events: StreamEvent[] = []
    for (let i = 0; i < 500; i++) {
      events.push({
        type: 'tool_use_start',
        id: `tu-${i}`,
        name: 'test-tool',
        input: { index: i },
      })
      events.push({
        type: 'tool_use_end',
        id: `tu-${i}`,
        output: `result-${i}`,
        isError: false,
      })
    }
    events.push({ type: 'done', usage: { inputTokens: 500, outputTokens: 500 } })

    const stream = mockStream(events)
    const result = await collect(streamToBlocks(stream))
    expect(result).toHaveLength(500)
    expect((result[0] as any).id).toBe('tu-0')
    expect((result[499] as any).id).toBe('tu-499')
  })

  it('should handle interleaved tool uses in large stream', async () => {
    const events: StreamEvent[] = []
    // Start 50 tools, then end them in reverse order
    for (let i = 0; i < 50; i++) {
      events.push({
        type: 'tool_use_start',
        id: `tu-${i}`,
        name: 'bash',
        input: { cmd: `cmd-${i}` },
      })
    }
    for (let i = 49; i >= 0; i--) {
      events.push({
        type: 'tool_use_end',
        id: `tu-${i}`,
        output: `out-${i}`,
        isError: false,
      })
    }
    events.push({ type: 'done', usage: { inputTokens: 100, outputTokens: 100 } })

    const stream = mockStream(events)
    const result = await collect(streamToBlocks(stream))
    expect(result).toHaveLength(50)
  })
})

// ─── StreamConsumer — Edge Cases ──────────────────────────

describe('StreamConsumer — Edge Cases', () => {
  it('should consume empty stream without error', async () => {
    const consumer = new StreamConsumer(mockStream([]))
    await expect(consumer.consume()).resolves.toBeUndefined()
  })

  it('should consume stream with only done event', async () => {
    const consumer = new StreamConsumer(mockStream([{ type: 'done', usage: { inputTokens: 0, outputTokens: 0 } }]))
    await expect(consumer.consume()).resolves.toBeUndefined()
  })

  it('should handle on() with unregistered type (no crash)', async () => {
    const consumer = new StreamConsumer(
      mockStream([
        { type: 'text', text: 'Hello' },
        { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } },
      ]),
    )

    // Register handler for 'thinking' but stream has no thinking events
    const handler = vi.fn()
    consumer.on('thinking', handler)
    await consumer.consume()
    expect(handler).not.toHaveBeenCalled()
  })

  it('should allow multiple handlers for same event type', async () => {
    const h1 = vi.fn()
    const h2 = vi.fn()
    const consumer = new StreamConsumer(
      mockStream([
        { type: 'text', text: 'A' },
        { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } },
      ]),
    )

    consumer.on('text', h1)
    consumer.on('text', h2)
    await consumer.consume()

    expect(h1).toHaveBeenCalledTimes(1)
    expect(h2).toHaveBeenCalledTimes(1)
  })

  it('should call wildcard handler for all events', async () => {
    const handler = vi.fn()
    const consumer = new StreamConsumer(
      mockStream([
        { type: 'text', text: 'A' },
        { type: 'thinking', thinking: '...' },
        { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } },
      ]),
    )

    consumer.onEvent(handler)
    await consumer.consume()

    expect(handler).toHaveBeenCalledTimes(3)
  })

  it('should handle unsubscribe for onEvent', async () => {
    const handler = vi.fn()
    const consumer = new StreamConsumer(mockStream([{ type: 'done', usage: { inputTokens: 0, outputTokens: 0 } }]))

    const unsub = consumer.onEvent(handler)
    unsub()
    await consumer.consume()
    expect(handler).not.toHaveBeenCalled()
  })

  it('should handle toPromise on very short stream', async () => {
    const consumer = new StreamConsumer(
      mockStream([
        { type: 'text', text: 'short' },
        { type: 'done', usage: { inputTokens: 5, outputTokens: 3 } },
      ]),
    )

    const result = await consumer.toPromise()
    expect(result.text).toBe('short')
    expect(result.toolUses).toEqual([])
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 3 })
  })

  it('should return partial result on error in toPromise', async () => {
    const consumer = new StreamConsumer(
      mockStream([
        { type: 'text', text: 'Partial ' },
        { type: 'error', error: new Error('Stream failed') },
        { type: 'text', text: ' ignored' },
      ]),
    )

    const result = await consumer.toPromise()
    expect(result.text).toBe('Partial ')
    expect(result.toolUses).toEqual([])
  })
})

// ─── createStreamConsumer Factory ──────────────────────────

describe('createStreamConsumer — Factory Edge Cases', () => {
  it('should create consumer with abort signal', async () => {
    const ac = new AbortController()
    const stream = mockStream([
      { type: 'text', text: 'test' },
      { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } },
    ])

    const consumer = createStreamConsumer(stream, ac.signal)
    expect(consumer).toBeInstanceOf(StreamConsumer)
    const result = await consumer.toPromise()
    expect(result.text).toBe('test')
  })

  it('should respect abort signal before consumption', async () => {
    const ac = new AbortController()
    ac.abort()
    const stream = mockStream([
      { type: 'text', text: 'Should not see' },
      { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } },
    ])

    const consumer = createStreamConsumer(stream, ac.signal)
    const result = await consumer.toPromise()
    expect(result.text).toBe('')
  })
})
