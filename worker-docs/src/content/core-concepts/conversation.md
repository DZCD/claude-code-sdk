# Conversation Manager

Conversation Manager 管理多轮对话的状态、Token 预算和自动压缩。

## 核心组件

### TokenTracker
追踪对话的 token 使用情况：

```typescript
import { TokenTracker } from 'claude-code-sdk-ts'

const tracker = new TokenTracker(100000) // 预算 100K tokens
tracker.addUsage({ inputTokens: 1500, outputTokens: 500 })
console.log(tracker.usage) // { inputTokens: 1500, outputTokens: 500 }
console.log(tracker.remaining) // 98000
console.log(tracker.percentage) // 2
```

### CircularBuffer
固定大小的循环缓冲区，用于管理消息历史：

```typescript
import { CircularBuffer } from 'claude-code-sdk-ts'

const buffer = new CircularBuffer(100) // 最多 100 条消息
buffer.push({ role: 'user', content: 'Hello' })
buffer.push({ role: 'assistant', content: 'Hi!' })
console.log(buffer.toArray())
// [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi!' }]
```

### TokenBudget
自动计算并管理 token 预算：

```typescript
import { TokenBudget, parseTokenBudget } from 'claude-code-sdk-ts'

// 解析预算字符串
const budget = parseTokenBudget('100K') // { maxTokens: 100000 }
const budget2 = parseTokenBudget('50%') // 按比例

// 获取预算续言消息
const continuation = getBudgetContinuationMessage(budget)
```

### AutoCompactor
当对话接近 token 预算上限时自动压缩历史：

```typescript
import { AutoCompactor } from 'claude-code-sdk-ts'

const compactor = new AutoCompactor({
  maxTokens: 100000,
  compactThreshold: 0.8,  // 达到 80% 触发压缩
})

// 检查是否需要压缩
if (compactor.shouldCompact(currentTokens)) {
  const summary = await compactor.compact(messages, llmConnector)
  console.log('压缩后摘要:', summary)
}
```

### MicroCompactor
用于更细粒度的消息级压缩：

```typescript
import { MicroCompactor } from 'claude-code-sdk-ts'

const micro = new MicroCompactor({ maxTokens: 80000 })
const compacted = await micro.compactIfNeeded(messages, currentTokens)
```

## ConversationManager 完整示例

```typescript
import { ConversationManager, estimateContextTokens } from 'claude-code-sdk-ts'

const manager = new ConversationManager({
  maxTokens: 100000,
  autoCompact: true,
})

// 添加消息
manager.addMessage('user', 'Hello!')
manager.addMessage('assistant', 'Hi! How can I help?')

// 获取当前上下文的预估 token 数
const tokens = estimateContextTokens(manager.getMessages())
console.log(`当前上下文约 ${tokens} tokens`)
```
