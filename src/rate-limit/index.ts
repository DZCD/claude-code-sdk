/**
 * Rate Limiting — Module Index
 *
 * Cooldown 状态机和 Rate Limit 响应头解析。
 *
 * @public
 */

export {
  clearCooldown,
  getRateLimitState,
  isInCooldown,
  parseRateLimitHeaders,
  triggerCooldown,
} from './cooldown.js'
export type { CooldownReason, RateLimitHeaders, RateLimitState } from './types.js'
