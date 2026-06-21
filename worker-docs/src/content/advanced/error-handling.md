# 错误处理

SDK 的错误处理和重试机制。

## 重试机制

LLM 请求自动带重试逻辑：

```typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: { provider: 'anthropic', apiKey: process.env.DEEPSEEK_API_KEY! },
    baseUrl: 'https://api.deepseek.com/anthropic',
  global: {
    maxRetries: 3,     // 最大重试次数
    timeout: 120000,   // 请求超时 (ms)
  },
})
```

## 自定义重试

```typescript
import { withRetry } from 'claude-code-sdk-ts/llm'

const result = await withRetry(
  async () => {
    return await apiCall()
  },
  {
    maxRetries: 5,
    signal: abortController.signal,
    onRetry: (event) => {
      console.log(`重试 ${event.attempt}/${event.maxRetries}, 等待 ${event.delayMs}ms`)
    },
  },
)
```

## AbortSignal 取消

```typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

const controller = new AbortController()

// 5 秒后自动取消
setTimeout(() => controller.abort(), 5000)

try {
  const response = await sdk.send('Generate a very long story', {
    signal: controller.signal,
  })
} catch (err) {
  if ((err as Error).name === 'AbortError') {
    console.log('请求被取消')
  }
}
```

## 错误类型

| 错误 | 说明 |
|------|------|
| `APIError` | API 返回错误 |
| `RateLimitError` | 触发速率限制 |
| `TimeoutError` | 请求超时 |
| `PermissionError` | 权限检查未通过 |
| `ConfigError` | 配置验证失败 |
