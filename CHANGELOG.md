# Changelog

## [v0.4.0] — 2026-05-27

### Phase 3B — Developer Experience

#### Added

**B1: 高级流式消费 API**
- `streamToText(stream)` — 过滤非文本事件，只产出 `AsyncIterable<string>`，纯文本消费
- `streamToBlocks(stream)` — 状态机聚合 tool_use_start/end 为完整 ToolUseBlock，产出 `AsyncIterable<StreamBlock>`
- `createStreamConsumer(stream)` — 工厂函数创建 StreamConsumer 实例
- `StreamConsumer` 类：
  - `.toTextStream()` — 文本流
  - `.toBlockStream()` — 块流
  - `.on(type, cb)` — 类型化事件订阅（返回 unsubscribe 函数）
  - `.onEvent(cb)` — 全局事件回调
  - `.toPromise()` — 聚合全流为 `{ text, toolUses, usage }`
  - 支持 `AbortSignal` 取消

**B2: Tool Call 自动执行循环**
- `ask()` — Promise-based 一键"思考→调工具→返回结果"全流程
  - 自动执行工具调用（`autoExecuteTools=true`）
  - `onToolCall` 钩子（权限确认/阻断）
  - `maxToolCallDepth` 限制
  - `AbortSignal` 取消
  - 结构化返回 `AskResult`（文本 + toolCalls + usage + messages）
- `askStream()` — 流式版本，在关键点位透传 StreamEvent
  - 最终 yield `{ type: 'result', result }`
  - 支持 LLM 思考过程实时展示

**C1: 快速开始示例**
- `examples/quickstart.ts` — 一站式快速开始示例（5 项核心功能）
- `examples/README.md` — 示例目录说明、环境要求、运行方式

**C2: 典型场景示例**
- `examples/mcp-server.ts` — MCP 服务集成（stdio + MCPServerManager + ask）
- `examples/multi-turn.ts` — 多轮对话（上下文积累 + askStream + StreamConsumer）
- `examples/permission-custom.ts` — 权限策略定制（4 种权限模式 + 10 种风险分类）

#### Metrics
- 新增源文件：6 个（streaming/ 3 个 + ask/ 1 个 + test 2 个）
- 示例文件：5 个（共 828 行）
- 新增测试：35 个（B1: 24, B2: 11）
- **全量测试：811 通过（44 文件，0 回归）**

---

## [v0.3.0] — 2026-05-27

### Phase 3A — API Stability & CI

#### Added
- API 文档方案：TypeDoc 配置（`typedoc.json`）、`npm run docs` 命令
- `@public`/`@internal` 标注：63 个源文件全部标注完成
- JSDoc 注释：11 个模块公开导出全覆盖
- CI 流水线（`.github/workflows/ci.yml`）：
  - Node.js 18/20/22 三版本矩阵测试
  - lint (Biome) + type-check (tsc) + test (Vitest) + build
  - 覆盖率报告上传
- Coverage thresholds：branches ≥70%，functions/lines/statements ≥75%
- 两份设计文档：`design-phase3a-api-docs.md`、`design-phase3a-ci.md`

#### Changed
- 版本号升级：0.2.0 → 0.3.0
- `src/index.ts` VERSION 同步更新

#### Metrics
- **全量测试：776 通过（42 文件，0 回归）**

---

## [v0.2.0] — 2026-05-27

### Phase 2 — Feature Completion

#### Added
**BashTool 安全层** — 8 文件 / 24 验证器 / 158 测试
- YOLO 命令分类器（safe/medium/dangerous）
- 路径验证（黑名单、白名单、path traversal 检测）
- 危险模式检测（sed -i、rm -rf、权限提升等）
- Plan 模式只读拦截
- 权限矩阵（auto / manual / plan / bypass）

**LLM 流式重试引擎**
- `withRetry` 引擎：指数退避 + jitter
- 3 个 Provider 统一错误恢复
- Preconnect 预热
- 43 测试

**对话管理**
- CircularBuffer（环形缓冲区，容量上限 + 淘汰策略）
- TokenTracker（token 计数 + 用量统计）
- TokenBudget（预算控制 + continuation message）
- AutoCompactor（自动压缩 + SummaryLLM）
- MicroCompactor（微型压缩）
- 88 测试

**权限系统**
- YOLO 分类器（10 种危险级别）
- PathValidation（安全/警告/拒绝）
- DangerousPatterns 检测
- Plan 模式策略
- 87 测试

**会话引擎**
- Attribution（工具调用归属追踪）
- Persistence（快照 + 恢复）
- SessionConfig 扩展
- 61 测试

**上下文构建**
- Git 增强（diff、status、branch、remote、log）
- CLAUDE.md 多级目录遍历
- 三层 Memory（project/user/global）
- 38 测试

**配置管理 + MCP 资源**
- settings.json 读写（JSON Schema 校验）
- 多源合并（CLAUDE.md → settings → 环境变量 → 默认值）
- MCP 资源/提示模板（Resource 注册 + Prompt 工厂）
- 56 测试

#### Metrics
- 新增源文件：45+ 个
- **全量测试：776 通过（42 文件，0 回归）**

---

## [v0.1.0-beta] — 2026-05-26

### Phase 1 — Core Framework

#### Added
**Phase 1A: 核心框架**
- Core Types（Message、Tool、Config、Permission、Session）
- Tool System（BaseTool、ToolRegistry、Schema 验证）
- LLM Client（Anthropic Connector，流式事件接口）
- Conversation Loop（多轮 tool call 自动循环）
- Session Engine（会话创建/恢复/状态管理）
- Permission System（YOLO 模式 / Plan 模式 / 路径校验）
- Config Manager（多源配置合并）
- Context Builder（CLAUDE.md 解析、Git 状态集成）

**Phase 1B: 8 个内置工具**
- BashTool（安全执行 + 环境隔离）
- FileReadTool（文件读取 + 编码检测）
- FileWriteTool（安全写入 + 覆盖保护）
- FileEditTool（精确行替换 + diff 预览）
- GlobTool（文件模式匹配）
- GrepTool（内容搜索）
- WebFetchTool（URL 抓取）
- WebSearchTool（网络搜索）

**Phase 1C: 多 Provider 支持**
- BedrockConnector（AWS Bedrock 集成）
- VertexConnector（GCP Vertex AI 集成）
- FoundryConnector（SageMaker Foundry 集成）

**Phase 1D: MCP 协议集成**
- MCP 类型定义（`src/mcp/types.ts`）
- Tool 适配器（`src/mcp/tool-adapter.ts`）
- 服务器管理器（`src/mcp/manager.ts`）
- 支持 stdio + URL 传输模式
- 工具自动注册到 ToolRegistry

#### Metrics
- 初始源文件：28 个
- **全量测试：234 通过（19 文件）**
- 架构文档：3 份（brainstorming / design / implementation-plan）

---

## [Unreleased]

### Phase 3C — npm 发布准备 & 差距补齐
- [ ] A4: npm 发布准备（CHANGELOG.md、.npmignore、发布脚本）
- [ ] A5: 版本路线图（0.4.x → 1.0.0）
- [ ] D1: Hook System（事件钩子）
- [ ] D2: Feedback Loop（用户反馈注入）
- [ ] D3: WebSearch 增强
