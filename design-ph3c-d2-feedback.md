# Phase 3C — D2: Feedback Loop

> **任务**: D2 — Feedback Loop 用户反馈注入机制
> **状态**: Design Doc
> **日期**: 2026-05-27
> **项目**: claude-code-sdk v0.4.0 → v0.5.0

## 1. 背景

当前 `ask()` 执行"思考→调工具→返回结果"的完整循环后即结束。高频场景是：用户看到 LLM 输出或工具执行结果后，想要"修正"或"补充"信息，让 LLM 重新理解和回应。需要一种反馈注入机制，在 LLM 产出后暂停、等待用户修正、然后继续循环。

## 2. 设计目标

- **`feedbackLoop()`**: 类似 `ask()` 但在每轮 LLM 产出后等待反馈注入
- **`FeedbackInjector` 类**: 管理反馈注入逻辑（文本修正、工具结果修正）
- **`onFeedback` 回调**: 在 LLM 产出后暂停，等待外部注入反馈
- **feedbackTimeout**: 超时后自动继续，避免永久阻塞
- **集成到 `ask()`**: 通过 `feedback` 选项控制

## 3. API 设计

### 3.1 反馈模式

```typescript
export type FeedbackMode = 'disabled' | 'manual' | 'auto'
```

### 3.2 反馈输入

```typescript
export interface FeedbackInput {
  /** 文本修正：作为新的 user message 注入到对话历史 */
  text?: string
  /** 工具结果修正：覆盖特定工具调用的执行结果 */
  toolOverrides?: Array<{
    toolUseId: string
    correctedResult: string
  }>
}

export interface FeedbackContext {
  /** 本轮 LLM 产出的文本 */
  text: string
  /** 本轮执行的工具调用记录 */
  toolCalls: Array<{
    id: string
    name: string
    input: Record<string, unknown>
    result: string
    isError?: boolean
  }>
  /** 当前消息历史（只读快照） */
  messages: readonly import('../types/message.js').Message[]
}
```

### 3.3 反馈选项

```typescript
export interface FeedbackOptions {
  /** 反馈模式 */
  mode: FeedbackMode
  /** manual 模式：LLM 产出后调用此回调等待用户反馈 */
  onFeedback?: (context: FeedbackContext) => Promise<FeedbackInput | null | undefined>
  /** 等待反馈的超时时间（ms），默认 30000。超时后自动继续 */
  timeout?: number
}
```

### 3.4 集成到 AskOptions

```typescript
// 在 AskOptions 中追加
feedback?: FeedbackOptions
```

### 3.5 FeedbackInjector 类

```typescript
export class FeedbackInjector {
  constructor(options: FeedbackOptions)

  /** 等待用户反馈（支持超时） */
  async waitForFeedback(context: FeedbackContext): Promise<FeedbackInput | null>

  /** 检查 auto 模式下是否需要自动修正 */
  getAutoFeedback(toolCalls: FeedbackContext['toolCalls']): FeedbackInput | null

  /** 将反馈注入到消息历史 */
  applyFeedback(messages: Message[], input: FeedbackInput): Message[]
}
```

## 4. 实现策略

### 4.1 三种反馈模式

| 模式 | 行为 |
|:---|:---|
| `disabled` | 同标准 `ask()`，无反馈逻辑 |
| `manual` | 每轮 LLM 产出后 → 执行工具 → 调用 `onFeedback` → 等待反馈 → 注入修正 → 继续循环 |
| `auto` | 每轮 LLM 产出后 → 执行工具 → 检查是否有 tool error → 自动注入修正消息 → 继续循环 |

### 4.2 feedbackLoop() 流程

```
feedbackLoop():
  1. 执行一轮 LLM 调用（同 ask）
  2. 执行工具调用（同 ask）
  3. 根据 feedback mode:
     a. disabled → 直接判断是否还有工具调用，继续循环
     b. manual → 调用 onFeedback(context)
        - 返回 FeedbackInput.text → 注入 user message，继续 LLM 调用
        - 返回 FeedbackInput.toolOverrides → 覆盖 tool results，继续 LLM 调用
        - 返回 null/undefined → 继续循环正常逻辑
        - 超时 → 继续循环
     c. auto → 检查 toolCalls 中是否有 isError
        - 有 error → 自动注入修正消息，继续 LLM 调用
        - 无 error → 继续循环正常逻辑
  4. 如果无工具调用且无反馈 → 返回 AskResult
```

### 4.3 与 ask() 的集成

`ask()` 内部检测 `options.feedback`，如果不为 `disabled` 则调用 `feedbackLoop()` 替代标准循环。

```typescript
// ask() 中的变更点
if (params.options?.feedback && params.options.feedback.mode !== 'disabled') {
  return feedbackLoop(llm, params)
}
// 原有的标准逻辑保持不变
```

## 5. 文件清单

| 文件 | 内容 |
|:---|:---|
| `src/feedback/index.ts` | FeedbackInjector 类、类型导出 |
| `src/feedback/feedback-loop.ts` | feedbackLoop() 核心实现 |
| `src/ask/index.ts` | 追加 feedback 选项支持 |
| `src/__tests__/feedback.test.ts` | 单元测试 |

## 6. 测试策略

| 测试 | 描述 |
|:---|:---|
| FeedbackInjector 构造 | 验证默认配置 |
| waitForFeedback 返回 text | manual 模式注入文本修正 |
| waitForFeedback 返回 null | manual 模式无反馈继续 |
| waitForFeedback 超时 | 超时后自动继续 |
| getAutoFeedback 有 error | auto 模式检测到工具错误 |
| getAutoFeedback 无 error | auto 模式正常继续 |
| applyFeedback text | 文本修正注入消息历史 |
| applyFeedback toolOverrides | 工具结果覆盖 |
| feedbackLoop manual 模式 | 完整流程：LLM→工具→反馈→再LLM |
| feedbackLoop auto 模式 | 完整流程：工具错误→自动修正→重试 |
| feedbackLoop disabled 模式 | 同标准 ask() |
