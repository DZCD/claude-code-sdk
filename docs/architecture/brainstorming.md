# Brainstorming — ClaudeCode SDK for TypeScript

## 1. 项目愿景

构建一个**不依赖 Claude Code 运行时**的独立 TypeScript SDK，让任何 Node.js 应用都能通过干净的 API 调用 Claude Code 的核心能力：LLM 通信、工具执行、对话管理。

### 核心原则
- **零运行时依赖**：SDK 不依赖 Claude Code 的任何运行时文件、React 组件、Ink UI 框架
- **TypeScript 优先**：严格类型、ESM 模块、干净的 API 设计
- **厂商无关的 LLM 层**：支持 Anthropic Direct API / AWS Bedrock / Google Vertex / Azure Foundry
- **工具系统可扩展**：用户可以注册自定义工具，也可以使用内置工具（Bash、File Read/Write/Edit 等）
- **可嵌入**：设计为库而非 CLI，可在任何 Node.js 进程中运行

## 2. 参考源码分析总结

通过对 `/home/user/.duclaw/workspace/claude-code-source-code/src/` 的深入分析，识别出以下核心模块：

### 2.1 核心抽象层

| 模块 | 关键文件 | 核心类型/类 | SDK 是否需要 |
|------|---------|------------|------------|
| **Tool 系统** | `src/Tool.ts` | `Tool<Input,Output,P>` 类型、`buildTool()` 工厂、`Tools` 集合 | ✅ 核心 |
| **LLM 通信** | `src/services/api/claude.ts` | `query()` 主循环、流式处理、API 调用封装 | ✅ 核心 |
| **API 客户端** | `src/services/api/client.ts` | 多 Provider 客户端初始化 | ✅ 核心 |
| **对话管理** | `src/query.ts` | 消息循环、工具调用编排、compact 压缩 | ✅ 核心 |
| **权限系统** | `src/utils/permissions/` | `PermissionMode`, `PermissionRule`, `PermissionResult` | ✅ 核心 |
| **配置管理** | `src/utils/config.ts` | 全局配置、settings.json 读写 | ✅ 核心 |
| **上下文构建** | `src/utils/queryContext.ts` | 系统提示词拼接、git 状态、CLAUDE.md | ✅ 核心 |
| **会话引擎** | `src/QueryEngine.ts` | 面向 SDK 的查询引擎、状态管理 | ✅ 核心 |

### 2.2 需排除的 Claude Code 运行时依赖

| 模块 | 原因 |
|------|------|
| React / Ink 组件 (`src/components/`, `src/ink/`) | 终端 UI 渲染，SDK 不涉及 |
| CLI 命令 (`src/commands/`, `src/cli/`) | CLI 界面，SDK 提供 API 而非命令 |
| Bun 特定特性 (`bun:bundle`, `feature()`) | Bun 运行时特定 |
| 会话持久化 (`src/utils/sessionStorage.ts`) | 存储层留给使用者 |
| 分析/遥测 (`src/services/analytics/`) | 内部遥测 |
| MCP 协议 (`src/services/mcp/`) | 可选集成，非核心 |
| 钩子系统 (`src/hooks/`, `src/utils/hooks/`) | Claude Code 内部钩子 |

## 3. SDK 架构设计

### 3.1 包结构

```
claude-code-sdk/
├── src/
│   ├── index.ts                    # 公共 API 导出
│   ├── types/                      # 核心类型定义
│   │   ├── index.ts
│   │   ├── message.ts              # 消息类型 (User/Assistant/Tool/System)
│   │   ├── tool.ts                 # Tool 类型系统
│   │   ├── permission.ts           # 权限类型
│   │   └── config.ts              # 配置类型
│   ├── llm/                        # LLM 通信层
│   │   ├── client.ts              # 统一的 LLM 客户端工厂
│   │   ├── anthropic.ts           # Anthropic Direct API
│   │   ├── bedrock.ts             # AWS Bedrock
│   │   ├── vertex.ts              # Google Vertex
│   │   ├── foundry.ts             # Azure Foundry
│   │   └── types.ts               # LLM 连接器接口
│   ├── tools/                      # 工具系统
│   │   ├── registry.ts            # 工具注册中心
│   │   ├── base.ts                # BaseTool 抽象类
│   │   ├── built-in/              # 内置工具实现
│   │   │   ├── bash.ts
│   │   │   ├── file-read.ts
│   │   │   ├── file-write.ts
│   │   │   ├── file-edit.ts
│   │   │   ├── glob.ts
│   │   │   ├── grep.ts
│   │   │   ├── web-fetch.ts
│   │   │   ├── web-search.ts
│   │   │   └── task.ts
│   │   └── permission.ts          # 工具权限装饰器
│   ├── conversation/               # 对话管理
│   │   ├── manager.ts             # ConversationManager
│   │   ├── loop.ts                # 工具调用循环 (query loop)
│   │   ├── stream.ts              # 流式处理
│   │   └── compact.ts             # 自动压缩
│   ├── session/                    # 会话引擎
│   │   ├── engine.ts              # SessionEngine
│   │   └── state.ts               # 会话状态
│   ├── context/                    # 上下文构建
│   │   ├── builder.ts             # 系统提示词构建器
│   │   ├── git.ts                 # Git 上下文
│   │   └── claude-md.ts           # CLAUDE.md 解析
│   ├── permission/                 # 权限系统
│   │   ├── mode.ts                # PermissionMode (plan/auto/manual)
│   │   ├── rule.ts                # 权限规则
│   │   ├── validator.ts           # 路径验证
│   │   └── result.ts              # 权限结果
│   └── config/                     # 配置管理
│       ├── manager.ts             # 配置管理器
│       ├── schema.ts              # 配置模式定义
│       └── provider.ts            # 配置源 (文件/环境变量)
```

### 3.2 模块依赖图

```
    index.ts (public API)
       │
       ├── SessionEngine
       │      ├── ConversationManager
       │      │      ├── LLM Client
       │      │      ├── Tool Registry
       │      │      └── Context Builder
       │      ├── Permission System
       │      └── Config Manager
       │
       ├── LLM Client ──── Anthropic / Bedrock / Vertex / Foundry
       ├── Tool Registry ── built-in tools + custom tools
       ├── Conversation Manager
       ├── Context Builder ── Git / CLAUDE.md / Memory
       ├── Permission System
       └── Config Manager
```

### 3.3 核心 API 设计（初步构想）

```typescript
// 1. 创建 SDK 实例
const sdk = new ClaudeCodeSDK({
  provider: 'anthropic',
  apiKey: 'sk-...',
  model: 'claude-sonnet-4-20250514',
})

// 2. 配置工具
sdk.use(BashTool)
sdk.use(FileReadTool)
sdk.use(FileEditTool)
// 或使用默认工具集
sdk.useDefaults()

// 3. 配置权限模式
sdk.withPermissionMode('auto')

// 4. 对话
const response = await sdk.sendMessage('List all TypeScript files')
for await (const chunk of response.stream) {
  // 流式处理
}

// 或者使用会话引擎管理完整对话
const session = sdk.createSession()
await session.send('Read src/index.ts', (toolCall) => {
  // 处理工具调用
  if (toolCall.tool === 'read') {
    return executeFileRead(toolCall.input)
  }
})
```

## 4. 关键技术决策

### 4.1 依赖策略

| 依赖 | 必要性 | 说明 |
|------|--------|------|
| `@anthropic-ai/sdk` | 必需 | Anthropic/Bedrock/Vertex/Foundry 的基础 SDK |
| `zod` | 必需 | 工具输入 schema 校验 |
| `uuid` | 可选 | 消息 ID 生成 |
| `google-auth-library` | 可选 | Vertex AI 认证 |
| `@aws-sdk/client-bedrock-runtime` | 可选 | Bedrock 支持 |
| `@azure/identity` | 可选 | Foundry Azure AD 认证 |

### 4.2 工具定义模式

参考 Claude Code 的 `Tool` 类型 + `buildTool` 工厂模式，SDK 使用更简洁的抽象：

```typescript
interface ToolDefinition<Input, Output> {
  name: string
  description: string
  inputSchema: z.ZodType<Input>
  execute(input: Input, context: ToolContext): Promise<ToolResult<Output>>
  // 可选：权限检查、输入验证等
}
```

### 4.3 流式处理

参考 Claude Code 的流式处理（`StreamEvent` 类型），SDK 提供双重 API：
- **Promise 风格**：等待完整响应
- **Async Iterator 风格**：逐块处理流式事件（文本增量、工具调用开始/结束）

### 4.4 权限模型简化

Claude Code 有复杂的权限系统，SDK 提供简化但兼容的版本：
- `manual`：每次工具调用询问用户
- `auto`：自动允许所有安全操作
- `plan`：仅允许只读操作

## 5. 未解决问题 / 待讨论

1. **工具执行上下文**：如何在 SDK 中表示 ToolUseContext？需要包含哪些字段？
2. **文件系统操作**：Bash/File 工具是否应该内置还是由集成者提供？
3. **自动压缩策略**：何时触发上下文压缩？压缩到什么程度？
4. **错误恢复**：API 超时/限流时的重试策略？
5. **MCP 工具集成**：第一阶段是否支持 MCP 协议？

## 6. 里程碑计划

| 阶段 | 内容 | 预计产出 |
|------|------|---------|
| **Phase 1** | 核心类型 + LLM 客户端 + 基础 Tool 系统 | `v0.1.0` |
| **Phase 2** | 对话管理 + 工具调用循环 + 流式处理 | `v0.2.0` |
| **Phase 3** | 内置工具实现 + 权限系统 | `v0.3.0` |
| **Phase 4** | 会话引擎 + 上下文构建 + 配置管理 | `v0.4.0` |
| **Phase 5** | 文档 + 示例 + 测试覆盖 + CI | `v1.0.0-beta` |
