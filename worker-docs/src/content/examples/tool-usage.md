# 工具调用

让 AI 自动调用工具完成任务的完整示例。SDK 内置 8 个工具，开箱即用。

## 读取文件并分析

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

  // AI 会自动调用 FileReadTool + 分析
  const response = await sdk.send('读取 package.json，告诉我这个项目用了哪些依赖')
  console.log('AI:', response.content)
}

main()
```

**输出示例：**

```
AI: 这个项目使用了以下依赖：

主要依赖：
- claude-code-sdk-ts：SDK 核心库
- zod：运行时数据验证
- ...（其他依赖）

AI 在回答前自动调用了 FileReadTool 来读取 package.json 文件内容。
```

## 执行 Shell 命令

```typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'anthropic',
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: process.env.DEEPSEEK_API_KEY!,
    model: 'deepseek-v4-flash',
  },
  defaultTools: true,
})

async function main() {
  const response = await sdk.send('当前目录磁盘用量是多少？')
  console.log('AI:', response.content)
}

main()
```

**输出示例：**

```
AI: 当前目录磁盘用量如下：

总用量 4.0M
drwxr-xr-x  38 user user  1.2K  node_modules/
-rw-r--r--   1 user user   380  package.json
-rw-r--r--   1 user user   226  tsconfig.json
...

AI 内部调用了 BashTool 来执行 du -sh * 命令。
```

## 搜索代码文件

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
  systemPrompt: 'You have access to file search tools.',
  messages: [{ role: 'user', content: '找到所有包含 "createTool" 的 TypeScript 文件' }],
  tools: registry,
})

console.log(result.text)
```

**输出示例：**

```
找到以下包含 "createTool" 的 TypeScript 文件：

src/tool-creation.ts:     15: export function createTool(name: string)
src/registry.ts:          42: registry.createTool('myTool')
src/built-in/bash.ts:      8: createTool({ name: 'BashTool', ... })
src/built-in/glob.ts:      8: createTool({ name: 'GlobTool', ... })

AI 先调用 GlobTool 查找所有 .ts 文件，再调用 GrepTool 搜索关键词。
```

## 自定义工具

你也可以注册自己的工具：

```typescript
import { ClaudeCodeSDK, ToolRegistry, registerAllBuiltInTools, createTool } from 'claude-code-sdk-ts'
import { z } from 'zod'

// 1. 创建自定义工具
const calculatorTool = createTool({
  name: 'calculator',
  description: '执行数学计算',
  inputSchema: z.object({
    expression: z.string().describe('数学表达式，如 "15% * 47.50"'),
  }),
  execute: async (input) => {
    // 简单的数学计算
    const result = Function(`'use strict'; return (${input.expression})`)()
    return { result: String(result) }
  },
})

// 2. 注册到 SDK
const registry = new ToolRegistry()
registerAllBuiltInTools(registry) // 注册 8 个内置工具
registry.register(calculatorTool) // 注册自定义工具

const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'anthropic',
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: process.env.DEEPSEEK_API_KEY!,
    model: 'deepseek-v4-flash',
  },
  // 传入自定义工具注册表
})

async function main() {
  const response = await sdk.send('账单 $47.50，15% 小费是多少？')
  console.log('AI:', response.content)
}

main()
```

**输出示例：**

```
AI: 15% 的小费是 $7.13。

计算过程：$47.50 \xD7 15% = $47.50 \xD7 0.15 = $7.125 ≈ $7.13
```

## 可用内置工具

| 工具 | 用途 | 安全等级 |
|------|------|----------|
| `BashTool` | 执行 Shell 命令 | ⚠️ 高风险 |
| `FileReadTool` | 读取文件内容 | ✅ 低风险 |
| `FileWriteTool` | 创建/覆盖文件 | ⚠️ 中风险 |
| `FileEditTool` | 精确替换文件内容 | ⚠️ 中风险 |
| `GlobTool` | 搜索文件路径 | ✅ 低风险 |
| `GrepTool` | 搜索文件内容 | ✅ 低风险 |
| `WebFetchTool` | 抓取网页内容 | ✅ 低风险 |
| `WebSearchTool` | 联网搜索 | ✅ 低风险 |

## 下一步

- [工具系统详解](/core-concepts/tool-system) — 深入了解工具注册和执行的完整流程
- [权限系统](/advanced/permission-system) — 控制哪些工具可以执行
- [MCP 集成](/examples/mcp-integration) — 集成外部工具服务器
