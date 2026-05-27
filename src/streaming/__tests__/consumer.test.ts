/**
 * Tests for Streaming module — Phase 3B B1
 *
 * Tests for streamToText, streamToBlocks, createStreamConsumer, and StreamConsumer.
 */
import { describe, expect, it, vi } from 'vitest'
import type { StreamEvent } from '../../llm/types.js'
import { StreamConsumer, createStreamConsumer, streamToBlocks, streamToText } from '../consumer.js'
import type { StreamBlock, TextBlock, ThinkingBlock, ToolUseBlock } from '../types.js'

// ─── Helpers ───────────────────────────────────────────────

/** Create a mock async iterable from an array of events */
async function* mockStream(events: StreamEvent[]): AsyncIterable<StreamEvent> {
  for (const e of events) {
    yield e
  }
}

/** Collect all items from an async iterable */
async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = []
  for await (const item of iter) {
    items.push(item)
  }
  return items
}

// ─── streamToText ─────────────────────────────────────────

describe('streamToText', () => {
  it('should yield only text events, filtering out others', async () => {
    const stream = mockStream([
      { type: 'text', text: 'Hello' },
      { type: 'thinking', thinking: 'hmm' },
      { type: 'text', text: ' World' },
      { type: 'ping' },
      { type: 'text', text: '!' },
      { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
    ])

    const result = await collect(streamToText(stream))
    expect(result).toEqual(['Hello', ' World', '!'])
  })

  it('should yield nothing when stream has no text events', async () => {
    const stream = mockStream([
      { type: 'thinking', thinking: 'hmm' },
      { type: 'ping' },
      { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
    ])

    const result = await collect(streamToText(stream))
    expect(result).toEqual([])
  })

  it('should yield empty text when empty string', async () => {
    const stream = mockStream([
      { type: 'text', text: '' },
      { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } },
    ])

    const result = await collect(streamToText(stream))
    expect(result).toEqual([''])
  })

  it('should propagate errors from the stream', async () => {
    const error = new Error('API error')
    const stream = mockStream([
      { type: 'text', text: 'Before' },
      { type: 'error', error },
    ])

    const items: string[] = []
    // The stream should stop on error
    for await (const item of streamToText(stream)) {
      items.push(item)
    }
    expect(items).toEqual(['Before'])
  })

  it('should not yield tool_use_start or tool_use_end events', async () => {
    const stream = mockStream([
      { type: 'text', text: 'Result' },
      {
        type: 'tool_use_start',
        id: 'tool-1',
        name: 'bash',
        input: { command: 'ls' },
      },
      { type: 'tool_use_end', id: 'tool-1', output: 'files', isError: false },
      { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
    ])

    const result = await collect(streamToText(stream))
    expect(result).toEqual(['Result'])
  })
})

// ─── streamToBlocks ───────────────────────────────────────

describe('streamToBlocks', () => {
  it('should yield text blocks for text events', async () => {
    const stream = mockStream([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' World' },
      { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
    ])

    const result = await collect(streamToBlocks(stream))
    expect(result).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' World' },
    ])
  })

  it('should yield thinking blocks for thinking events', async () => {
    const stream = mockStream([
      { type: 'thinking', thinking: 'I need to think about this' },
      { type: 'text', text: 'Answer' },
      { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
    ])

    const result = await collect(streamToBlocks(stream))
    expect(result).toEqual([
      { type: 'thinking', thinking: 'I need to think about this' },
      { type: 'text', text: 'Answer' },
    ])
  })

  it('should aggregate tool_use_start + tool_use_end into a complete ToolUseBlock', async () => {
    const stream = mockStream([
      { type: 'text', text: 'Let me check' },
      {
        type: 'tool_use_start',
        id: 'tu-1',
        name: 'bash',
        input: { command: 'ls' },
      },
      { type: 'tool_use_end', id: 'tu-1', output: 'file1.txt', isError: false },
      { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
    ])

    const result = await collect(streamToBlocks(stream))
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ type: 'text', text: 'Let me check' })
    expect(result[1]).toEqual({
      type: 'tool_use',
      id: 'tu-1',
      name: 'bash',
      input: { command: 'ls' },
      result: 'file1.txt',
      isError: false,
    })
  })

  it('should handle multiple tool uses in parallel', async () => {
    const stream = mockStream([
      {
        type: 'tool_use_start',
        id: 'tu-1',
        name: 'bash',
        input: { command: 'ls' },
      },
      {
        type: 'tool_use_start',
        id: 'tu-2',
        name: 'grep',
        input: { pattern: 'test' },
      },
      { type: 'tool_use_end', id: 'tu-1', output: 'files', isError: false },
      { type: 'tool_use_end', id: 'tu-2', output: 'matches', isError: true },
      { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
    ])

    const result = await collect(streamToBlocks(stream))
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      type: 'tool_use',
      id: 'tu-1',
      name: 'bash',
      result: 'files',
      isError: false,
    })
    expect(result[1]).toMatchObject({
      type: 'tool_use',
      id: 'tu-2',
      name: 'grep',
      result: 'matches',
      isError: true,
    })
  })

  it('should skip tool_use_start without matching end (orphaned)', async () => {
    const stream = mockStream([
      {
        type: 'tool_use_start',
        id: 'tu-1',
        name: 'bash',
        input: { command: 'ls' },
      },
      { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
    ])

    const result = await collect(streamToBlocks(stream))
    expect(result).toHaveLength(0)
  })

  it('should skip ping and error events', async () => {
    const stream = mockStream([
      { type: 'ping' },
      { type: 'error', error: new Error('err') },
      { type: 'text', text: 'Survived' },
      { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
    ])

    const result = await collect(streamToBlocks(stream))
    expect(result).toEqual([{ type: 'text', text: 'Survived' }])
  })

  it('should skip retry events', async () => {
    const stream = mockStream([
      { type: 'retry', attempt: 1, delayMs: 100, error: 'rate limit' },
      { type: 'text', text: 'After retry' },
      { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
    ])

    const result = await collect(streamToBlocks(stream))
    expect(result).toEqual([{ type: 'text', text: 'After retry' }])
  })
})

// ─── StreamConsumer ───────────────────────────────────────

describe('StreamConsumer', () => {
  describe('toTextStream()', () => {
    it('should produce text fragments', async () => {
      const consumer = new StreamConsumer(
        mockStream([
          { type: 'text', text: 'Hello' },
          { type: 'thinking', thinking: '...' },
          { type: 'text', text: ' World' },
          { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
        ]),
      )

      const result = await collect(consumer.toTextStream())
      expect(result).toEqual(['Hello', ' World'])
    })
  })

  describe('toBlockStream()', () => {
    it('should produce blocks', async () => {
      const consumer = new StreamConsumer(
        mockStream([
          { type: 'text', text: 'Hi' },
          { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
        ]),
      )

      const result = await collect(consumer.toBlockStream())
      expect(result).toEqual([{ type: 'text', text: 'Hi' }])
    })
  })

  describe('on()', () => {
    it('should register type-specific handlers', async () => {
      const textHandler = vi.fn()
      const consumer = new StreamConsumer(
        mockStream([
          { type: 'text', text: 'A' },
          { type: 'text', text: 'B' },
          { type: 'thinking', thinking: '...' },
          { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } },
        ]),
      )

      consumer.on('text', textHandler)
      await consumer.consume()

      expect(textHandler).toHaveBeenCalledTimes(2)
      expect(textHandler).toHaveBeenNthCalledWith(1, {
        type: 'text',
        text: 'A',
      })
      expect(textHandler).toHaveBeenNthCalledWith(2, {
        type: 'text',
        text: 'B',
      })
    })

    it('should return an unsubscribe function', async () => {
      const handler = vi.fn()
      const consumer = new StreamConsumer(
        mockStream([
          { type: 'text', text: 'A' },
          { type: 'text', text: 'B' },
          { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } },
        ]),
      )

      const unsub = consumer.on('text', handler)
      unsub()
      await consumer.consume()

      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('onEvent()', () => {
    it('should trigger on every event', async () => {
      const handler = vi.fn()
      const consumer = new StreamConsumer(
        mockStream([
          { type: 'text', text: 'A' },
          { type: 'ping' },
          { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } },
        ]),
      )

      consumer.onEvent(handler)
      await consumer.consume()

      expect(handler).toHaveBeenCalledTimes(3)
    })

    it('should return an unsubscribe function', async () => {
      const handler = vi.fn()
      const consumer = new StreamConsumer(mockStream([{ type: 'done', usage: { inputTokens: 0, outputTokens: 0 } }]))

      const unsub = consumer.onEvent(handler)
      unsub()
      await consumer.consume()

      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('toPromise()', () => {
    it('should collect all text and tool uses', async () => {
      const stream = mockStream([
        { type: 'text', text: 'Hello' },
        { type: 'text', text: ' World' },
        {
          type: 'tool_use_start',
          id: 'tu-1',
          name: 'bash',
          input: { command: 'ls' },
        },
        { type: 'tool_use_end', id: 'tu-1', output: 'files', isError: false },
        { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
      ])

      const consumer = new StreamConsumer(stream)
      const result = await consumer.toPromise()

      expect(result.text).toBe('Hello World')
      expect(result.toolUses).toHaveLength(1)
      expect(result.toolUses[0]).toMatchObject({
        name: 'bash',
        result: 'files',
      })
      expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
    })

    it('should return empty text and toolUses when no events', async () => {
      const stream = mockStream([{ type: 'done', usage: { inputTokens: 0, outputTokens: 0 } }])

      const consumer = new StreamConsumer(stream)
      const result = await consumer.toPromise()

      expect(result.text).toBe('')
      expect(result.toolUses).toEqual([])
      expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 })
    })

    it('should stop on error event', async () => {
      const stream = mockStream([
        { type: 'text', text: 'Before' },
        { type: 'error', error: new Error('fail') },
        { type: 'text', text: 'After' },
        { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } },
      ])

      const consumer = new StreamConsumer(stream)
      const result = await consumer.toPromise()

      expect(result.text).toBe('Before')
      expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 })
    })
  })

  describe('abort signal', () => {
    it('should stop consumption when aborted', async () => {
      const ac = new AbortController()
      const stream = mockStream([
        { type: 'text', text: 'Before' },
        { type: 'text', text: 'After' },
      ])

      const consumer = new StreamConsumer(stream, ac.signal)
      ac.abort()

      const items: string[] = []
      for await (const item of consumer.toTextStream()) {
        items.push(item)
      }
      expect(items).toEqual([])
    })
  })
})

// ─── createStreamConsumer ─────────────────────────────────

describe('createStreamConsumer', () => {
  it('should return a StreamConsumer instance', () => {
    const stream = mockStream([])
    const consumer = createStreamConsumer(stream)
    expect(consumer).toBeInstanceOf(StreamConsumer)
  })

  it('should allow consuming via toPromise', async () => {
    const stream = mockStream([
      { type: 'text', text: 'test' },
      { type: 'done', usage: { inputTokens: 1, outputTokens: 1 } },
    ])

    const result = await createStreamConsumer(stream).toPromise()
    expect(result.text).toBe('test')
  })
})
