/**
 * Rate Limiting — Cooldown 状态机
 *
 * 参考 fastMode.ts 的 cooldown 模式：
 * - 状态自动过期（Date.now() >= resetAt 时恢复 active）
 * - 不做令牌桶/队列，保持极简
 *
 * @public
 */

import type { CooldownReason, RateLimitHeaders, RateLimitState } from './types.js'

// --- Internal runtime state ---

type RuntimeState = { status: 'active' } | { status: 'cooldown'; resetAt: number; reason: CooldownReason }

let runtimeState: RuntimeState = { status: 'active' }

// --- Public API ---

/**
 * 获取当前 Rate Limiting 状态。
 * 如果 cooldown 已超时，自动恢复为 active。
 */
export function getRateLimitState(): RateLimitState {
  if (runtimeState.status === 'cooldown' && Date.now() >= runtimeState.resetAt) {
    runtimeState = { status: 'active' }
  }

  if (runtimeState.status === 'active') {
    return { isCooldown: false, resetAt: null, reason: null }
  }

  return {
    isCooldown: true,
    resetAt: runtimeState.resetAt,
    reason: runtimeState.reason,
  }
}

/**
 * 触发 cooldown。
 * @param resetAt - 重置时间戳（epoch ms）
 * @param reason - 触发原因
 */
export function triggerCooldown(resetAt: number, reason: CooldownReason): void {
  runtimeState = { status: 'cooldown', resetAt, reason }
}

/**
 * 快速检查是否在 cooldown 中。
 * 与 getRateLimitState 一样会处理自动过期。
 */
export function isInCooldown(): boolean {
  return getRateLimitState().isCooldown
}

/**
 * 手动清除 cooldown，恢复为 active 状态。
 */
export function clearCooldown(): void {
  runtimeState = { status: 'active' }
}

/**
 * 解析 anthropic-ratelimit-* 响应头。
 *
 * 支持：
 * - anthropic-ratelimit-requests-remaining / tokens-remaining（数字）
 * - anthropic-ratelimit-requests-reset / tokens-reset（ISO 日期或 epoch ms）
 *
 * Header 名称大小写不敏感。
 *
 * @param headers - HTTP 响应头（key-value 形式）
 * @returns 解析后的 RateLimitHeaders
 */
export function parseRateLimitHeaders(headers: Record<string, string>): RateLimitHeaders {
  // 统一转为小写以便大小写不敏感查找
  const lower: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    lower[key.toLowerCase()] = value
  }

  const requestsRemaining = parseNumericHeader(lower['anthropic-ratelimit-requests-remaining'])
  const requestsReset = parseResetHeader(lower['anthropic-ratelimit-requests-reset'])
  const tokensRemaining = parseNumericHeader(lower['anthropic-ratelimit-tokens-remaining'])
  const tokensReset = parseResetHeader(lower['anthropic-ratelimit-tokens-reset'])

  return { requestsRemaining, requestsReset, tokensRemaining, tokensReset }
}

// --- Internal helpers ---

/**
 * 解析数字类型的 header 值。
 * 空字符串或非数字返回 null。
 */
function parseNumericHeader(value: string | undefined): number | null {
  if (value === undefined || value === '') return null
  const num = Number(value)
  return Number.isNaN(num) ? null : num
}

/**
 * 解析时间类型的 header 值。
 * 支持 ISO 日期字符串和 epoch ms 数字字符串。
 */
function parseResetHeader(value: string | undefined): number | null {
  if (value === undefined || value === '') return null

  // 尝试解析为纯数字（epoch ms）
  const num = Number(value)
  if (!Number.isNaN(num) && /^-?\d+$/.test(value)) {
    return num
  }

  // 尝试解析为日期字符串
  const dateMs = Date.parse(value)
  return Number.isNaN(dateMs) ? null : dateMs
}
