/**
 * Phase 3D — E3: Rate Limiting Module 测试
 *
 * 测试覆盖：
 * - Cooldown 状态转换 (active -> cooldown -> active)
 * - Auto-expiry（Date.now() >= resetAt 时自动恢复）
 * - parseRateLimitHeaders 解析 anthropic-ratelimit-* 响应头
 * - 复数 header 场景
 * - 边界情况（空 headers、无效值）
 * - isInCooldown 快捷检查
 * - clearCooldown 手动清除
 * - 多次 triggerCooldown 序列
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 延迟 import 以让 beforeEach 先执行
let mod: typeof import('../cooldown.js')

beforeEach(async () => {
  vi.useFakeTimers()
  // 固定时间: 2026-05-28T12:00:00.000Z
  vi.setSystemTime(new Date('2026-05-28T12:00:00.000Z'))
  // 重新导入以清除模块级状态
  mod = await import('../cooldown.js')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Cooldown 状态管理', () => {
  it('初始状态应为非 cooldown', () => {
    const state = mod.getRateLimitState()
    expect(state.isCooldown).toBe(false)
    expect(state.resetAt).toBeNull()
    expect(state.reason).toBeNull()
  })

  it('isInCooldown 初始应返回 false', () => {
    expect(mod.isInCooldown()).toBe(false)
  })

  it('triggerCooldown 后应进入 cooldown 状态', () => {
    const resetAt = Date.now() + 60_000 // 1分钟后
    mod.triggerCooldown(resetAt, 'rate_limit')

    expect(mod.isInCooldown()).toBe(true)
    const state = mod.getRateLimitState()
    expect(state.isCooldown).toBe(true)
    expect(state.resetAt).toBe(resetAt)
    expect(state.reason).toBe('rate_limit')
  })

  it('triggerCooldown 应支持 overloaded 原因', () => {
    const resetAt = Date.now() + 30_000
    mod.triggerCooldown(resetAt, 'overloaded')

    const state = mod.getRateLimitState()
    expect(state.reason).toBe('overloaded')
  })

  it('clearCooldown 应手动清除 cooldown', () => {
    const resetAt = Date.now() + 60_000
    mod.triggerCooldown(resetAt, 'rate_limit')
    expect(mod.isInCooldown()).toBe(true)

    mod.clearCooldown()
    expect(mod.isInCooldown()).toBe(false)
    const state = mod.getRateLimitState()
    expect(state.isCooldown).toBe(false)
    expect(state.resetAt).toBeNull()
    expect(state.reason).toBeNull()
  })

  it('连续触发两次 cooldown 应覆盖前一次', () => {
    const resetAt1 = Date.now() + 60_000
    mod.triggerCooldown(resetAt1, 'rate_limit')

    const resetAt2 = Date.now() + 120_000
    mod.triggerCooldown(resetAt2, 'overloaded')

    const state = mod.getRateLimitState()
    expect(state.resetAt).toBe(resetAt2)
    expect(state.reason).toBe('overloaded')
  })
})

describe('Cooldown Auto-expiry', () => {
  it('超时后 getRateLimitState 应自动恢复 active', () => {
    const resetAt = Date.now() + 60_000
    mod.triggerCooldown(resetAt, 'rate_limit')
    expect(mod.isInCooldown()).toBe(true)

    // 快进到超过 resetAt
    vi.advanceTimersByTime(61_000)

    const state = mod.getRateLimitState()
    expect(state.isCooldown).toBe(false)
    expect(state.reason).toBeNull()
  })

  it('超时后 isInCooldown 应返回 false', () => {
    const resetAt = Date.now() + 10_000
    mod.triggerCooldown(resetAt, 'rate_limit')

    vi.advanceTimersByTime(11_000)

    expect(mod.isInCooldown()).toBe(false)
  })

  it('刚好在 resetAt 临界点应仍在 cooldown', () => {
    const resetAt = Date.now() + 60_000
    mod.triggerCooldown(resetAt, 'rate_limit')

    // 快进 59 秒，未到 resetAt
    vi.advanceTimersByTime(59_000)

    expect(mod.isInCooldown()).toBe(true)
  })

  it('在 resetAt 精确时刻应已过期 (>=)', () => {
    const resetAt = Date.now() + 60_000
    mod.triggerCooldown(resetAt, 'rate_limit')

    vi.advanceTimersByTime(60_000)

    const state = mod.getRateLimitState()
    expect(state.isCooldown).toBe(false)
  })

  it('cooldown 过期后触发新 cooldown 应正常工作', () => {
    const resetAt1 = Date.now() + 30_000
    mod.triggerCooldown(resetAt1, 'rate_limit')
    vi.advanceTimersByTime(31_000)

    // 已过期
    expect(mod.isInCooldown()).toBe(false)

    // 新 cooldown
    const resetAt2 = Date.now() + 60_000
    mod.triggerCooldown(resetAt2, 'overloaded')
    expect(mod.isInCooldown()).toBe(true)
    expect(mod.getRateLimitState().reason).toBe('overloaded')
  })
})

describe('parseRateLimitHeaders', () => {
  it('应解析完整的 rate limit 响应头', () => {
    const headers: Record<string, string> = {
      'anthropic-ratelimit-requests-remaining': '10',
      'anthropic-ratelimit-requests-reset': '2026-05-28T12:01:00.000Z',
      'anthropic-ratelimit-tokens-remaining': '5000',
      'anthropic-ratelimit-tokens-reset': '2026-05-28T12:05:00.000Z',
    }

    const result = mod.parseRateLimitHeaders(headers)
    expect(result.requestsRemaining).toBe(10)
    expect(result.requestsReset).toBe(new Date('2026-05-28T12:01:00.000Z').getTime())
    expect(result.tokensRemaining).toBe(5000)
    expect(result.tokensReset).toBe(new Date('2026-05-28T12:05:00.000Z').getTime())
  })

  it('应处理大小写不一致的 header 名称', () => {
    const headers: Record<string, string> = {
      'Anthropic-RateLimit-Requests-Remaining': '25',
      'ANTHROPIC-RATELIMIT-REQUESTS-RESET': '2026-05-28T12:02:00.000Z',
    }

    const result = mod.parseRateLimitHeaders(headers)
    expect(result.requestsRemaining).toBe(25)
    expect(result.requestsReset).toBe(new Date('2026-05-28T12:02:00.000Z').getTime())
  })

  it('缺少头时应返回 null', () => {
    const headers: Record<string, string> = {}

    const result = mod.parseRateLimitHeaders(headers)
    expect(result.requestsRemaining).toBeNull()
    expect(result.requestsReset).toBeNull()
    expect(result.tokensRemaining).toBeNull()
    expect(result.tokensReset).toBeNull()
  })

  it('部分头存在时应只解析存在的头', () => {
    const headers: Record<string, string> = {
      'anthropic-ratelimit-requests-remaining': '42',
    }

    const result = mod.parseRateLimitHeaders(headers)
    expect(result.requestsRemaining).toBe(42)
    expect(result.requestsReset).toBeNull()
    expect(result.tokensRemaining).toBeNull()
    expect(result.tokensReset).toBeNull()
  })

  it('应处理含 ms 时间戳的 requests-reset 头', () => {
    const headers: Record<string, string> = {
      'anthropic-ratelimit-requests-reset': '1716897660000',
    }

    const result = mod.parseRateLimitHeaders(headers)
    // 这是一个 Unix 毫秒时间戳
    expect(result.requestsReset).toBe(1_716_897_660_000)
  })

  it('应处理含 ms 时间戳的 tokens-reset 头', () => {
    const headers: Record<string, string> = {
      'anthropic-ratelimit-tokens-reset': '1716897660000',
    }

    const result = mod.parseRateLimitHeaders(headers)
    expect(result.tokensReset).toBe(1_716_897_660_000)
  })

  it('应处理无效 numeric 值返回 null', () => {
    const headers: Record<string, string> = {
      'anthropic-ratelimit-requests-remaining': 'not-a-number',
    }

    const result = mod.parseRateLimitHeaders(headers)
    expect(result.requestsRemaining).toBeNull()
  })

  it('应处理日期格式的 reset 头', () => {
    const headers: Record<string, string> = {
      'anthropic-ratelimit-requests-reset': '2026-05-28T13:00:00.000Z',
    }

    const result = mod.parseRateLimitHeaders(headers)
    expect(result.requestsReset).toBe(new Date('2026-05-28T13:00:00.000Z').getTime())
  })

  it('应处理 ISO 日期含时区偏移的 reset 头', () => {
    const headers: Record<string, string> = {
      'anthropic-ratelimit-requests-reset': '2026-05-28T13:00:00.000+01:00',
      'anthropic-ratelimit-tokens-reset': '2026-05-28T14:00:00.000-05:00',
    }

    const result = mod.parseRateLimitHeaders(headers)
    expect(result.requestsReset).toBe(new Date('2026-05-28T13:00:00.000+01:00').getTime())
    expect(result.tokensReset).toBe(new Date('2026-05-28T14:00:00.000-05:00').getTime())
  })
})

describe('parseRateLimitHeaders 边界情况', () => {
  it('应处理空字符串值', () => {
    const headers: Record<string, string> = {
      'anthropic-ratelimit-requests-remaining': '',
    }

    const result = mod.parseRateLimitHeaders(headers)
    expect(result.requestsRemaining).toBeNull()
  })

  it('应处理零值 remaining', () => {
    const headers: Record<string, string> = {
      'anthropic-ratelimit-requests-remaining': '0',
      'anthropic-ratelimit-tokens-remaining': '0',
    }

    const result = mod.parseRateLimitHeaders(headers)
    expect(result.requestsRemaining).toBe(0)
    expect(result.tokensRemaining).toBe(0)
  })

  it('应处理负数 remaining', () => {
    const headers: Record<string, string> = {
      'anthropic-ratelimit-requests-remaining': '-1',
    }

    const result = mod.parseRateLimitHeaders(headers)
    expect(result.requestsRemaining).toBe(-1)
  })

  it('应处理大数值 remaining', () => {
    const headers: Record<string, string> = {
      'anthropic-ratelimit-requests-remaining': '999999',
      'anthropic-ratelimit-tokens-remaining': '2000000',
    }

    const result = mod.parseRateLimitHeaders(headers)
    expect(result.requestsRemaining).toBe(999_999)
    expect(result.tokensRemaining).toBe(2_000_000)
  })
})
