/**
 * Edge-case tests for FeedbackInjector — mode switching,
 * injection timing, and boundary conditions.
 *
 * Complements existing tests in feedback.test.ts.
 */
import { describe, expect, it, vi } from 'vitest'
import { FeedbackInjector } from '../feedback/index.js'
import type { FeedbackContext, FeedbackInput } from '../feedback/index.js'

// ─── Mode Switching ───────────────────────────────────────

describe('FeedbackInjector — Mode Switching', () => {
  it('should switch between disabled, manual, and auto modes', () => {
    const disabled = new FeedbackInjector({ mode: 'disabled' })
    const manual = new FeedbackInjector({ mode: 'manual', onFeedback: async () => null })
    const auto = new FeedbackInjector({ mode: 'auto' })

    // disabled — waitForFeedback returns null immediately
    const ctx: FeedbackContext = { text: 'hello', toolCalls: [], messages: [] }
    // We can't test waitForFeedback directly on disabled since it depends on mode check
    // But we can test getAutoFeedback returns null for non-auto modes
    expect(disabled.getAutoFeedback([{ id: 't1', name: 'x', input: {}, result: 'err', isError: true }])).toBeNull()
    expect(manual.getAutoFeedback([{ id: 't1', name: 'x', input: {}, result: 'err', isError: true }])).toBeNull()
    expect(auto.getAutoFeedback([{ id: 't1', name: 'x', input: {}, result: 'err', isError: true }])).not.toBeNull()
  })

  it('disabled mode — waitForFeedback returns null even with callback', async () => {
    const callback = vi.fn().mockResolvedValue({ text: 'should not be called' })
    const injector = new FeedbackInjector({ mode: 'disabled', onFeedback: callback })

    const result = await injector.waitForFeedback({
      text: 'test',
      toolCalls: [],
      messages: [],
    })

    expect(result).toBeNull()
    expect(callback).not.toHaveBeenCalled()
  })
})

// ─── Injection Timing ─────────────────────────────────────

describe('FeedbackInjector — Injection Timing', () => {
  it('should inject text feedback at correct position in message array', () => {
    const injector = new FeedbackInjector({ mode: 'manual' })
    const messages = [
      { id: 'm1', role: 'user' as const, content: 'Hello', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'm2', role: 'assistant' as const, content: 'Response', createdAt: '2026-01-01T00:00:01Z' },
    ]

    const result = injector.applyFeedback(messages, {
      text: 'Correction',
    })

    expect(result).toHaveLength(3)
    expect(result[0].content).toBe('Hello')
    expect(result[1].content).toBe('Response')
    expect(result[2].role).toBe('user')
    expect(result[2].content).toBe('Correction')
  })

  it('should handle toolOverrides with mixed match/no-match', () => {
    const injector = new FeedbackInjector({ mode: 'manual' })

    const messages = [
      { id: 'm1', role: 'user' as const, content: 'Do it', createdAt: '2026-01-01T00:00:00Z' },
      {
        id: 'm2', role: 'user' as const, content: 'Result A', createdAt: '2026-01-01T00:00:01Z',
        _toolUseId: 'tool-a',
      },
    ]

    const result = injector.applyFeedback(messages, {
      toolOverrides: [
        { toolUseId: 'tool-a', correctedResult: 'Fixed A' },
        { toolUseId: 'tool-b', correctedResult: 'Fixed B' },
      ],
    })

    // tool-a should be matched and updated
    const matchedMsg = result.find((m: any) => m._toolUseId === 'tool-a')
    expect(matchedMsg).toBeDefined()
    expect((matchedMsg as any).content).toBe('Fixed A') // tool-a matches first override

    // tool-b doesn't match any message, so a note should be appended
    // Additionally, there's a note about unmatched overrides
    expect(result.length).toBeGreaterThanOrEqual(3)
  })

  it('should only add override note when toolOverrides have unmatched items and no text', () => {
    const injector = new FeedbackInjector({ mode: 'manual' })

    const messages = [
      { id: 'm1', role: 'user' as const, content: 'Hi', createdAt: '2026-01-01T00:00:00Z' },
    ]

    // All unmatched, no text
    const result = injector.applyFeedback(messages, {
      toolOverrides: [
        { toolUseId: 't1', correctedResult: 'fixed' },
      ],
    })

    expect(result).toHaveLength(2)
    expect(result[1].content).toContain('overridden')
    expect(result[1].content).toContain('t1')
  })

  it('should NOT add override note when all overrides match', () => {
    const injector = new FeedbackInjector({ mode: 'manual' })

    const messages = [
      {
        id: 'm1', role: 'user' as const, content: 'Result 1', createdAt: '2026-01-01T00:00:00Z',
        _toolUseId: 't1',
      },
    ]

    const result = injector.applyFeedback(messages, {
      toolOverrides: [
        { toolUseId: 't1', correctedResult: 'fixed' },
      ],
    })

    // t1 matched, all matched, no text → no extra note added
    expect(result).toHaveLength(1)
    expect((result[0] as any).content).toBe('fixed')
  })

  it('should NOT add override note when text is also provided (even with unmatched)', () => {
    const injector = new FeedbackInjector({ mode: 'manual' })

    const messages = [
      { id: 'm1', role: 'user' as const, content: 'Hi', createdAt: '2026-01-01T00:00:00Z' },
    ]

    const result = injector.applyFeedback(messages, {
      text: 'User correction',
      toolOverrides: [
        { toolUseId: 't1', correctedResult: 'fixed' },
      ],
    })

    // Should have 2: original + text correction (no note because text is present)
    expect(result).toHaveLength(2)
    expect(result[1].content).toBe('User correction')
  })

  it('should handle empty input (no text, no overrides)', () => {
    const injector = new FeedbackInjector({ mode: 'manual' })
    const messages = [{ id: 'm1', role: 'user' as const, content: 'Hi', createdAt: '2026-01-01T00:00:00Z' }]

    const result = injector.applyFeedback(messages, {})
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe('Hi')
  })
})

// ─── FeedbackContext Edge Cases ───────────────────────────

describe('FeedbackInjector — waitForFeedback Edge Cases', () => {
  it('should handle onFeedback returning undefined (treated as null)', async () => {
    const injector = new FeedbackInjector({
      mode: 'manual',
      onFeedback: async () => undefined,
    })

    const result = await injector.waitForFeedback({
      text: 'test',
      toolCalls: [],
      messages: [],
    })

    expect(result).toBeNull()
  })

  it('should use custom timeout value', async () => {
    const injector = new FeedbackInjector({
      mode: 'manual',
      onFeedback: async () => {
        await new Promise((r) => setTimeout(r, 500))
        return { text: 'slow response' }
      },
      timeout: 50, // very short
    })

    const result = await injector.waitForFeedback({
      text: 'test',
      toolCalls: [],
      messages: [],
    })

    expect(result).toBeNull() // timed out
  })
})

// ─── Auto Mode Edge Cases ─────────────────────────────────

describe('FeedbackInjector — Auto Mode Edge Cases', () => {
  it('should return null for empty toolCalls in auto mode', () => {
    const injector = new FeedbackInjector({ mode: 'auto' })
    expect(injector.getAutoFeedback([])).toBeNull()
  })

  it('should return null when no failed tool calls in auto mode', () => {
    const injector = new FeedbackInjector({ mode: 'auto' })
    const successCalls = [
      { id: 't1', name: 'bash', input: { cmd: 'ls' }, result: 'files', isError: false },
      { id: 't2', name: 'grep', input: { pattern: 'test' }, result: 'match', isError: false },
    ]
    expect(injector.getAutoFeedback(successCalls)).toBeNull()
  })

  it('should generate auto-retry text with all failed tool names', () => {
    const injector = new FeedbackInjector({ mode: 'auto' })
    const failedCalls = [
      { id: 't1', name: 'bash', input: { cmd: 'ls' }, result: 'error', isError: true },
      { id: 't2', name: 'grep', input: { pattern: 'x' }, result: 'error', isError: true },
    ]
    const result = injector.getAutoFeedback(failedCalls)
    expect(result).not.toBeNull()
    expect(result!.text).toContain('bash')
    expect(result!.text).toContain('grep')
    expect(result!.text).toContain('retry')
  })

  it('should only include failed calls in auto-retry text, skipping successful ones', () => {
    const injector = new FeedbackInjector({ mode: 'auto' })
    const mixedCalls = [
      { id: 't1', name: 'good-tool', input: {}, result: 'ok', isError: false },
      { id: 't2', name: 'bad-tool', input: {}, result: 'fail', isError: true },
    ]
    const result = injector.getAutoFeedback(mixedCalls)
    expect(result!.text).toContain('bad-tool')
    expect(result!.text).not.toContain('good-tool')
  })
})

// ─── applyFeedback — Multiple Overrides ───────────────────

describe('FeedbackInjector — Multiple Overrides', () => {
  it('should apply multiple overrides in sequence', () => {
    const injector = new FeedbackInjector({ mode: 'manual' })
    const messages = [
      {
        id: 'm1', role: 'user' as const, content: 'First', createdAt: '2026-01-01T00:00:00Z',
        _toolUseId: 't1',
      },
      {
        id: 'm2', role: 'user' as const, content: 'Second', createdAt: '2026-01-01T00:00:01Z',
        _toolUseId: 't2',
      },
    ]

    const result = injector.applyFeedback(messages, {
      toolOverrides: [
        { toolUseId: 't1', correctedResult: 'Fixed first' },
        { toolUseId: 't2', correctedResult: 'Fixed second' },
      ],
    })

    expect(result).toHaveLength(2)
    expect((result.find((m: any) => m._toolUseId === 't1') as any).content).toBe('Fixed first')
    expect((result.find((m: any) => m._toolUseId === 't2') as any).content).toBe('Fixed second')
  })

  it('override with same toolUseId — last override wins', () => {
    const injector = new FeedbackInjector({ mode: 'manual' })
    const messages = [
      {
        id: 'm1', role: 'user' as const, content: 'Original', createdAt: '2026-01-01T00:00:00Z',
        _toolUseId: 't1',
      },
    ]

    const result = injector.applyFeedback(messages, {
      toolOverrides: [
        { toolUseId: 't1', correctedResult: 'Override 1' },
        { toolUseId: 't1', correctedResult: 'Override 2' },
      ],
    })

    // The second override matches the same message and overwrites it again
    expect((result[0] as any).content).toBe('Override 2')
  })
})
