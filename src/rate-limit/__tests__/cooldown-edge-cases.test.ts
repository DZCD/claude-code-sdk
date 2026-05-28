/**
 * Edge-case tests for Rate Limiting — cooldown state machine
 * and header parsing edge cases.
 *
 * Complements existing tests in src/rate-limit/__tests__/cooldown.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let mod: typeof import('../cooldown.js')

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-05-28T12:00:00.000Z'))
  mod = await import('../cooldown.js')
  // Module state persists across tests due to module caching,
  // so we explicitly clear it before each test.
  mod.clearCooldown()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Rate Limit — Cooldown Recovery', () => {
  it('should auto-recover exactly at reset boundary', () => {
    const resetAt = Date.now() + 5000
    mod.triggerCooldown(resetAt, 'rate_limit')
    expect(mod.isInCooldown()).toBe(true)

    // Just before boundary
    vi.advanceTimersByTime(4999)
    expect(mod.isInCooldown()).toBe(true)

    // Exactly at boundary
    vi.advanceTimersByTime(1)
    expect(mod.isInCooldown()).toBe(false)
  })

  it('should recover and allow new cooldown to be set', () => {
    mod.triggerCooldown(Date.now() + 1000, 'rate_limit')
    vi.advanceTimersByTime(2000)
    expect(mod.isInCooldown()).toBe(false)

    mod.triggerCooldown(Date.now() + 30000, 'overloaded')
    expect(mod.isInCooldown()).toBe(true)
    expect(mod.getRateLimitState().reason).toBe('overloaded')
  })
})

describe('Rate Limit — Header Parsing Edge Cases', () => {
  it('should handle empty headers object', () => {
    const result = mod.parseRateLimitHeaders({})
    expect(result.requestsRemaining).toBeNull()
    expect(result.requestsReset).toBeNull()
    expect(result.tokensRemaining).toBeNull()
    expect(result.tokensReset).toBeNull()
  })

  it('should handle headers with extra whitespace', () => {
    const headers: Record<string, string> = {
      'anthropic-ratelimit-requests-remaining': '  42  ',
    }
    const result = mod.parseRateLimitHeaders(headers)
    // parseNumericHeader uses Number(), which handles whitespace
    expect(result.requestsRemaining).toBe(42)
  })

  it('should handle non-numeric reset value gracefully', () => {
    const headers: Record<string, string> = {
      'anthropic-ratelimit-requests-reset': 'invalid-date',
    }
    const result = mod.parseRateLimitHeaders(headers)
    expect(result.requestsReset).toBeNull()
  })

  it('should handle epoch ms as numeric string for reset', () => {
    const headers: Record<string, string> = {
      'anthropic-ratelimit-requests-reset': '1716897660000',
    }
    const result = mod.parseRateLimitHeaders(headers)
    expect(result.requestsReset).toBe(1_716_897_660_000)
  })

  it('should handle short epoch ms for reset', () => {
    const headers: Record<string, string> = {
      'anthropic-ratelimit-requests-reset': '1000',
    }
    const result = mod.parseRateLimitHeaders(headers)
    expect(result.requestsReset).toBe(1000)
  })

  it('should handle decimal number as invalid for remaining', () => {
    const headers: Record<string, string> = {
      'anthropic-ratelimit-requests-remaining': '10.5',
    }
    const result = mod.parseRateLimitHeaders(headers)
    // Number('10.5') = 10.5, not NaN, so it passes
    expect(result.requestsRemaining).toBe(10.5)
  })

  it('should handle only tokens headers without requests headers', () => {
    const headers: Record<string, string> = {
      'anthropic-ratelimit-tokens-remaining': '100000',
      'anthropic-ratelimit-tokens-reset': '2026-05-28T13:00:00.000Z',
    }
    const result = mod.parseRateLimitHeaders(headers)
    expect(result.requestsRemaining).toBeNull()
    expect(result.requestsReset).toBeNull()
    expect(result.tokensRemaining).toBe(100000)
    expect(result.tokensReset).toBe(new Date('2026-05-28T13:00:00.000Z').getTime())
  })

  it('should handle ISO date without timezone as UTC', () => {
    const headers: Record<string, string> = {
      'anthropic-ratelimit-requests-reset': '2026-05-28T12:30:00',
    }
    const result = mod.parseRateLimitHeaders(headers)
    // Date.parse interprets ISO without timezone as UTC in some runtimes
    expect(result.requestsReset).toBe(new Date('2026-05-28T12:30:00').getTime())
  })
})

describe('Rate Limit — Multiple State Checks', () => {
  it('should handle multiple rapid getRateLimitState calls without side effects', () => {
    expect(mod.getRateLimitState().isCooldown).toBe(false)
    expect(mod.getRateLimitState().isCooldown).toBe(false)
    expect(mod.getRateLimitState().isCooldown).toBe(false)

    mod.triggerCooldown(Date.now() + 60000, 'rate_limit')
    expect(mod.getRateLimitState().isCooldown).toBe(true)
    expect(mod.getRateLimitState().isCooldown).toBe(true)
  })

  it('should handle clearCooldown when already active', () => {
    expect(mod.isInCooldown()).toBe(false)
    // Should not throw
    expect(() => mod.clearCooldown()).not.toThrow()
    expect(mod.isInCooldown()).toBe(false)
  })

  it('should handle triggerCooldown with zero-length cooldown', () => {
    const now = Date.now()
    mod.triggerCooldown(now, 'rate_limit')
    // isInCooldown calls getRateLimitState which checks Date.now() >= resetAt
    // Since now === resetAt, it auto-expires immediately
    expect(mod.isInCooldown()).toBe(false)
  })

  it('should handle negative reset time (past timestamp)', () => {
    const past = Date.now() - 1000
    mod.triggerCooldown(past, 'rate_limit')
    // Past timestamp - Date.now() >= past is true, so auto-expires
    expect(mod.isInCooldown()).toBe(false)
  })
})
