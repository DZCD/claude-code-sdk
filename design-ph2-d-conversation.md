# Phase 2-D 对话管理补齐 — 设计文档

## 1. 现状分析

当前 `ConversationManager` (manager.ts, 79 行) 功能极简：
- 基本消息收发 (send/getHistory/reset)
- 简单的 token 使用累加 (inputTokens + outputTokens)
- 无压缩、无预算跟踪、无上下文窗口感知

参考源码 (src/utils/tokens.ts 265 行, tokenBudget.ts 74 行, CircularBuffer.ts 85 行, conversationRecovery.ts 601 行) 提供了完整的参考实现。

## 2. 补齐方案

### 2.1 新增文件结构

```
src/conversation/
├── index.ts              # 导出更新（新增导出）
├── manager.ts            # 扩展 — 集成压缩和 Token 追踪
├── loop.ts               # 不变
├── token-tracker.ts      # [NEW] Token 追踪与估算
├── token-budget.ts       # [NEW] Token 预算解析与跟踪
├── auto-compact.ts       # [NEW] 自动上下文压缩
├── micro-compact.ts      # [NEW] 微观消息压缩
└── circular-buffer.ts    # [NEW] 环形缓冲区
```

### 2.2 Token Tracker (token-tracker.ts)

**核心职责**: 从消息中提取 token 使用数据，估算上下文窗口大小。

**接口设计**:

```typescript
// 从 assistant 消息中提取 usage 数据
export function getTokenUsageFromMessage(msg: Message): TokenUsage | undefined

// 从 usage 计算总上下文 token 数（含 cache）
export function getTotalTokensFromUsage(usage: TokenUsage): number

// 从最后一条 API 响应获取上下文窗口大小
export function getContextSizeFromLastResponse(messages: Message[]): number

// 获取仅 output_tokens
export function getOutputTokensFromLastResponse(messages: Message[]): number

// 获取当前 usage（从消息数组中查找最新的 usage-bearing message）
export function getCurrentUsage(messages: Message[]): TokenUsage | null

// [核心] 带估算的上下文 token 数 — 用于阈值比较（auto-compact, session memory）
export function estimateContextTokens(messages: Message[]): number

// TokenTracker 类 — 管理运行中的 token 统计
export class TokenTracker {
  // 更新 usage（从 done event 或 assistant msg）
  updateFromUsage(usage: TokenUsage): void
  // 估算当前上下文窗口大小
  estimateContextSize(messages: Message[]): number
  // 获取累计 usage
  getAccumulatedUsage(): TokenUsage
  // 重置
  reset(): void
}
```

**参考对照**: `tokens.ts` L1-L265 — `getTokenUsage`, `getTokenCountFromUsage`, `tokenCountFromLastAPIResponse`, `tokenCountWithEstimation`, `getCurrentUsage`, `getAssistantMessageContentLength`

**SDK 简化**: 由于 SDK 不依赖 Anthropic SDK 的 BetaUsage 类型，使用已有的 `TokenUsage` 类型（`{ inputTokens, outputTokens, cacheCreationInputTokens?, cacheReadInputTokens? }`）。

### 2.3 Token Budget (token-budget.ts)

**核心职责**: 从 system prompt 中解析 token 预算指令，跟踪剩余预算。

**接口设计**:

```typescript
// 从文本中解析 token 预算（如 "+500k", "use 2M tokens"）
export function parseTokenBudget(text: string): number | null

// TokenBudget 类 — 跟踪和管理 token 预算
export class TokenBudget {
  constructor(budget: number, contextWindowSize?: number)
  
  // 获取当前剩余预算
  get remaining(): number
  
  // 记录一次 token 消耗
  recordUsage(usage: { inputTokens: number; outputTokens: number }): void
  
  // 检查是否超过阈值 (如 80%)
  isAboveThreshold(thresholdPct: number): boolean
  
  // 生成预算续期消息
  getContinuationMessage(pct: number, turnTokens: number): string
  
  // 重置
  reset(): void
}
```

**参考对照**: `tokenBudget.ts` L1-L74 — `parseTokenBudget`, `findTokenBudgetPositions`, `getBudgetContinuationMessage`

### 2.4 Circular Buffer (circular-buffer.ts)

**核心职责**: 固定大小的环形缓冲区，用于保持滑动窗口消息。

**接口设计**:

```typescript
export class CircularBuffer<T> {
  constructor(capacity: number)
  add(item: T): void
  addAll(items: T[]): void
  getRecent(count: number): T[]
  toArray(): T[]
  clear(): void
  get length(): number
}
```

**参考对照**: `CircularBuffer.ts` L1-L85 — 完全相同的实现。

### 2.5 Auto-Compact (auto-compact.ts)

**核心职责**: 当上下文窗口接近限制时自动压缩历史。

**策略**:
1. **检查阈值**: 每个 send 前检查 `estimateContextTokens(messages)` 是否超过阈值 (默认 80%)
2. **选择压缩目标**: 从最早的 messages 开始，保留最新的 N 条消息完整
3. **生成摘要**: 使用 LLM 生成早期对话的摘要（需要 LLM connector）
4. **替换**: 将选中的消息替换为一条 summary 消息

**接口设计**:

```typescript
export interface CompactOptions {
  threshold?: number          // 触发压缩的百分比阈值 (默认 0.8)
  keepRecentMessages?: number // 保留的最新消息数量 (默认 10)
  maxCompactTokens?: number   // 压缩输出最大 token 数 (默认 20000)
  contextWindowSize?: number  // 上下文窗口大小
}

export interface CompactResult {
  compacted: boolean          // 是否执行了压缩
  originalCount: number       // 压缩前的消息数
  finalCount: number          // 压缩后的消息数
  summary?: string            // 生成的摘要
}

export class AutoCompactor {
  constructor(options?: CompactOptions)
  
  // 检查是否需要压缩
  needsCompact(messages: Message[], contextSize: number): boolean
  
  // 执行压缩（仅标记，实际摘要需要外部 LLM）
  async compact(
    messages: Message[],
    llm: { summarize(messages: Message[]): Promise<string> } | null
  ): Promise<CompactResult>
  
  // 获取压缩候选消息
  getCompactCandidates(messages: Message[]): Message[]
}
```

**参考对照**: `context.ts` L1-L144 — `getContextWindowForModel`, `calculateContextPercentages`, `COMPACT_MAX_OUTPUT_TOKENS`; `conversationRecovery.ts` — 压缩后的恢复逻辑

### 2.6 Micro-Compact (micro-compact.ts)

**核心职责**: 单条消息级别的微观压缩。

**策略**:
1. **截断**: 超长消息 (>4000 chars) 截断到指定长度，尾部加 "...[truncated]"
2. **合并**: 相邻的 user 文本消息合并为一条
3. **工具结果裁剪**: 大型工具结果裁剪到最大长度

**接口设计**:

```typescript
export interface MicroCompactOptions {
  maxMessageLength?: number     // 单条消息最大字符数 (默认 4000)
  maxToolResultLength?: number  // 工具结果最大字符数 (默认 2000)
  mergeAdjacentUserMessages?: boolean // 是否合并相邻 user 消息 (默认 true)
}

export class MicroCompactor {
  constructor(options?: MicroCompactOptions)
  
  // 对单条消息执行微观压缩
  compactMessage(msg: Message): Message
  
  // 对全部消息执行微观压缩
  compactAll(messages: Message[]): Message[]
  
  // 合并相邻用户消息
  mergeAdjacentUserMessages(messages: Message[]): Message[]
  
  // 截断长消息
  truncateContent(content: string, maxLen: number): string
}
```

### 2.7 ConversationManager 扩展

在现有 `manager.ts` 基础上扩展：

```typescript
export class ConversationManager {
  // ... 现有属性和方法保持不变
  
  // 新增方法
  setCompactOptions(options: CompactOptions): void
  setMicroCompactOptions(options: MicroCompactOptions): void
  setTokenBudget(budget: number): void
  
  // 扩展 send 方法以集成压缩
  async *send(message: string, options?: SendOptions): AsyncIterable<StreamEvent> {
    // 1. 微观压缩（如果启用）
    // 2. 添加用户消息
    // 3. auto-compact 检查（如果需要，触发压缩）
    // 4. 运行 conversation loop
    // 5. 更新 token 追踪
    // 6. yield events
  }
  
  // 新增查询方法
  getEstimatedContextSize(): number
  getRemainingBudget(): number
  getCompactionHistory(): CompactResult[]
}
```

## 3. 测试策略

每个模块独立 TDD 测试：

| 模块 | 测试文件 | 测试数量 |
|------|---------|---------|
| CircularBuffer | conversation/__tests__/circular-buffer.test.ts | ~15 |
| TokenTracker | conversation/__tests__/token-tracker.test.ts | ~12 |
| TokenBudget | conversation/__tests__/token-budget.test.ts | ~10 |
| AutoCompact | conversation/__tests__/auto-compact.test.ts | ~15 |
| MicroCompact | conversation/__tests__/micro-compact.test.ts | ~12 |
| Manager 扩展 | __tests__/conversation-manager.integration.test.ts | ~5 (新增) |

## 4. 实现顺序

1. CircularBuffer (无依赖)
2. Token Tracker (依赖 Message 类型)
3. Token Budget (独立)
4. Micro-Compact (依赖 Message 类型, CircularBuffer)
5. Auto-Compact (依赖 Token Tracker, Token Budget)
6. Manager 扩展 (依赖以上所有)
