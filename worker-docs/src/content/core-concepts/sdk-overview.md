# SDK 架构概览

## 整体架构

![SDK 架构图](/architecture.png)

Claude Code SDK 是一个模块化、可组合的 TypeScript 库，核心采用五层架构，从上到下依次为：用户代码层、高级 API 层、Session Engine 核心层（会话管理、工具系统、上下文构建、权限控制）、LLM 连接器层、基础设施层。

## 核心模块

### Session Engine
管理会话生命周期，包括创建、持久化、归因和恢复。每个会话包含独立的对话历史和状态。

### Conversation Manager
管理对话轮次、token 预算、自动压缩（Auto-Compact）和微压缩（Micro-Compact）。

### Tool System
工具注册、执行和结果处理。包含 8 个内置工具和 MCP 协议工具集成。

### Context Builder
构建 LLM 请求的上下文，包括 Git 状态、CLAUDE.md 文件、系统提示等。

### Permission System
控制工具执行的权限策略，支持 auto/manual/bypass/plan 四种模式。

### Config Manager
多源配置管理，支持文件/环境变量/编程三种来源。

### Hook System
事件钩子系统，支持在工具调用和 LLM 请求前后插入自定义逻辑。

### Logging

### Task Subsystem
持久化的任务管理，文件系统 JSON 存储。包含 Task Engine（CRUD 引擎）和 6 个 Task 工具（Create/Get/List/Update/Stop/Output）。AI 可自动创建和跟踪任务。

### Skill System
开发者可通过 createTool() 定义自定义 Skill，注册到 ToolRegistry 后在对话中由 AI 自动调用。与内置工具使用同一套注册机制。

### Structured Output
通过 JSON Schema 约束 LLM 输出格式，确保 AI 响应符合预期结构。支持 OutputFormat、PromptRequest/PromptResponse 交互式提示。
调试日志系统，5 级过滤，支持分类过滤和文件/stderr 输出。

## 为什么分层设计？

SDK 的五层架构并非随意划分，每一层解决一个**核心关注点**：

| 层次 | 解决的问题 | 类比 |
|------|-----------|------|
| **用户代码层** | 开发者直接使用的业务代码 | 餐厅的菜单 |
| **高级 API 层** | 屏蔽底层复杂性，提供 `ask()`/`askStream()` 简洁接口 | 服务员 |
| **Session Engine 核心层** | 会话生命周期、多轮记忆、状态管理 | 厨房管理 |
| **LLM 连接器层** | 统一不同 AI 模型的差异 | 供应链 |
| **基础设施层** | 配置、权限、日志等横向能力 | 水电网 |

层次之间通过**接口（Interface）**通信，互不了解内部实现。这意味着：

- 你可以换掉 LLM 连接器（从 DeepSeek 切换到 Bedrock），而 Session Engine 不需要改一行代码
- 你可以自定义权限规则，而工具系统不需要知道你的安全策略
- 这就是**依赖倒置原则**在 SDK 中的体现

## 核心模块

### Session Engine
管理会话生命周期，包括创建、持久化、归因和恢复。每个会话包含独立的对话历史和状态。

**为什么 Session Engine 是核心枢纽？**

Session Engine 位于所有功能模块的**交叉点**：
- 它管理 LLM 连接的创建和复用 → 不涉及 LLM 如何联网
- 它管理对话上下文的追加和传输 → 不涉及上下文如何编码
- 它触发工具系统执行 → 不涉及工具如何实现
- 它调用权限系统做安全检查 → 不涉及权限规则的业务逻辑

> 这种「协调者」角色使得 Session Engine 成为 SDK 中最稳定的模块——它的职责是**编排**而非**执行**，因此变更频率最低。

### Conversation Manager
管理对话轮次、token 预算、自动压缩（Auto-Compact）和微压缩（Micro-Compact）。

**为什么 Conversation Manager 要独立于 Session Engine？**

这是**单一职责原则**的体现：
- Session Engine 负责「对话的**生命周期**」（创建、持久化、恢复）
- Conversation Manager 负责「对话的**内容管理**」（token 预算、历史压缩）
- 两者职责正交：一个会话可以有不同的对话管理策略（比如长文档场景用宽松预算，实时聊天场景用严格预算）
- 独立设计意味着可以替换 Conversation Manager 实现（例如自定义压缩算法）而不影响 Session Engine

### Tool System
工具注册、执行和结果处理。包含 8 个内置工具和 MCP 协议工具集成。

### Context Builder
构建 LLM 请求的上下文，包括 Git 状态、CLAUDE.md 文件、系统提示等。

### Permission System
控制工具执行的权限策略，支持 auto/manual/bypass/plan 四种模式。

### Config Manager
多源配置管理，支持文件/环境变量/编程三种来源。

### Hook System
事件钩子系统，支持在工具调用和 LLM 请求前后插入自定义逻辑。

### Logging

### Task Subsystem
持久化的任务管理，文件系统 JSON 存储。包含 Task Engine（CRUD 引擎）和 6 个 Task 工具（Create/Get/List/Update/Stop/Output）。AI 可自动创建和跟踪任务。

### Skill System
开发者可通过 createTool() 定义自定义 Skill，注册到 ToolRegistry 后在对话中由 AI 自动调用。与内置工具使用同一套注册机制。

### Structured Output
通过 JSON Schema 约束 LLM 输出格式，确保 AI 响应符合预期结构。支持 OutputFormat、PromptRequest/PromptResponse 交互式提示。
调试日志系统，5 级过滤，支持分类过滤和文件/stderr 输出。

## 设计原则

1. **零运行时依赖** — 核心 SDK 不需要 Claude Code 运行时
2. **模块化** — 按需引入，只 import 需要的功能
3. **TypeScript 优先** — 完整的类型定义和类型安全
4. **可替换** — 每个核心接口都有可替换的实现
5. **渐进式** — 从简单的 ask() 到完整的 Session Engine 逐级深入
