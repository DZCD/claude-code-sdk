# 速率限制

SDK 内置的速率限制和冷却（cooldown）机制。

## Cooldown 机制

SDK 不会自己实现令牌桶限流，但会解析 API 返回的速率限制响应头并进入冷却状态：

```typescript
import { isInCooldown, getRateLimitState } from 'claude-code-sdk-ts'

// 检查是否在冷却中
if (isInCooldown()) {
  const state = getRateLimitState()
  console.log(`冷却中，原因: ${state.reason}, 重置时间: ${new Date(state.resetAt!).toISOString()}`)
}
```

## 冷却状态管理

```typescript
import { triggerCooldown, clearCooldown, getRateLimitState } from 'claude-code-sdk-ts'

// 手动触发冷却
triggerCooldown(Date.now() + 60000, 'rate_limit')

// 获取当前状态
const state = getRateLimitState()
console.log(state.isCooldown) // true

// 手动清除冷却
clearCooldown()

// 冷却会自动过期（当 Date.now() >= resetAt）
```

## Rate Limit Header 解析

```typescript
import { parseRateLimitHeaders } from 'claude-code-sdk-ts'

const headers = {
  'anthropic-ratelimit-requests-remaining': '10',
  'anthropic-ratelimit-requests-reset': '2026-05-28T15:00:00Z',
  'anthropic-ratelimit-tokens-remaining': '50000',
  'anthropic-ratelimit-tokens-reset': '1716890400000',
}

const parsed = parseRateLimitHeaders(headers)
console.log(parsed.requestsRemaining) // 10
console.log(parsed.tokensReset)       // 1716890400000 (epoch ms)
```

## 集成到 LLM 请求

速率限制的冷却状态会自动与 LLM Client 的 `withRetry` 集成，在收到 429 响应时自动触发冷却。

## 配置

```typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: { provider: 'anthropic', apiKey: process.env.DEEPSEEK_API_KEY! },
    baseUrl: 'https://api.deepseek.com/anthropic',
  rateLimit: {
    enabled: true,  // 启用速率限制跟踪
  },
})
```
