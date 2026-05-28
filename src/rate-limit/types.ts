/**
 * Rate Limiting — 类型定义
 *
 * @public
 */

/** Cooldown 触发原因 */
export type CooldownReason = 'rate_limit' | 'overloaded'

/** Rate Limiting 状态快照 */
export interface RateLimitState {
  /** 是否在 cooldown 中 */
  isCooldown: boolean
  /** cooldown 重置时间（epoch ms），不在 cooldown 时为 null */
  resetAt: number | null
  /** 触发原因，不在 cooldown 时为 null */
  reason: CooldownReason | null
}

/** 解析后的 anthropic-ratelimit-* 响应头 */
export interface RateLimitHeaders {
  /** anthropic-ratelimit-requests-remaining */
  requestsRemaining: number | null
  /** anthropic-ratelimit-requests-reset (epoch ms) */
  requestsReset: number | null
  /** anthropic-ratelimit-tokens-remaining */
  tokensRemaining: number | null
  /** anthropic-ratelimit-tokens-reset (epoch ms) */
  tokensReset: number | null
}
