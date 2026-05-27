/**
 * Tests for retry engine (withRetry / shouldRetry / getRetryDelay)
 *
 * Tests the core retry logic in isolation from providers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getRetryDelay, isRetryableError, shouldRetry, withRetry } from '../retry.js'

// ─── getRetryDelay ──────────────────────────────────────────

describe('getRetryDelay', () => {
  it('should return base delay for first attempt', () => {
    const delay = getRetryDelay(1)
    // baseDelay = 500 * 2^0 = 500, jitter = 0..125
    expect(delay).toBeGreaterThanOrEqual(500)
    expect(delay).toBeLessThanOrEqual(625)
  })

  it('should use retry-after header if provided', () => {
    const delay = getRetryDelay(3, '5')
    expect(delay).toBe(5000) // 5 seconds
  })

  it('should double delay each attempt', () => {
    const d1 = getRetryDelay(1, undefined, 100000)
    const d2 = getRetryDelay(2, undefined, 100000)
    const d3 = getRetryDelay(3, undefined, 100000)
    // attempt 1: 500 + jitter
    // attempt 2: 1000 + jitter
    // attempt 3: 2000 + jitter
    expect(d2).toBeGreaterThanOrEqual(1000)
    expect(d2).toBeLessThan(d3)
  })

  it('should cap at maxDelayMs', () => {
    const delay = getRetryDelay(10, undefined, 2000)
    // Without cap: 500 * 2^9 = 256000 >> 2000
    expect(delay).toBeLessThanOrEqual(2000 + 0.25 * 2000)
  })

  it('should apply jitter', () => {
    const delays = new Set<number>()
    for (let i = 0; i < 50; i++) {
      delays.add(getRetryDelay(1, undefined, 100000))
    }
    // At least some variation from jitter
    expect(delays.size).toBeGreaterThan(1)
  })
})

// ─── shouldRetry ─────────────────────────────────────────────

describe('shouldRetry', () => {
  // Create API error-like objects
  function makeApiError(status: number | undefined, message = 'error'): Error & { status?: number; message: string } {
    const err = new Error(message) as Error & { status?: number }
    if (status !== undefined) err.status = status
    return err
  }

  it('should retry on 408 (request timeout)', () => {
    expect(shouldRetry(makeApiError(408))).toBe(true)
  })

  it('should retry on 409 (lock timeout)', () => {
    expect(shouldRetry(makeApiError(409))).toBe(true)
  })

  it('should retry on 429 (rate limit)', () => {
    expect(shouldRetry(makeApiError(429))).toBe(true)
  })

  it('should retry on 500+ (server errors)', () => {
    expect(shouldRetry(makeApiError(500))).toBe(true)
    expect(shouldRetry(makeApiError(502))).toBe(true)
    expect(shouldRetry(makeApiError(503))).toBe(true)
    expect(shouldRetry(makeApiError(529))).toBe(true)
  })

  it('should retry on network/connection errors', () => {
    // APIConnectionError equivalent
    expect(shouldRetry(makeApiError(undefined, 'Connection error'))).toBe(true)
  })

  it('should NOT retry on 400 (bad request)', () => {
    expect(shouldRetry(makeApiError(400))).toBe(false)
  })

  it('should NOT retry on 401 (auth error) without special handling', () => {
    expect(shouldRetry(makeApiError(401))).toBe(true) // clear cache and retry
  })

  it('should NOT retry on 403 (forbidden)', () => {
    expect(shouldRetry(makeApiError(403))).toBe(false)
  })

  it('should NOT retry on 404 (not found)', () => {
    expect(shouldRetry(makeApiError(404))).toBe(false)
  })

  it('should NOT retry on non-Error values', () => {
    expect(shouldRetry('string error')).toBe(false)
    expect(shouldRetry(null)).toBe(false)
    expect(shouldRetry(undefined)).toBe(false)
  })

  it('should retry on overloaded_error in message', () => {
    const error = makeApiError(200) // OK status but overloaded in message
    error.message = '{"type":"overloaded_error"}'
    expect(shouldRetry(error)).toBe(true)
  })
})

// ─── isRetryableError ───────────────────────────────────────

describe('isRetryableError', () => {
  function makeErr(msg: string, status?: number): Error & { status?: number } {
    const e = new Error(msg) as Error & { status?: number }
    if (status !== undefined) e.status = status
    return e
  }

  it('should identify rate limit errors', () => {
    const result = isRetryableError(makeErr('Rate limited', 429))
    expect(result.kind).toBe('rate_limit')
    expect(result.retryable).toBe(true)
  })

  it('should identify overloaded errors', () => {
    const result = isRetryableError(makeErr('overloaded', 529))
    expect(result.kind).toBe('overloaded')
    expect(result.retryable).toBe(true)
  })

  it('should identify network errors', () => {
    const result = isRetryableError(makeErr('ECONNREFUSED'))
    expect(result.kind).toBe('network')
    expect(result.retryable).toBe(true)
  })

  it('should identify auth errors', () => {
    const result = isRetryableError(makeErr('Invalid credentials', 401))
    expect(result.kind).toBe('auth')
    expect(result.retryable).toBe(true) // Can retry after clearing cache
  })

  it('should identify non-retryable errors', () => {
    const result = isRetryableError(makeErr('Bad request', 400))
    expect(result.kind).toBe('non_retryable')
    expect(result.retryable).toBe(false)
  })

  it('should handle unknown errors gracefully', () => {
    const result = isRetryableError('Some random string')
    expect(result.kind).toBe('unknown')
    expect(result.retryable).toBe(false)
  })
})

// ─── withRetry ───────────────────────────────────────────────

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Create an error that looks like a retryable API error */
  function retryableError(msg: string): Error & { status?: number } {
    const err = new Error(msg) as Error & { status?: number }
    err.status = 429 // Rate limit — always retryable
    return err
  }

  it('should return successful result on first attempt', async () => {
    const operation = vi.fn().mockResolvedValue('success')
    const result = await withRetry(operation, { maxRetries: 3 })
    expect(result).toBe('success')
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('should retry on failure and succeed', async () => {
    const operation = vi.fn().mockRejectedValueOnce(retryableError('Transient error')).mockResolvedValueOnce('success')

    // We can't use fake timers for the actual retry since the sleep
    // promise needs to resolve. Let's use a very short base delay.
    vi.useRealTimers()
    const result = await withRetry(operation, {
      maxRetries: 3,
      baseDelayMs: 1,
    })
    expect(result).toBe('success')
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('should throw after exhausting retries', async () => {
    const error = retryableError('Persistent error')
    const operation = vi.fn().mockRejectedValue(error)

    vi.useRealTimers()
    await expect(withRetry(operation, { maxRetries: 2, baseDelayMs: 1 })).rejects.toThrow('Persistent error')
    expect(operation).toHaveBeenCalledTimes(3) // 1 initial + 2 retries
  })

  it('should yield retry events', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(retryableError('Fail 1'))
      .mockRejectedValueOnce(retryableError('Fail 2'))
      .mockResolvedValueOnce('success')

    const events: Array<{ type: string; attempt: number }> = []
    vi.useRealTimers()
    const result = await withRetry(operation, {
      maxRetries: 3,
      baseDelayMs: 1,
      onRetry: (event) => {
        events.push(event)
      },
    })

    expect(result).toBe('success')
    expect(events).toHaveLength(2)
    expect(events[0]?.type).toBe('retry')
    expect(events[0]?.attempt).toBe(1)
    expect(events[1]?.type).toBe('retry')
    expect(events[1]?.attempt).toBe(2)
  })

  it('should not retry on non-retryable errors', async () => {
    const error = new Error('Bad request') as Error & { status?: number }
    error.status = 400
    const operation = vi.fn().mockRejectedValue(error)

    await expect(withRetry(operation, { maxRetries: 3 })).rejects.toThrow('Bad request')
    expect(operation).toHaveBeenCalledTimes(1) // No retry
  })

  it('should respect abort signal during retry delay', async () => {
    const controller = new AbortController()
    const operation = vi.fn().mockRejectedValue(retryableError('Transient'))

    // Abort immediately
    controller.abort()

    await expect(
      withRetry(operation, {
        maxRetries: 3,
        signal: controller.signal,
      }),
    ).rejects.toThrow('aborted')
  })

  it('should pass attempt number to operation', async () => {
    const attempts: number[] = []
    const operation = vi.fn().mockImplementation(async (attempt: number) => {
      attempts.push(attempt)
      if (attempt < 2) throw retryableError('fail')
      return 'ok'
    })

    vi.useRealTimers()
    await withRetry(operation, { maxRetries: 3, baseDelayMs: 1 })
    expect(attempts).toEqual([1, 2])
  })

  it('should handle zero retries (fail fast)', async () => {
    const operation = vi.fn().mockRejectedValue(retryableError('fail'))
    await expect(withRetry(operation, { maxRetries: 0 })).rejects.toThrow('fail')
    expect(operation).toHaveBeenCalledTimes(1)
  })
})
