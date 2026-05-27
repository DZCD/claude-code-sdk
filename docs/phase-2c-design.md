# Phase 2-C: LLM 通信层补齐 — 设计与差距分析

## 1. 差距分析 Summary

### 现状 (Phase 1C)
| 功能 | 状态 |
|---|---|
| 4 个 Provider 连接器 | ✅ 已实现 (Anthropic/Bedrock/Vertex/Foundry) |
| 流式响应 | ✅ 基本实现 (async generator yield) |
| Token 计数 | ⚠️ 部分实现 (Anthropic/Vertex/Foundry 有 API 调用，但有 fallback；Bedrock 仅估算) |
| 错误处理 | ⚠️ 仅 catch → yield error 事件，无 retry |
| 统一重试机制 | ❌ 缺失 |
| 错误恢复 (rate limit/timeout/network) | ❌ 缺失 |
| API 兼容性 (边界输入) | ❌ 缺失 |
| 连接管理 (preconnect/warm-up) | ❌ 缺失 |

### 参考源码对照
参考 `claude-code-source-code/src/services/api/withRetry.ts` (823行) 提供了完整的重试引擎，包含：
- `withRetry()` — 泛型重试 loop (async generator)
- `shouldRetry()` — 错误可重试性判断 (401/403/408/409/429/500+/529/APIConnectionError)
- `getRetryDelay()` — 指数退避 + jitter (base 500ms × 2^(attempt-1))
- `getRetryAfter()` — 解析 retry-after header
- `is529Error()` — 529 及 overloaded_error 检测
- 各 Provider 特有 auth 错误处理 (Bedrock/Vertex)

## 2. 设计方案

### 2.1 新增模块

#### `src/llm/retry.ts` — 统一重试引擎
- `withRetry()`: 泛型 async generator 包装器，将重试逻辑与 API 调用分离
- `shouldRetry(error)`: 根据 error 类型/status code 判断是否应该重试
- `getRetryDelay(attempt, retryAfterHeader)`: 指数退避 + jitter
- `isRetryableError(error)`: 判断是否为可恢复错误
- 重试配置: maxRetries (default 3), baseDelay (default 500ms), maxDelay (default 32s)

#### 错误类型体系 (在 `src/llm/types.ts` 中扩展)
- `RetryableError` — 可重试的临时错误
- `NonRetryableError` — 不可重试的永久错误
- `RateLimitError` — 429 错误
- `OverloadedError` — 529 错误
- `AuthError` — 401/403 认证错误
- `NetworkError` — APIConnectionError
- `ContextOverflowError` — 400 max_tokens 超限

#### `src/llm/error-classifier.ts` — 错误分类器
- 基于 reference `withRetry.ts` 的 `shouldRetry()` 和 `is529Error()`
- 独立于各 Provider 的统一错误处理

#### `src/llm/preconnect.ts` — 连接预热
- 参考 `apiPreconnect.ts`
- 简单的 fetch HEAD 请求预热 TCP+TLS 连接

### 2.2 修改现有文件

#### `src/llm/types.ts` — 扩展 StreamEvent
- 增加 `StreamEvent` 类型 `retry` 事件 (通知调用方正在重试)
- 增加 RetryConfig 接口

#### `src/llm/bedrock.ts` — 集成重试
- `send()` 方法中引入 `withRetry()` 包装
- 记录真实 usage 信息 (目前硬编码为 0)

#### `src/llm/vertex.ts` — 集成重试
- `send()` 方法中引入 `withRetry()` 包装

#### `src/llm/foundry.ts` — 集成重试
- `send()` 方法中引入 `withRetry()` 包装

#### `src/llm/anthropic.ts` — 集成重试
- `send()` 方法中引入 `withRetry()` 包装

### 2.3 新增测试文件
- `src/llm/__tests__/retry.test.ts` — 重试引擎单元测试
- `src/llm/__tests__/error-classifier.test.ts` — 错误分类器测试
- `src/llm/__tests__/preconnect.test.ts` — 连接管理测试

### 2.4 更新现有测试
- `src/llm/__tests__/bedrock.test.ts` — 添加重试场景测试
- `src/llm/__tests__/vertex.test.ts` — 添加重试场景测试
- `src/llm/__tests__/foundry.test.ts` — 添加重试场景测试

## 3. 接口设计

### 3.1 RetryConfig
```typescript
interface RetryConfig {
  maxRetries?: number     // default: 3
  baseDelayMs?: number    // default: 500
  maxDelayMs?: number     // default: 32000
}
```

### 3.2 StreamEvent 扩展
```typescript
// 新增
| { type: 'retry'; attempt: number; delayMs: number; error: string; status?: number }
```

### 3.3 withRetry 签名
```typescript
async function* withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: { maxRetries: number; signal?: AbortSignal },
): AsyncGenerator<{ type: 'retry'; attempt: number; delayMs: number; error: string }, T>
```

## 4. 实现计划 (TDD)

### Wave 1: 基础架构
1. 创建 `src/llm/retry.ts` — 核心重试引擎
2. 创建 `src/llm/__tests__/retry.test.ts` — 重试引擎测试
3. 扩展 `src/llm/types.ts` — 新增 StreamEvent retry 类型和 RetryConfig

### Wave 2: 各 Provider 集成
4. 更新 `src/llm/anthropic.ts` — 集成重试
5. 更新 `src/llm/__tests__/client.test.ts` — 添加重试测试
6. 更新其他 Provider (Bedrock/Vertex/Foundry)

### Wave 3: 连接管理
7. 创建 `src/llm/preconnect.ts` — 连接预热
8. 创建 `src/llm/__tests__/preconnect.test.ts`

## 5. 边界情况处理
- 空 messages 数组 → 不调用 API，直接返回 done
- AbortSignal 在重试等待期间被触发 → 立即中断
- 连续 529 → 指数退避直至 maxDelay
- 自定义 baseURL (gateway/proxy) → 跳过 preconnect
