# Phase 3B — B1: 高级流式消费 API

> **任务**: B1 — streamToText(), streamToBlocks(), 事件订阅
> **状态**: Design Doc (Superpowers Phase 2)
> **日期**: 2026-05-27
> **项目**: claude-code-sdk v0.3.0 → v0.4.0

---

## 1. 背景

当前 `LLMConnector.send()` 和 `conversationLoop()` 返回 `AsyncIterable<StreamEvent>`，消费方需要自己写 `for await` 循环来解析事件流。高频模式（只拿文本、只拿分块、事件订阅回调）缺乏一等公民 API。

## 2. 设计目标

- **streamToText()**: 丢弃非文本事件，只暴露 `AsyncIterable<string>`，纯文本消费
- **streamToBlocks()**: 将流式事件聚合成完整 block（text block / tool_use block / thinking block），产出 `AsyncIterable<StreamBlock>`
- **事件订阅 (subscribe)**: 提供回调注册机制，按事件类型分发

## 3. API 设计

### 3.1 StreamConsumer 入口

```typescript
// 新建辅助模块: src/streaming/consumer.ts
export class StreamConsumer {
  constructor(private stream: AsyncIterable<StreamEvent>) {}

  /** 只产出文本片段 */
  toTextStream(): AsyncIterable<string>

  /** 将事件聚合成完整的 blocks */
  toBlockStream(): AsyncIterable<StreamBlock>

  /** 注册事件回调 */
  on<K extends StreamEvent['type']>(
    type: K,
    callback: (event: Extract<StreamEvent, { type: K }>) => void
  ): () => void // 返回 unsubscribe 函数

  /** 整体回调 — 每次事件都触发 */
  onEvent(callback: (event: StreamEvent) => void): () => void

  /** 消费整个流到最终结果（便于测试和简单场景） */
  toPromise(): Promise<{
    text: string
    toolUses: ToolUseBlock[]
    usage: TokenUsage
  }>
}
```

### 3.2 顶层便利函数

```typescript
// src/streaming/index.ts
export function streamToText(stream: AsyncIterable<StreamEvent>): AsyncIterable<string>
export function streamToBlocks(stream: AsyncIterable<StreamEvent>): AsyncIterable<StreamBlock>
export function createStreamConsumer(stream: AsyncIterable<StreamEvent>): StreamConsumer
```

### 3.3 StreamBlock 类型

```typescript
// src/streaming/types.ts
export type StreamBlock =
  | TextBlock
  | ToolUseBlock
  | ThinkingBlock

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ToolUseBlock {
  type: 'tool_use'
  id: Snowflake
  name: string
  input: Record<string, unknown>
  result?: string  // tool_use_end 的 output
  isError?: boolean
}

export interface ThinkingBlock {
  type: 'thinking'
  thinking: string
}
```

## 4. 实现策略

### 4.1 streamToText()

```typescript
export async function* streamToText(stream: AsyncIterable<StreamEvent>): AsyncIterable<string> {
  for await (const event of stream) {
    if (event.type === 'text') {
      yield event.text
    }
    // 当遇到 done 或 error 时自然结束
  }
}
```

### 4.2 streamToBlocks()

使用状态机追踪 tool_use 的 start/end：

```typescript
// 内部状态
const pendingToolUses = new Map<string, ToolUseBlock>()

for await (const event of stream) {
  switch (event.type) {
    case 'text':
      yield { type: 'text', text: event.text }
      break
    case 'tool_use_start':
      pendingToolUses.set(event.id, { type: 'tool_use', id: event.id, name: event.name, input: event.input })
      break
    case 'tool_use_end': {
      const block = pendingToolUses.get(event.id)
      if (block) {
        block.result = event.output
        block.isError = event.isError
        pendingToolUses.delete(event.id)
        yield block
      }
      break
    }
    case 'thinking':
      yield { type: 'thinking', thinking: event.thinking }
      break
    // ping, retry, done, error — 不产生 block
  }
}
```

### 4.3 事件订阅

```typescript
export class StreamConsumer {
  // ...
  private handlers = new Map<string, Set<(event: any) => void>>()

  on(type, callback) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set())
    this.handlers.get(type)!.add(callback)
    return () => this.handlers.get(type)?.delete(callback)
  }

  async consume() {
    for await (const event of this.stream) {
      const typeHandlers = this.handlers.get(event.type)
      if (typeHandlers) typeHandlers.forEach(cb => cb(event))
      const allHandlers = this.handlers.get('*')
      if (allHandlers) allHandlers.forEach(cb => cb(event))

      if (event.type === 'error' || event.type === 'done') break
    }
  }
}
```

## 5. 与现有模块的集成

- `src/streaming/` — 新建目录，独立模块
- 依赖 `StreamEvent`（来自 `src/llm/types.ts`）
- 在 `src/index.ts` 中导出：
  ```typescript
  export { streamToText, streamToBlocks, createStreamConsumer } from './streaming/index.js'
  export type { StreamBlock, TextBlock, ToolUseBlock, ThinkingBlock } from './streaming/types.js'
  ```

## 6. 测试策略

| 测试 | 类型 | 说明 |
|:---|:---|:---|
| streamToText 过滤 | 单元 | 混入 text/thinking/ping 事件，验证只产出 text |
| streamToBlocks 聚合 | 单元 | tool_use_start + tool_use_end → 完整 ToolUseBlock |
| 事件订阅 | 单元 | 注册不同类型回调，验证触发次数 |
| 集成 | 集成 | 使用真实 API Key 调用 LLMConnector.send()，通过 consumer 消费 |
| 错误传播 | 单元 | error 事件后流终止 |
| Abort | 单元 | AbortSignal 触发后流终止 |

## 7. 导出清单

```typescript
// src/index.ts 追加
export { streamToText, streamToBlocks, createStreamConsumer } from './streaming/index.js'
export type { StreamBlock, TextBlock, ToolUseBlock, ThinkingBlock } from './streaming/types.js'
```
