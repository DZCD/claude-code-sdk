# 5 分钟快速上手

本教程将带你从零开始完成一个完整的 SDK 使用流程。每个步骤都附带**输入 → 输出**示例。

---

## 1. 初始化项目

```bash
mkdir my-claude-app && cd my-claude-app
npm init -y
npm install claude-code-sdk-ts typescript @types/node
npx tsc --init --target ES2022 --module ESNext --moduleResolution bundler
```

## 2. 设置 API 密钥

SDK 使用 **DeepSeek** 的 Anthropic 兼容接口，配置简单：

```bash
export DEEPSEEK_API_KEY=sk-your-deepseek-api-key-here
```

你也可以在 `.env` 文件中管理（推荐）：

```bash
echo "DEEPSEEK_API_KEY=sk-your-deepseek-api-key-here" > .env
```

## 3. Hello World — 你的第一段对话

创建 `index.ts`：

```typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

async function main() {
  // 初始化 SDK
  const sdk = new ClaudeCodeSDK({
    llm: {
      provider: 'anthropic',                       // DeepSeek 的 Anthropic 兼容接口
      baseUrl: 'https://api.deepseek.com/anthropic',
      apiKey: process.env.DEEPSEEK_API_KEY!,
      model: 'deepseek-v4-flash',
    },
  })

  // 创建会话并发送消息
  const response = await sdk.send('请用一句话解释什么是 SDK')

  console.log('AI:', response.content)
}

main().catch(console.error)
```

运行：

```bash
npx tsx index.ts
```

**输出示例：**

```
AI: SDK（Software Development Kit，软件开发工具包）是一组工具、库和文档的集合，帮助开发者更快地为特定平台或服务构建应用。
```

> 💡 **看到上面的输出了吗？** 从安装到首次对话，只需要 3 步。

## 4. 使用 `ask()` 快速对话

`ask()` 是比 `Session` 更轻量的方式，自动完成一轮对话：

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

const result = await ask(sdk.getLLM(), {
  systemPrompt: 'You are a helpful TypeScript expert.',
  messages: [{ role: 'user', content: 'TypeScript 和 JavaScript 最大的区别是什么？' }],
  tools: registry,
})

console.log(result.text)
```

**输出示例：**

```
TypeScript 和 JavaScript 最大的区别是类型系统。TypeScript 是 JavaScript 的超集，
增加了静态类型检查，能在开发阶段捕捉类型错误，提高代码质量和可维护性。
```

> 💡 **设计思路：`ask()` vs `Session.send()`**
>
> 看到这里你可能会问：什么时候用 `ask()`，什么时候用 `Session`？
> - **`ask()`** — 一次性对话。适合「单轮问答」「快速测试」「简单的工具调用」。内部自动创建一个临时会话，用完即弃，无需管理生命周期。
> - **`Session.send()`** — 多轮对话。适合「需要记忆上下文的聊天」「逐步引导的推理任务」。Session 会累积对话历史，让你能**分多次调用**与 AI 交互。
>
> 简单规则：**一次提问用 ask()，多次对话用 session.send()**。

## 5. 多轮对话 — 上下文自动累积

SDK 的 `Session` 会自动累积对话历史，无需手动管理上下文：

```typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'anthropic',
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: process.env.DEEPSEEK_API_KEY!,
    model: 'deepseek-v4-flash',
  },
  defaultTools: true, // 启用所有内置工具
})

async function chat() {

  const r1 = await sdk.send('我叫小明')
  console.log('AI:', r1.content)
  // AI: 你好小明！很高兴认识你，有什么我可以帮你的吗？

  const r2 = await sdk.send('我叫什么名字？')
  console.log('AI:', r2.content)
  // AI: 你叫小明，刚才你告诉我的 😊
}

chat()
```

> 💡 **关键点**：第二次发送时，Session 自动把第一次的对话历史传给了 AI，所以 AI 记得你的名字。

> 💡 **背后原理：对话历史管理**
>
> 每次调用 `sdk.send()` 时，SDK 自动将本次的「用户消息 + AI 回复」追加到对话历史中，并在下一次请求时全部发送给 LLM。
>
> 这意味着：**对话轮次越多，token 消耗越大**。当对话积累到数万 token 时，SDK 的 [Conversation Manager](/core-concepts/conversation) 会自动启用 **Auto-Compact**（智能压缩早期对话）来节省预算，确保长对话不会因为 token 超限而中断。

## 6. 使用工具 — AI 帮你执行命令

让 AI 自动调用工具来完成任务：

```typescript
import { ClaudeCodeSDK, ask, ToolRegistry, registerAllBuiltInTools } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'anthropic',
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: process.env.DEEPSEEK_API_KEY!,
    model: 'deepseek-v4-flash',
  },
})

const registry = new ToolRegistry()
registerAllBuiltInTools(registry)

const result = await ask(sdk.getLLM(), {
  systemPrompt: 'You have access to shell and file tools.',
  messages: [{ role: 'user', content: '列出当前目录的文件' }],
  tools: registry,
})

console.log(result.text)
```

**输出示例：**

```
当前目录包含以下文件：

├── index.ts
├── package.json
├── tsconfig.json
└── node_modules/
```

> 💡 当 AI 需要执行命令时，SDK 会自动调用 BashTool 来执行 `ls`、`cat` 等命令，并把结果返回给 AI 生成最终回复。

## 下一步

- [核心概念 → SDK 架构概览](/core-concepts/sdk-overview) — 了解 SDK 的内部结构
- [基本对话示例](/examples/basic-chat) — 更多对话模式
- [配置说明](/getting-started/configuration) — 深入了解配置选项
- [GitHub 开源地址](https://github.com/DZCD/claude-code-sdk) — 源码和贡献指南
