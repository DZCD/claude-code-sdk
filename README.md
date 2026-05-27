# ClaudeCode SDK

> A standalone TypeScript SDK for Claude Code — decoupled from Claude Code runtime.

[![npm version](https://img.shields.io/badge/version-0.1.0--beta.0-blue)](https://github.com/DZCD/claude-code-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-234%20%E2%9C%94%EF%B8%8F-brightgreen)]()

**ClaudeCode SDK** 将 Claude Code 的核心能力封装为独立的 TypeScript 库，**不依赖 Claude Code 运行时**（React / Ink / Bun）。你可以将它集成到任何 Node.js 应用中，直接调用 Claude 的对话、工具执行和 MCP 集成能力。

---

## 特性

- **4 种 LLM Provider** — Anthropic Direct / AWS Bedrock / Google Vertex / Azure Foundry
- **8 个内置工具** — Bash、文件读写编辑、Glob、Grep、WebFetch、WebSearch（DuckDuckGo）
- **MCP 协议集成** — 连接任何 MCP 兼容的工具服务器（stdio / HTTP）
- **流式 + 非流式双 API** — `send()` 和 `stream()` 两种模式
- **权限系统** — auto / manual / plan / bypass 四种模式
- **工具调用循环** — 自动多轮工具调用，最大深度可配置
- **对话管理** — 消息历史、Token 追踪、自动压缩
- **零运行时依赖** — 不依赖 Claude Code 的 React/Ink/Bun 运行时
- **完整 TypeScript 类型** — 所有 API 都有完整类型声明

---

## 安装

```bash
npm install claude-code-sdk
```

### 依赖

- `@anthropic-ai/sdk` — Anthropic Direct API
- `@modelcontextprotocol/sdk` — MCP 协议支持（可选模块）
- `zod` — 工具输入校验

---

## 快速开始

### Anthropic Direct API

```typescript
import { ClaudeCodeSDK, registerAllBuiltInTools } from 'claude-code-sdk'

// 创建 SDK 实例
const sdk = ClaudeCodeSDK.create({
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
})

// 注册内置工具
registerAllBuiltInTools(sdk.getTools())

// 发送消息
const response = await sdk.send('Hello, what can you do?')
console.log(response.content)
```

### 流式响应

```typescript
const stream = sdk.stream('Tell me a story about a cat')
for await (const event of stream) {
  if (event.type === 'text') {
    process.stdout.write(event.text)
  }
}
```

---

## 配置

### 环境变量

| 变量 | 用途 |
|:---|:---|
| `ANTHROPIC_API_KEY` | Anthropic Direct API Key |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | AWS Bedrock 凭证 |
| `AWS_REGION` | Bedrock 区域（默认 `us-east-1`） |
| `GOOGLE_APPLICATION_CREDENTIALS` | Google Vertex 凭据路径 |
| `VERTEX_PROJECT_ID` | Vertex 项目 ID |
| `AZURE_FOUNDRY_API_KEY` | Azure Foundry API Key |
| `AZURE_FOUNDRY_RESOURCE_NAME` | Azure Foundry 资源名 |

### Provider 配置

**Anthropic Direct:**
```typescript
{
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  apiKey: 'sk-ant-...',
  baseUrl?: 'https://api.anthropic.com',  // 可选
}
```

**AWS Bedrock:**
```typescript
{
  provider: 'bedrock',
  model: 'anthropic.claude-sonnet-4-20250514',
  region?: 'us-east-1',
  accessKeyId?: '...',  // 可选，默认从环境变量读取
  secretAccessKey?: '...',  // 可选
}
```

**Google Vertex:**
```typescript
{
  provider: 'vertex',
  model: 'claude-sonnet-4-20250514',
  projectId: 'my-gcp-project',
  region?: 'us-east5',
}
```

**Azure Foundry:**
```typescript
{
  provider: 'foundry',
  model: 'claude-sonnet-4-20250514',
  resourceName: 'my-resource',
  apiKey: '...',
}
```

---

## 内置工具

所有内置工具可通过 `registerAllBuiltInTools()` 一键注册，也可单独使用。

| 工具 | 说明 |
|:---|:---|
| `BashTool` | 执行 Shell 命令 |
| `FileReadTool` | 读取文件（支持文本、PDF、图片、Notebook） |
| `FileWriteTool` | 创建/覆写文件 |
| `FileEditTool` | 字符串替换式编辑 + diff 追踪 |
| `GlobTool` | 文件模式匹配搜索 |
| `GrepTool` | 文件内容正则搜索 |
| `WebFetchTool` | URL 抓取 → Markdown |
| `WebSearchTool` | DuckDuckGo 网页搜索 |

```typescript
import { BashTool, FileReadTool } from 'claude-code-sdk'
sdk.use(new BashTool().toTool(), new FileReadTool().toTool())
```

---

## MCP 协议集成

SDK 支持 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)，可以连接任何 MCP 兼容的工具服务器。

### 配置式集成

```typescript
const sdk = ClaudeCodeSDK.create({
  llm: { provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: '...' },
  mcpServers: [
    {
      name: 'github',
      type: 'url',
      commandOrUrl: 'https://mcp.github.com/',
      authorizationToken: 'ghp_...',
    },
    {
      name: 'local-fs',
      type: 'stdio',
      commandOrUrl: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/project'],
    },
  ],
})
// MCP 工具自动注册，send/stream 时自动可用
```

### 编程式集成

```typescript
const sdk = new ClaudeCodeSDK({ llm: { provider: 'anthropic', ... } })
await sdk.connectMCPServers({
  name: 'my-server',
  type: 'stdio',
  commandOrUrl: 'python',
  args: ['server.py'],
})
```

### MCP Server 配置

| 参数 | 类型 | 说明 |
|:---|:---|:---|
| `name` | `string` | 服务器唯一标识 |
| `type` | `'stdio'` \| `'url'` | 传输类型 |
| `commandOrUrl` | `string` | stdio 命令 或 HTTP URL |
| `args` | `string[]` | stdio 命令参数 |
| `env` | `Record<string, string>` | 环境变量 |
| `authorizationToken` | `string` | 远程服务器鉴权 Token |
| `toolConfiguration` | `object` | 工具过滤配置 |

---

## API 参考

### ClaudeCodeSDK

| 方法 | 说明 |
|:---|:---|
| `ClaudeCodeSDK.create(config)` | 工厂方法创建实例 |
| `sdk.use(...tools)` | 注册工具（链式调用） |
| `sdk.send(message)` | 发送消息，获取完整响应 |
| `sdk.stream(message)` | 发送消息，流式获取事件 |
| `sdk.newConversation()` | 开始新对话 |
| `sdk.getHistory()` | 获取对话历史 |
| `sdk.getTokenUsage()` | 获取 Token 用量 |
| `sdk.withPermissionMode(mode)` | 设置权限模式 |
| `sdk.connectMCPServers(...servers)` | 编程式连接 MCP 服务器 |
| `sdk.disconnectMCPServers()` | 断开所有 MCP 连接 |
| `sdk.getMCPConnections()` | 获取 MCP 连接信息 |

### ToolRegistry

| 方法 | 说明 |
|:---|:---|
| `registry.register(...tools)` | 注册一个或多个工具 |
| `registry.get(name)` | 按名称获取工具 |
| `registry.has(name)` | 检查工具是否已注册 |
| `registry.listTools()` | 列出所有已注册工具 |
| `registry.execute(name, input)` | 执行指定工具 |

---

## 开发

```bash
# 克隆
git clone https://github.com/DZCD/claude-code-sdk.git
cd claude-code-sdk

# 安装依赖
npm install

# 构建
npm run build

# 测试
npm test

# 类型检查
npm run type-check
```

### 项目结构

```
src/
├── config/          # 配置管理（多源合并、环境变量）
├── context/         # 上下文构建（Git 状态、CLAUDE.md）
├── conversation/    # 对话管理（消息历史、工具调用循环）
├── llm/             # LLM 通信层
│   ├── anthropic.ts  # Anthropic Direct API
│   ├── bedrock.ts    # AWS Bedrock
│   ├── vertex.ts     # Google Vertex
│   └── foundry.ts    # Azure Foundry
├── mcp/             # MCP 协议集成
│   ├── manager.ts    # 多 Server 生命周期管理
│   └── tool-adapter.ts  # MCP Tool → SDK Tool 适配器
├── permission/      # 权限系统（模式、规则引擎）
├── session/         # 会话引擎（主入口 ClaudeCodeSDK）
├── tools/           # 工具系统
│   ├── built-in/     # 内置工具实现
│   └── registry.ts   # 工具注册中心
└── types/           # 类型定义
```

---

## 质量

| 指标 | 数值 |
|:---:|:---:|
| 测试数 | 234 ✅ |
| 语句覆盖率 | 82.84% |
| 函数覆盖率 | 91.02% |
| TypeScript | 零错误编译 |

---

## License

[MIT](LICENSE)

---

## 致谢

- [Anthropic Claude](https://www.anthropic.com/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [obra/superpowers](https://github.com/obra/superpowers) — 开发工作流方法论
