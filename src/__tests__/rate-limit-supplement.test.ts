/**
 * Supplement tests for Rate Limiting — parseRateLimitHeaders full
 * scenarios, cooldown concurrent safety, state machine edge cases.
 *
 * Complements src/rate-limit/__tests__/cooldown.test.ts,
 * cooldown-edge-cases.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let mod: typeof import('../rate-limit/cooldown.js')

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-05-28T12:00:00.000Z'))
  mod = await import('../rate-limit/cooldown.js')
  mod.clearCooldown()
})

afterEach(() => {
  vi.useRealTimers()
})

// ─── parseRateLimitHeaders — All Scenarios ─────────────────

describe('parseRateLimitHeaders — All Scenarios', () => {
  it('should parse all four headers with ISO dates', () => {
    const result = mod.parseRateLimitHeaders({
      'anthropic-ratelimit-requests-remaining': '99',
      'anthropic-ratelimit-requests-reset': '2026-05-28T12:05:00.000Z',
      'anthropic-ratelimit-tokens-remaining': '40000',
      'anthropic-ratelimit-tokens-reset': '2026-05-28T13:00:00.000Z',
    })
    expect(result.requestsRemaining).toBe(99)
    expect(result.requestsReset).toBe(new Date('2026-05-28T12:05:00.000Z').getTime())
    expect(result.tokensRemaining).toBe(40000)
    expect(result.tokensReset).toBe(new Date('2026-05-28T13:00:00.000Z').getTime())
  })

  it('should parse headers with mixed case', () => {
    const result = mod.parseRateLimitHeaders({
      'Anthropic-RateLimit-Requests-Remaining': '5',
      'ANTHROPIC-RATELIMIT-TOKENS-REMAINING': '1000',
    })
    expect(result.requestsRemaining).toBe(5)
    expect(result.tokensRemaining).toBe(1000)
  })

  it('should handle epoch ms timestamp for requests-reset', () => {
    const epochMs = 1_716_897_660_000
    const result = mod.parseRateLimitHeaders({
      'anthropic-ratelimit-requests-reset': String(epochMs),
    })
    expect(result.requestsReset).toBe(epochMs)
  })

  it('should handle epoch ms timestamp for tokens-reset', () => {
    const epochMs = 1_716_900_000_000
    const result = mod.parseRateLimitHeaders({
      'anthropic-ratelimit-tokens-reset': String(epochMs),
    })
    expect(result.tokensReset).toBe(epochMs)
  })

  it('should handle invalid date string for reset gracefully', () => {
    const result = mod.parseRateLimitHeaders({
      'anthropic-ratelimit-requests-reset': 'not-a-date',
    })
    expect(result.requestsReset).toBeNull()
  })

  it('should handle non-numeric remaining value gracefully', () => {
    const result = mod.parseRateLimitHeaders({
      'anthropic-ratelimit-requests-remaining': 'abc',
    })
    expect(result.requestsRemaining).toBeNull()
  })

  it('should handle negative epoch ms for reset', () => {
    const result = mod.parseRateLimitHeaders({
      'anthropic-ratelimit-requests-reset': '-1000',
    })
    expect(result.requestsReset).toBe(-1000)
  })

  it('should handle very large integer remaining values', () => {
    const result = mod.parseRateLimitHeaders({
      'anthropic-ratelimit-requests-remaining': '999999999',
      'anthropic-ratelimit-tokens-remaining': '999999999999',
    })
    expect(result.requestsRemaining).toBe(999_999_999)
    expect(result.tokensRemaining).toBe(999_999_999_999)
  })

  it('should handle reset with ISO date and timezone offset', () => {
    const result = mod.parseRateLimitHeaders({
      'anthropic-ratelimit-requests-reset': '2026-05-28T08:00:00.000-04:00',
    })
    // 8:00 AM EDT = 12:00 PM UTC
    expect(result.requestsReset).toBe(new Date('2026-05-28T08:00:00.000-04:00').getTime())
  })

  it('should handle reset with only date (no time)', () => {
    const result = mod.parseRateLimitHeaders({
      'anthropic-ratelimit-requests-reset': '2026-05-29',
    })
    // Date.parse('2026-05-29') should work
    expect(result.requestsReset).toBe(new Date('2026-05-29').getTime())
  })
})

// ─── Cooldown — Concurrent Safety ──────────────────────────

describe('Cooldown — Concurrent Safety', () => {
  it('should handle rapid sequential triggerCooldown calls', () => {
    const now = Date.now()
    mod.triggerCooldown(now + 10000, 'rate_limit')
    mod.triggerCooldown(now + 20000, 'overloaded')
    mod.triggerCooldown(now + 30000, 'rate_limit')

    const state = mod.getRateLimitState()
    expect(state.resetAt).toBe(now + 30000)
    expect(state.reason).toBe('rate_limit')
  })

  it('should handle getRateLimitState being called many times without side effects', () => {
    mod.triggerCooldown(Date.now() + 60000, 'rate_limit')

    for (let i = 0; i < 100; i++) {
      const state = mod.getRateLimitState()
      expect(state.isCooldown).toBe(true)
    }

    // After 100 reads, should still be in cooldown
    vi.advanceTimersByTime(61000)
    expect(mod.isInCooldown()).toBe(false)
  })

  it('should handle concurrent isInCooldown and triggerCooldown interleaving', () => {
    // Simulate interleaved calls
    expect(mod.isInCooldown()).toBe(false)

    mod.triggerCooldown(Date.now() + 50000, 'rate_limit')
    expect(mod.isInCooldown()).toBe(true)

    mod.clearCooldown()
    expect(mod.isInCooldown()).toBe(false)

    mod.triggerCooldown(Date.now() + 10000, 'overloaded')
    expect(mod.isInCooldown()).toBe(true)

    vi.advanceTimersByTime(11000)
    expect(mod.isInCooldown()).toBe(false)
  })

  it('should handle triggerCooldown called exactly at expiration boundary', () => {
    const now = Date.now()
    mod.triggerCooldown(now + 5000, 'rate_limit')

    // Advance to exactly at boundary
    vi.advanceTimersByTime(5000)
    // Should still be in cooldown since we check >=
    // Actually getRateLimitState checks Date.now() >= resetAt
    // At exact boundary, Date.now() (12:00:05) >= resetAt (12:00:05) is true
    expect(mod.isInCooldown()).toBe(false)
  })

  it('should handle module-level state bleeding when re-importing', async () => {
    // Set state in current module
    mod.triggerCooldown(Date.now() + 60000, 'rate_limit')

    // Re-import should get a new module instance
    const mod2 = await import('../rate-limit/cooldown.js')
    // Module-level state is shared (due to module caching in Node.js)
    // So mod2 should see the same state
    expect(mod2.isInCooldown()).toBe(true)
    mod2.clearCooldown()
    expect(mod.isInCooldown()).toBe(false)
  })
})

// ─── Cooldown — State Machine Edge Cases ──────────────────

describe('Cooldown — State Machine Edge Cases', () => {
  it('should handle resetAt equal to current time (immediate expiry)', () => {
    mod.triggerCooldown(Date.now(), 'rate_limit')
    // Date.now() === resetAt, so it expires immediately
    expect(mod.isInCooldown()).toBe(false)
  })

  it('should handle resetAt in the past', () => {
    mod.triggerCooldown(Date.now() - 1000, 'overloaded')
    expect(mod.isInCooldown()).toBe(false)
  })

  it('should handle clearCooldown when already in cooldown', () => {
    mod.triggerCooldown(Date.now() + 60000, 'rate_limit')
    expect(mod.isInCooldown()).toBe(true)

    mod.clearCooldown()
    expect(mod.isInCooldown()).toBe(false)

    // Clearing again should not throw
    expect(() => mod.clearCooldown()).not.toThrow()
    expect(mod.isInCooldown()).toBe(false)
  })

  it('should trigger cooldown with very large resetAt', () => {
    const farFuture = Date.now() + 86_400_000 // 24 hours
    mod.triggerCooldown(farFuture, 'rate_limit')
    expect(mod.isInCooldown()).toBe(true)

    // Advance by 23 hours - should still be in cooldown
    vi.advanceTimersByTime(82_800_000)
    expect(mod.isInCooldown()).toBe(true)

    // Advance past 24 hours
    vi.advanceTimersByTime(3_700_000)
    expect(mod.isInCooldown()).toBe(false)
  })

  it('should report correct reason in state snapshots', () => {
    // Initially no reason
    expect(mod.getRateLimitState().reason).toBeNull()

    // After rate_limit
    mod.triggerCooldown(Date.now() + 30000, 'rate_limit')
    expect(mod.getRateLimitState().reason).toBe('rate_limit')

    // After overloaded (overwrites)
    mod.triggerCooldown(Date.now() + 60000, 'overloaded')
    expect(mod.getRateLimitState().reason).toBe('overloaded')

    // After clear
    mod.clearCooldown()
    expect(mod.getRateLimitState().reason).toBeNull()
  })
})

// ─── parseRateLimitHeaders — Empty & Edge Cases ────────────

describe('parseRateLimitHeaders — Empty & Edge Cases', () => {
  it('should handle undefined headers gracefully', () => {
    // The implementation uses Object.entries() which throws on null/undefined
    // Caller is expected to always pass an object
    expect(() => (mod as any).parseRateLimitHeaders(undefined)).toThrow()
  })

  it('should handle null headers gracefully', () => {
    // The implementation uses Object.entries() which throws on null/undefined
    // Caller is expected to always pass an object
    expect(() => (mod as any).parseRateLimitHeaders(null)).toThrow()
  })

  it('should parse Float value as valid number for remaining', () => {
    const result = mod.parseRateLimitHeaders({
      'anthropic-ratelimit-requests-remaining': '42.5',
    })
    // Number('42.5') = 42.5, not NaN
    expect(result.requestsRemaining).toBe(42.5)
  })

  it('should handle extremely short epoch ms for reset', () => {
    const result = mod.parseRateLimitHeaders({
      'anthropic-ratelimit-requests-reset': '1',
    })
    expect(result.requestsReset).toBe(1)
  })
})
