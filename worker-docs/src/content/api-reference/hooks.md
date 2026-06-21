# Hook 系统

事件钩子系统，允许在工具调用和 LLM 请求前后插入自定义逻辑。

## HookSystem

```typescript
import { HookSystem } from 'claude-code-sdk-ts'

const hooks = new HookSystem()
```

## 钩子类型

| 阶段 | 触发时机 | 回调签名 |
|------|----------|---------|
| `preTool` | 工具执行前 | `(name, input) => { allowed: boolean }` |
| `postTool` | 工具执行后 | `(name, input, output) => void` |
| `preTurn` | LLM 请求前 | `(messages) => { modified: boolean, messages }` |
| `postTurn` | LLM 请求后 | `(messages, response) => void` |

## 注册钩子

### PreTool — 工具执行前

```typescript
hooks.register('preTool', 'audit', async (name, input) => {
  console.log(`[审计] 工具 ${name} 被调用`)
  return { allowed: true } // 允许执行
})

// 拒绝执行
hooks.register('preTool', 'block-dangerous', async (name, input) => {
  if (name === 'BashTool' && input.command?.includes('rm -rf')) {
    return { allowed: false, reason: '禁止的危险命令' }
  }
  return { allowed: true }
})
```

### PostTool — 工具执行后

```typescript
hooks.register('postTool', 'log-results', async (name, input, output) => {
  console.log(`工具 ${name} 执行完成，输出:`, output)
})
```

### PreTurn — LLM 请求前

```typescript
hooks.register('preTurn', 'inject-context', async (messages) => {
  return {
    modified: true,
    messages: [
      { role: 'system', content: '当前时间: ' + new Date().toISOString() },
      ...messages,
    ],
  }
})
```

### PostTurn — LLM 请求后

```typescript
hooks.register('postTurn', 'track-cost', async (messages, response) => {
  console.log(`Token 用量: ${response.usage?.inputTokens} in / ${response.usage?.outputTokens} out`)
})
```

## 管理钩子

```typescript
// 取消注册
hooks.unregister('preTool', 'audit')

// 获取摘要
const summary = hooks.getSummary()
// [{ phase: 'preTool', name: 'audit' }, ...]

// 清空所有钩子
hooks.clear()
```

## 完整示例

```typescript
import { ClaudeCodeSDK, HookSystem } from 'claude-code-sdk-ts'

const hooks = new HookSystem()

// 审计日志
hooks.register('preTool', 'audit', async (name, input) => {
  console.log(`[${new Date().toISOString()}] ${name}(${JSON.stringify(input)})`)
  return { allowed: true }
})

// 创建 SDK 时传入 HookSystem
const sdk = new ClaudeCodeSDK({
  llm: { provider: 'anthropic', apiKey: process.env.DEEPSEEK_API_KEY! },
    baseUrl: 'https://api.deepseek.com/anthropic',
  // HookSystem 会自动集成
})
```
