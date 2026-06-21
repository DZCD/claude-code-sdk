# Session Engine

Session Engine 是 SDK 的核心会话管理模块，负责管理独立的对话会话。

## 基本使用

```typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'anthropic',
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: process.env.DEEPSEEK_API_KEY!,
    model: 'deepseek-v4-flash',
  },
})

// 创建会话

// 发送消息
const response = await sdk.send('What is TypeScript?')
console.log(response.content)

// 继续对话（上下文自动累积）
const followUp = await sdk.send('What about generics?')
console.log(followUp.content)
```

## 会话配置

```typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: { /* ... */ },
  session: {
    maxTurns: 100,           // 最大对话轮次
    timeout: 300000,         // 会话超时 (5min)
    idleTimeout: 60000,      // 空闲超时 (1min)
    autoSave: true,          // 自动保存
    autoSaveInterval: 30000, // 自动保存间隔
    storageDir: './sessions',// 存储目录
  },
})
```

## 会话持久化

```typescript
import { SessionPersistence } from 'claude-code-sdk-ts'

// 列出所有保存的会话
const sessions = await SessionPersistence.list('./sessions')
console.log(sessions)
// [{ id: 'abc123', createdAt: '2024-...', messageCount: 5 }]

// 恢复会话
const session = await SessionPersistence.restore('./sessions/abc123.json', sdk)
const response = await sdk.send('Continue from where we left off')
```

## 归因 (Attribution)

归因组件追踪每个消息的来源，便于审计和调试：

```typescript
const snapshots = session.getAttributionSnapshots()
snapshots.forEach(s => {
  console.log(`Turn ${s.turn}: ${s.mode} (${s.sources.join(', ')})`)
})
```
