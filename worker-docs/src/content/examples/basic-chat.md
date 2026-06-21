# 基本对话

最简单的 SDK 使用方式 — 发送消息并获取回复。

## 完整代码

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

async function main() {

  const response = await sdk.send('请用一句话解释什么是 SDK')
  console.log('AI:', response.content)
}

main()
```

**输出：**

```
AI: SDK（Software Development Kit，软件开发工具包）是一组工具、库和文档的集合，
帮助开发者更快地为特定平台或服务构建应用。
```

## 多轮对话 — AI 记住上下文

SDK 的 Session 会自动维护对话历史，AI 能记住之前说过的话：

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

async function chat() {

  // 第一轮：告诉 AI 一些信息
  const r1 = await sdk.send('我叫小明，今年 25 岁')
  console.log('AI:', r1.content)
  // AI: 你好小明！很高兴认识你。25 岁正是做事情的好年纪，有什么我可以帮你的吗？

  // 第二轮：AI 还记得刚才的信息
  const r2 = await sdk.send('我叫什么名字？')
  console.log('AI:', r2.content)
  // AI: 你叫小明，刚才你告诉我的 😊

  // 第三轮：更复杂的追问
  const r3 = await sdk.send('我多大了？')
  console.log('AI:', r3.content)
  // AI: 你今年 25 岁。
}

chat()
```

> 💡 **关键点**：Session 自动把之前的对话历史传给 AI，所以你不需要手动拼接上下文。

## 使用 `ask()` 简化

如果只需要一轮对话，`ask()` 是最简洁的方式：

```typescript
import { ClaudeCodeSDK, ask, ToolRegistry } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'anthropic',
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: process.env.DEEPSEEK_API_KEY!,
    model: 'deepseek-v4-flash',
  },
})

const registry = new ToolRegistry()

const response = await ask(sdk.getLLM(), {
  systemPrompt: 'You are a helpful geography assistant.',
  messages: [{ role: 'user', content: '法国的首都是哪里？' }],
  tools: registry,
})

console.log(response.text)
// 法国的首都是巴黎（Paris）。
```

## 错误处理

如果请求失败，SDK 会自动重试（默认最多 3 次）：

```typescript
import { ClaudeCodeSDK, ask, ToolRegistry } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'anthropic',
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: process.env.DEEPSEEK_API_KEY!,
    model: 'deepseek-v4-flash',
  },
})

const registry2 = new ToolRegistry()

try {
  const response = await ask(sdk.getLLM(), {
    systemPrompt: 'You are a Chinese poet.',
    messages: [{ role: 'user', content: '用中文写一首关于秋天的短诗' }],
    tools: registry2,
  })

  console.log(response.text)
  // 秋风起，落叶黄
  // 天高云淡雁成行
  // 稻香千里丰收季
  // 岁月静好暖心房
} catch (err) {
  console.error('请求失败:', (err as Error).message)
}
```

## 底层机制：流式与非流式的区别

SDK 默认使用**流式（SSE）**传输，无论你调用 `sdk.send()` 还是 `sdk.stream()`。

### SSE（Server-Sent Events）的工作原理

```
用户请求 → SDK → LLM API
                       │
            ┌──────────┴──────────┐
            │  非流式 (一次性)     │   流式 (SSE 逐块推送)
            │                     │
            │ ┌─────────────────┐ │  ┌─ text: "巴黎"
            │ │ content:        │ │  ├─ text: "是"
            │ │ "巴黎是法国的    │ │  ├─ text: "法国的"
            │ │ 首都。"         │ │  ├─ text: "首都。"
            │ └─────────────────┘ │  └─ (完成)
            │  等待 ≈ 2-3 秒      │   首字 ≈ 0.3 秒
            │  然后一次性展示      │   逐字展示，低延迟
```

**什么时候用流式，什么时候用非流式？**

| 场景 | 推荐方式 | 原因 |
|------|---------|------|
| 生成长文本（文章、代码） | `sdk.stream()` 流式 | 用户无需等待全部生成，逐字看到输出 |
| 需要完整结果再处理 | `sdk.send()` + `response.content` | 内部流式聚合，外部拿到完整文本 |
| UI 实时显示 + 需要完整结果 | `sdk.stream()` + `StreamConsumer` | 同时满足实时和聚合需求 |
| 简单一问一答 | `sdk.send()` | 简便，SDK 内部自动管理 |

### Token 消耗与上下文管理

每次对话不仅有**本次的 token 消耗**，还有**历史上下文的累积消耗**：

```
第 1 轮: 发送 50 tokens → 回复 200 tokens → 总计 250
第 2 轮: 发送 50 + 历史 250 = 300 → 回复 200 → 总计 500
第 10 轮: 发送 50 + 历史 4250 = 4300 → ... 
```

当历史过长时，SDK 的 [Conversation Manager](/core-concepts/conversation) 自动执行：
1. **Micro-Compact** — 压缩单条过长的消息（截断代码片段、简化日志）
2. **Auto-Compact** — 将早期对话轮次智能总结为摘要
3. **Token Budget** — 跟踪预算使用百分比，触发自动压缩

## 进阶：自定义模型参数

```typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'anthropic',
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: process.env.DEEPSEEK_API_KEY!,
    model: 'deepseek-v4-flash',
    maxTokens: 4096,        // 控制回复长度
    temperature: 0.3,       // 越低越确定性（0~1）
  },
})
```

## 完整 API 参考

- [Session Engine](/core-concepts/session-engine) — 深入了解 Session
- [Conversation Manager](/core-concepts/conversation) — 对话状态管理
- [错误处理](/advanced/error-handling) — 重试和超时配置
