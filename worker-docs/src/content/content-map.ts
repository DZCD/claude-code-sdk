const contentMap: Record<string, string> = {
  ["advanced/context-building"]: `# 上下文构建

ContextBuilder 负责构建发送给 LLM 的上下文信息。

## 基本使用

\\`\\`\\`typescript
import { ContextBuilder } from 'claude-code-sdk-ts'

const builder = new ContextBuilder()
const context = await builder.build()
\\`\\`\\`

## Git 上下文

\\`\\`\\`typescript
import { fetchGitDiff, getGitState, getBranch } from 'claude-code-sdk-ts'

// 获取 Git diff
const diff = await fetchGitDiff()
console.log(\\`变更文件: \\\${diff.files.length}\\`)

// 获取 Git 状态
const state = await getGitState()
console.log(\\`分支: \\\${state.branch}\\`)

// 获取当前分支
const branch = await getBranch()
console.log(\\`当前分支: \\\${branch}\\`)

// 获取远程地址
import { getRemoteUrl } from 'claude-code-sdk-ts'
const url = await getRemoteUrl()
console.log(\\`远程仓库: \\\${url}\\`)
\\`\\`\\`

## CLAUDE.md 加载

自动查找并加载项目中的 \\`CLAUDE.md\\` 文件：

\\`\\`\\`typescript
const context = await builder.build({
  includeClaudeMd: true,
  includeGitStatus: true,
})
\\`\\`\\`

CLAUDE.md 的搜索路径：
1. 项目根目录 \\`./CLAUDE.md\\`
2. \\`~/.claude/CLAUDE.md\\`
3. \\`~/.config/claude/CLAUDE.md\\`

## Memory 集成

\\`\\`\\`typescript
import { MemoryFileLoader } from 'claude-code-sdk-ts'

const loader = new MemoryFileLoader()
const memories = await loader.load()
// 返回三层 memory：项目级、全局级、会话级
\\`\\`\\`
`,
  ["advanced/error-handling"]: `# 错误处理

SDK 的错误处理和重试机制。

## 重试机制

LLM 请求自动带重试逻辑：

\\`\\`\\`typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: { provider: 'anthropic', apiKey: process.env.DEEPSEEK_API_KEY! },
    baseUrl: 'https://api.deepseek.com/anthropic',
  global: {
    maxRetries: 3,     // 最大重试次数
    timeout: 120000,   // 请求超时 (ms)
  },
})
\\`\\`\\`

## 自定义重试

\\`\\`\\`typescript
import { withRetry } from 'claude-code-sdk-ts/llm'

const result = await withRetry(
  async () => {
    return await apiCall()
  },
  {
    maxRetries: 5,
    signal: abortController.signal,
    onRetry: (event) => {
      console.log(\\`重试 \\\${event.attempt}/\\\${event.maxRetries}, 等待 \\\${event.delayMs}ms\\`)
    },
  },
)
\\`\\`\\`

## AbortSignal 取消

\\`\\`\\`typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

const controller = new AbortController()

// 5 秒后自动取消
setTimeout(() => controller.abort(), 5000)

try {
  const response = await sdk.send('Generate a very long story', {
    signal: controller.signal,
  })
} catch (err) {
  if ((err as Error).name === 'AbortError') {
    console.log('请求被取消')
  }
}
\\`\\`\\`

## 错误类型

| 错误 | 说明 |
|------|------|
| \\`APIError\\` | API 返回错误 |
| \\`RateLimitError\\` | 触发速率限制 |
| \\`TimeoutError\\` | 请求超时 |
| \\`PermissionError\\` | 权限检查未通过 |
| \\`ConfigError\\` | 配置验证失败 |
`,
  ["advanced/permission-system"]: `# 权限系统

SDK 的权限系统控制工具的执行权限，支持四种模式。

## 权限模式

| 模式 | 说明 | 适用场景 |
|------|------|---------|
| \\`auto\\` | 自动执行低风险操作，高风险请求确认 | 日常开发 |
| \\`manual\\` | 所有工具调用都需要用户确认 | 生产环境 |
| \\`bypass\\` | 跳过所有权限检查 | 自动化脚本 |
| \\`plan\\` | 仅做风险评估，不执行 | 预览模式 |

## 配置权限模式

\\`\\`\\`typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: { /* ... */ },
  permissionMode: 'manual', // 所有工具调用都需要确认
})
\\`\\`\\`

## 权限模式的设计背景

四种模式的设计体现了**最小权限原则（Principle of Least Privilege）**和安全与效率的权衡：

### \\`auto\\` 模式（日常开发首选）
- **设计背景**：开发中最常见的场景——AI 执行 \\`ls\\`、\\`cat\\`、\\`grep\\` 等低风险命令，开发者不需要每次都确认
- **安全策略**：基于风险分类器自动判断（读操作为低风险，写操作为中风险，删除为高风险）
- **适用场景**：个人开发环境、本地调试

### \\`manual\\` 模式（生产环境）
- **设计背景**：在 CI/CD 或生成服务器上，必须确保每个操作都经过人工审批
- **安全策略**：所有工调用都暂停并请求用户确认，不自动执行任何操作
- **适用场景**：生产部署、敏感数据操作

### \\`bypass\\` 模式（自动化脚本）
- **设计背景**：彻夜运行的批量任务、定时执行的维护脚本——不需要人看
- **安全策略**：跳过所有检查，完全信任 AI 的工具调用
- **适用场景**：受控环境的自动化、预验证过的脚本

### \\`plan\\` 模式（预览/审计）
- **设计背景**：在真正执行前，让 AI 先「规划」出需要执行哪些工具调用，用户审查后再执行
- **安全策略**：AI 可以调用工具但结果不写入环境，仅做风险评估报告
- **适用场景**：审查复杂工具链、安全审计、培训 AI 理解执行边界

## 自定义权限规则

\\`\\`\\`typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: { /* ... */ },
  permissionMode: 'auto',
  permissionRules: [
    {
      tool: 'BashTool',
      allowPatterns: ['ls', 'cat', 'echo'],  // 这些命令自动允许
      denyPatterns: ['rm', 'sudo', 'chmod'],  // 这些命令自动拒绝
    },
    {
      tool: 'FileWriteTool',
      allowPaths: ['./src/**'],               // 只允许写入 src 目录
      denyPaths: ['./node_modules/**'],        // 禁止修改 node_modules
    },
  ],
})
\\`\\`\\`

## 运行时权限控制

\\`\\`\\`typescript
import { PermissionManager } from 'claude-code-sdk-ts'

const pm = new PermissionManager()

// 检查工具是否允许执行
const request = {
  tool: 'BashTool',
  input: { command: 'ls -la' },
  riskLevel: 'low',
}

const decision = pm.evaluate(request)
if (decision.allowed) {
  console.log('允许执行')
} else {
  console.log(\\`拒绝: \\\${decision.reason}\\`)
}
\\`\\`\\`
`,
  ["advanced/rate-limiting"]: `# 速率限制

SDK 内置的速率限制和冷却（cooldown）机制。

## Cooldown 机制

SDK 不会自己实现令牌桶限流，但会解析 API 返回的速率限制响应头并进入冷却状态：

\\`\\`\\`typescript
import { isInCooldown, getRateLimitState } from 'claude-code-sdk-ts'

// 检查是否在冷却中
if (isInCooldown()) {
  const state = getRateLimitState()
  console.log(\\`冷却中，原因: \\\${state.reason}, 重置时间: \\\${new Date(state.resetAt!).toISOString()}\\`)
}
\\`\\`\\`

## 冷却状态管理

\\`\\`\\`typescript
import { triggerCooldown, clearCooldown, getRateLimitState } from 'claude-code-sdk-ts'

// 手动触发冷却
triggerCooldown(Date.now() + 60000, 'rate_limit')

// 获取当前状态
const state = getRateLimitState()
console.log(state.isCooldown) // true

// 手动清除冷却
clearCooldown()

// 冷却会自动过期（当 Date.now() >= resetAt）
\\`\\`\\`

## Rate Limit Header 解析

\\`\\`\\`typescript
import { parseRateLimitHeaders } from 'claude-code-sdk-ts'

const headers = {
  'anthropic-ratelimit-requests-remaining': '10',
  'anthropic-ratelimit-requests-reset': '2026-05-28T15:00:00Z',
  'anthropic-ratelimit-tokens-remaining': '50000',
  'anthropic-ratelimit-tokens-reset': '1716890400000',
}

const parsed = parseRateLimitHeaders(headers)
console.log(parsed.requestsRemaining) // 10
console.log(parsed.tokensReset)       // 1716890400000 (epoch ms)
\\`\\`\\`

## 集成到 LLM 请求

速率限制的冷却状态会自动与 LLM Client 的 \\`withRetry\\` 集成，在收到 429 响应时自动触发冷却。

## 配置

\\`\\`\\`typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: { provider: 'anthropic', apiKey: process.env.DEEPSEEK_API_KEY! },
    baseUrl: 'https://api.deepseek.com/anthropic',
  rateLimit: {
    enabled: true,  // 启用速率限制跟踪
  },
})
\\`\\`\\`
`,
  ["advanced/skill-system"]: `# Skill 系统

Skill 是 SDK 的**渐进式暴露（Progressive Exposure）指令集**，让 AI 按需发现并加载专业能力。

## 设计理念：Skill 不是 Tool

在理解 Skill 之前，必须澄清一个重要区别：

| | Tool（工具） | Skill（技能） |
|:---|:-------------|:--------------|
| **暴露方式** | 全量暴露（每次请求都带完整参数 schema） | **渐进式**（先只展示名称和简介，选中后才加载完整内容） |
| **AI 看到** | 完整函数签名 + 参数 schema | Listing 阶段只看到 \\`name: description\\` |
| **内容形式** | 函数签名 + 参数 schema | **任意 Markdown 指令文本** |
| **执行方式** | 一次函数调用 → 返回结构化的 tool result | 指令注入对话 → AI 按指令行事 |
| **子工具** | 无（工具本身是原子操作） | 可声明 \\`allowedTools\\` 允许 AI 在执行时按需调用 |

> **核心思想**：Skill 不是"一个函数调用"，它是**一个动态注入的指令集**。当 AI 选中某个 Skill 后，系统把该 Skill 的完整指令注入对话，AI 从此以该身份或角色工作。

## 工作流程

\\`\\`\\`
用户问题 → SDK 构建系统提示
               │
               ▼
        注入 Skill 一览（仅展示 name: description）
               │
               ▼
        AI 判断哪个 Skill 匹配当前任务
               │
               ▼
        AI 调用 SkillTool("skill_name")
               │
               ▼
        SDK 将 Skill 完整指令注入对话
               │
               ▼
        AI 按指令执行任务（可调用 allowedTools 中的工具）
\\`\\`\\`

**关键约束**：整个 Skill 列表只占上下文 token 预算的约 **1%**，每个 Skill 描述最多 **250 字符**。这使得 AI 可以浏览大量 Skill 而不影响核心对话的 token 预算。

## 定义 Skill

使用 \\`createSkill()\\` 方法定义 Skill：

\\`\\`\\`typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'anthropic',
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: process.env.DEEPSEEK_API_KEY!,
    model: 'deepseek-v4-flash',
  },
})

// 定义代码审查 Skill
sdk.createSkill({
  name: 'code_review',
  description: '对代码进行全面审查，发现潜在问题',
  instruction: \\`你是一个资深代码审查专家。

## 审查原则
1. **安全性** — 检查 SQL 注入、XSS、CSRF 等安全隐患
2. **性能** — 关注 N+1 查询、内存泄漏、不必要的计算
3. **可维护性** — 代码组织、命名、注释是否合理
4. **错误处理** — 是否有适当的 try/catch 边界

## 输出格式
审查完成后，按以下格式输出结构化报告：

### 问题列表
| 严重程度 | 文件 | 行号 | 说明 |
|----------|------|------|------|
| 高 | src/app.ts | 42 | ... |

### 改进建议
1. ...
\\`,
  allowedTools: ['FileRead', 'Grep', 'Glob'],  // AI 可使用这些工具来完成审查
})
\\`\\`\\`

### 参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| \\`name\\` | \\`string\\` | ✅ | Skill 唯一名称，AI 通过此名称调用 |
| \\`description\\` | \\`string\\` | ✅ | 简介（最多 **250 字符**，Listing 阶段只显示这个） |
| \\`instruction\\` | \\`string\\` | ✅ | 完整指令（Markdown 格式），AI 选中 Skill 后注入对话 |
| \\`allowedTools\\` | \\`string[]\\` | 否 | AI 在执行该 Skill 时可以调用的工具列表 |
| \\`context\\` | \\`'inline' \\\\| 'fork'\\` | 否 | 执行模式：\\`inline\\`（默认，当前对话中执行）/ \\`fork\\`（独立上下文中执行） |

## 注册多个 Skill

注册多个 Skill，AI 会根据问题自动选择合适的：

\\`\\`\\`typescript
// 天气查询 Skill
sdk.createSkill({
  name: 'weather_check',
  description: '查询天气信息',
  instruction: '使用内置的 web_fetch 工具查询当前天气信息，然后以友好的方式回复用户。',
  allowedTools: ['WebFetch', 'WebSearch'],
})

// 日志分析 Skill
sdk.createSkill({
  name: 'log_analysis',
  description: '分析应用日志，排查错误和异常',
  instruction: \\`你是一个运维专家。

分析日志时关注：
1. ERROR 级别日志的频率和分布
2. 异常堆栈的关键信息
3. 时间维度的趋势分析

输出清晰的排查结论和修复建议。\\`,
  allowedTools: ['Bash', 'Grep', 'FileRead'],
})
\\`\\`\\`

## 调用 Skill

注册后，AI 会自动在对话中看到 Skill 列表。无需额外调用代码——当 AI 判断需要某个 Skill 时，会自动调用 \\`SkillTool\\` 加载指令：

\\`\\`\\`typescript
// 用户提问 → AI 自动选择匹配的 Skill
const response = await sdk.send('帮我审查一下当前项目的代码质量')
// AI: 检查到你有 code_review Skill
// → 自动调用 SkillTool("code_review")
// → 注入代码审查指令
// → 开始审查项目代码...
\\`\\`\\`

你也可以通过 \\`ask()\\` 使用 Skill：

\\`\\`\\`typescript
import { ask, ToolRegistry } from 'claude-code-sdk-ts'

const registry = new ToolRegistry()
const result = await ask(sdk.getLLM(), {
  systemPrompt: 'You are a helpful assistant.',
  messages: [{ role: 'user', content: '帮我分析一下日志文件中的错误' }],
  tools: registry,
})
\\`\\`\\`

## 完整示例

\\`\\`\\`typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'anthropic',
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: process.env.DEEPSEEK_API_KEY!,
    model: 'deepseek-v4-flash',
  },
})

// 创建一个翻译 Skill
sdk.createSkill({
  name: 'translator',
  description: '将中文文本翻译为英文',
  instruction: \\`你是一个专业翻译。

## 要求
1. 准确传达原文意思
2. 保持自然的英文表达
3. 注意文化差异和语境

## 输出格式
原文：...
译文：...
\\`,
  allowedTools: [],
})

async function main() {
  const response = await sdk.send('请帮我把"机器学习正在改变世界"翻译成英文')
  console.log(response.content)
}

main()
\\`\\`\\`

## 最佳实践

1. **描述精准** — \\`description\\` 是 AI 唯一的筛选依据，要用简练的语言说明 Skill 的用途
2. **指令结构清晰** — \\`instruction\\` 使用 Markdown 标题、列表组织内容，便于 AI 理解
3. **限定工具范围** — \\`allowedTools\\` 只列出必需的工具，减少 AI 的决策负担
4. **关注 Token 效率** — Skill 的内容会注入对话，过长的指令会消耗 token；保持指令精简
5. **命名规范** — 使用蛇形命名（\\`code_review\\`、\\`log_analysis\\`），便于 AI 识别
6. **Context 选择** — 大多数场景用默认的 \\`inline\\`；如果需要隔离执行环境（如审计功能），用 \\`fork\\`

## 交互式 Skill（PromptRequest/Response）

Skill 可以返回 \\`PromptRequest\\` 来向用户提问，接收 \\`PromptResponse\\` 作为回答：

\\`\\`\\`typescript
import { createPromptRequest, createPromptResponse, isPromptResponse } from 'claude-code-sdk-ts'

const confirmSkill = createTool({
  name: 'confirm_action',
  description: '在执行操作前向用户索取确认',
  inputSchema: z.object({
    action: z.string().describe('即将执行的操作描述'),
  }),
  async execute(input) {
    return {
      content: JSON.stringify(
        createPromptRequest('confirm', \\`确认执行：\\\${input.action}？\\`, [
          { key: 'yes', label: '确认' },
          { key: 'no', label: '取消' },
        ])
      ),
      data: { promptId: 'confirm', action: input.action },
    }
  },
})
\\`\\`\\`

当 Skill 需要结构化输出时，结合 [Structured Output](/advanced/structured-output) 使用 OutputFormat。

### LocalCommandOutput 使用场景

如果 Skill 涉及本地命令执行，可以利用 \\`LocalCommandOutput\\` 捕获命令输出并作为 Task 的输出数据保存：

\\`\\`\\`typescript
const deploySkill = createTool({
  name: 'deploy_project',
  description: '部署项目到 Cloudflare Workers',
  inputSchema: z.object({ environment: z.string() }),
  async execute(input) {
    // 通过 BashTool 执行命令 → 捕获输出 → 写入 Task output
    return {
      content: \\`部署到 \\\${input.environment} 已完成\\`,
      data: {
        environment: input.environment,
        commandOutput: '...',  // LocalCommandOutput 等效
      },
    }
  },
})
\\`\\`\\`
`,
  ["advanced/task-system"]: `# Task 子系统

Task 子系统提供持久化的任务管理能力。Task 是文件系统支持的 JSON 格式工作项，遵循 \\`pending → in_progress → completed\\` 生命周期，支持依赖关系和元数据。

## 概述

Task 子系统由两部分组成：

| 组件 | 说明 |
|------|------|
| **Task Engine** | 底层 CRUD 引擎，文件系统存储（\\`~/.claude/tasks/{taskListId}/\\`） |
| **Task 工具** | 6 个内置工具，让 AI 通过对话自动管理任务 |

\\`\\`\\`
Task Engine (engine.ts)
├── createTask()    — 创建任务，自动生成顺序 ID
├── getTask()       — 按 ID 检索任务
├── listTasks()     — 列出所有任务
├── updateTask()    — 部分更新任务
├── deleteTask()    — 删除任务并清理引用
├── blockTask()     — 建立任务依赖关系
└── resetTaskList() — 清空任务列表
\\`\\`\\`

## 定义 Task

每个 Task 有标准的 JSON 结构：

\\`\\`\\`typescript
import type { Task } from 'claude-code-sdk-ts'

// Task 完整结构
const task: Task = {
  id: '1',                   // 自动生成（顺序数字）
  subject: '修复登录 Bug',    // 简短标题
  description: '修复用户登录时 OAuth 回调 500 错误',  // 详细描述
  activeForm: 'Fixing login bug',  // 进行中时显示的动名词形式
  status: 'pending',         // pending | in_progress | completed
  owner: 'agent-1',          // 负责的 Agent
  blocks: [],                // 被此任务阻塞的任务 ID
  blockedBy: ['2'],          // 阻塞此任务的任务 ID
  metadata: {                // 自定义元数据
    priority: 'high',
    sprint: 'Sprint 5',
  },
  output: '',                // 任务执行的捕获输出
  createdAt: '2026-05-28T10:00:00.000Z',
  updatedAt: '2026-05-28T10:30:00.000Z',
}
\\`\\`\\`

## 使用 Task 引擎

Task Engine 提供纯函数式 API，直接操作文件系统：

\\`\\`\\`typescript
import {
  configureTaskEngine,
  createTask,
  getTask,
  listTasks,
  updateTask,
  deleteTask,
  blockTask,
  resetTaskList,
  getTaskListId,
} from 'claude-code-sdk-ts'

// 配置存储位置
configureTaskEngine({
  baseDir: '~/.claude/tasks',   // 默认
  taskListId: 'default',         // 默认
})

// 创建任务
const taskId = await createTask('default', {
  subject: '添加单元测试',
  description: '为 Task Engine 模块添加完整单元测试',
  metadata: { coverage: '>80%' },
})
console.log(\\`Created task #\\\${taskId}\\`)  // "Created task #1"

// 获取任务
const task = await getTask('default', '1')
console.log(task?.status)  // "pending"

// 更新任务
await updateTask('default', '1', {
  status: 'in_progress',
  owner: 'agent-2',
})
console.log((await getTask('default', '1'))?.status)  // "in_progress"

// 建立依赖关系
await blockTask('default', '2', '1')  // 任务 2 等待任务 1 完成

// 列出所有任务
const all = await listTasks('default')
console.log(all.length)  // 2

// 获取当前 taskListId（可通过 CLAUDE_CODE_TASK_LIST_ID 环境变量覆盖）
console.log(getTaskListId())  // "default"
\\`\\`\\`

## Task 工具

SDK 提供 6 个内置 Task 工具，AI 可在对话中自动调用：

### TaskCreate
创建新任务，初始状态为 \\`pending\\`。

\\`\\`\\`typescript
// AI 可调用：
// TaskCreate({ subject: '修复登录Bug', description: 'OAuth 回调返回 500...' })
\\`\\`\\`

**参数**：\\`subject\\`（必填）、\\`description\\`（必填）、\\`activeForm\\`（可选）、\\`metadata\\`（可选）

### TaskGet
按 ID 检索完整任务信息。

\\`\\`\\`typescript
// AI 可调用：
// TaskGet({ taskId: '1' })
// → Task #1: 修复登录Bug
//   状态: pending, 描述: OAuth 回调返回 500...
\\`\\`\\`

**参数**：\\`taskId\\`（必填）

### TaskList
列出当前任务列表中的所有任务。

\\`\\`\\`typescript
// AI 可调用：
// TaskList({})
// → 3 tasks: #1 pending, #2 in_progress, #3 completed
\\`\\`\\`

无必填参数。

### TaskUpdate
更新任务状态、标题、描述、依赖等。支持将状态设为 \\`deleted\\` 来删除任务。

\\`\\`\\`typescript
// AI 可调用：
// TaskUpdate({ taskId: '1', status: 'in_progress' })
// → Task #1 updated: status → in_progress
\\`\\`\\`

**参数**：\\`taskId\\`（必填）、\\`subject\\`、\\`description\\`、\\`status\\`、\\`addBlocks\\`、\\`addBlockedBy\\`、\\`owner\\`、\\`metadata\\`（均可选）

### TaskStop
将任务状态设为 \\`completed\\`。

\\`\\`\\`typescript
// AI 可调用：
// TaskStop({ taskId: '1' })
// → Task #1 stopped: status → completed
\\`\\`\\`

**参数**：\\`taskId\\`（必填）

### TaskOutput
获取任务的捕获输出（如命令执行结果）。

\\`\\`\\`typescript
// AI 可调用：
// TaskOutput({ taskId: '1' })
// → Task #1 output: "用户名验证通过\\\\n密码哈希匹配成功\\\\n..."
\\`\\`\\`

**参数**：\\`taskId\\`（必填）

## 完整示例

\\`\\`\\`typescript
import {
  ClaudeCodeSDK,
  configureTaskEngine,
  createTask,
  listTasks,
  updateTask,
} from 'claude-code-sdk-ts'

// 初始化
configureTaskEngine({ baseDir: './my-tasks' })

const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'anthropic',
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: process.env.DEEPSEEK_API_KEY!,
    model: 'deepseek-v4-flash',
  },
  defaultTools: true,  // 自动注册 6 个 Task 工具
})

async function main() {
  // 创建几个任务
  await createTask('default', {
    subject: '实现登录模块',
    description: '实现 OAuth 2.0 登录流程',
  })
  await createTask('default', {
    subject: '编写 API 文档',
    description: '为所有端点编写 OpenAPI 文档',
  })

  // 查看任务列表
  const tasks = await listTasks('default')
  console.log(\\`当前有 \\\${tasks.length} 个任务\\`)

  // 让 AI 帮忙管理任务
  // AI 会自动调用 TaskUpdate、TaskStop 等工具
  const response = await sdk.send('把第一个任务标记为完成，第二个任务的状态更新为进行中')
  console.log('AI:', response.content)
}

main()
\\`\\`\\`

**输出示例：**

\\`\\`\\`
当前有 2 个任务
AI: 已完成以下操作：
  - Task #1（实现登录模块）→ completed
  - Task #2（编写 API 文档）→ in_progress
\\`\\`\\`

## 最佳实践

### 1. 任务描述要具体

\\`\\`\\`typescript
// ❌ 太模糊
createTask('default', { subject: '修复Bug', description: '有个Bug' })

// ✅ 清晰可执行
createTask('default', {
  subject: '修复 OAuth token 刷新 401 错误',
  description: 'Token 过期后刷新接口返回 401 而非 200。需要在 refreshToken() 中添加错误处理并记录日志。',
})
\\`\\`\\`

### 2. 使用依赖关系建模阻塞

\\`\\`\\`typescript
// 任务 B 依赖任务 A 完成
await createTask('default', { subject: '数据库迁移', description: '...' })        // #1
await createTask('default', { subject: 'API 对接新表', description: '...' })       // #2
await blockTask('default', '2', '1')  // #2 被 #1 阻塞
\\`\\`\\`

### 3. 利用 metadata 扩展信息

\\`\\`\\`typescript
await createTask('default', {
  subject: '性能优化',
  description: '优化首页加载时间',
  metadata: {
    priority: 'high',
    estimatedHours: 4,
    relatedPR: 'https://github.com/DZCD/claude-code-sdk/pull/42',
  },
})
\\`\\`\\`

### 4. 存储位置管理

\\`\\`\\`typescript
// 项目 A 使用独立任务目录
configureTaskEngine({ baseDir: './project-a/.tasks' })

// 项目 B 用环境变量隔离
process.env.CLAUDE_CODE_TASK_LIST_ID = 'project-b'
\\`\\`\\`

### 5. 让 AI 管理任务状态

将 Task 工具注册到 SDK 后，AI 可以：

- 创建新任务来跟踪复杂工作
- 开始工作时将任务标记为 \\`in_progress\\`
- 完成时标记为 \\`completed\\`
- 创建任务间的依赖关系
- 读取任务输出来了解之前的结果

---

## 相关文档

- [工具系统](/core-concepts/tool-system) — 了解工具注册和执行机制
- [Skill 系统](/advanced/skill-system) — 自定义 Skill 与 Task 工具的协同使用
- [权限系统](/advanced/permission-system) — 控制 Task 工具的权限
`,
  ["api-reference/claude-code-sdk"]: `# ClaudeCodeSDK

SDK 主入口类，提供会话管理、工具注册和全局配置功能。

## 构造函数

\\`\\`\\`typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK(config: SDKConfig)
\\`\\`\\`

## 配置参数

\\`\\`\\`typescript
interface SDKConfig {
  llm: LLMConfig                          // LLM 配置
  permissionMode?: PermissionMode         // 权限模式
  permissionRules?: PermissionRule[]      // 权限规则
  defaultTools?: boolean | string[]       // 默认工具
  mcpServers?: MCPServerConfig[]          // MCP 服务器
  context?: ContextOptions                // 上下文选项
  conversation?: ConversationOptions      // 对话选项
  global?: GlobalOptions                  // 全局选项
  session?: SessionConfig                 // 会话配置
  rateLimit?: { enabled?: boolean }       // 速率限制
}
\\`\\`\\`

## 方法

### \\`send()\\`

发送消息并获取回复：

\\`\\`\\`typescript
const response = await sdk.send('Hello')
\\`\\`\\`

### \\`stream()\\`

流式发送消息：

\\`\\`\\`typescript
const stream = sdk.stream('Tell me a story')
for await (const event of stream) {
  if (event.type === 'text') {
    process.stdout.write(event.text)
  }
}
\\`\\`\\`

### \\`getConfig()\\`

获取当前配置：

\\`\\`\\`typescript
const config = sdk.getConfig()
console.log(config.llm.provider) // 'anthropic'
\\`\\`\\`

## 属性

| 属性 | 类型 | 说明 |
|------|------|------|
| \\`VERSION\\`（从模块导入） | \\`string\\` | SDK 版本号 |
| \\`configManager\\` | \\`ConfigManager\\` | 配置管理器 |
| \\`toolRegistry\\` | \\`ToolRegistry\\` | 工具注册表 |
| \\`hookSystem\\` | \\`HookSystem\\` | 钩子系统 |
`,
  ["api-reference/config-manager"]: `# ConfigManager

配置管理器，支持多来源配置加载和合并。

## 创建 ConfigManager

\\`\\`\\`typescript
import { ConfigManager } from 'claude-code-sdk-ts'

const config = new ConfigManager(initialConfig?: Partial<SDKConfig>)
\\`\\`\\`

## 方法

### \\`getConfig()\\`

获取完整配置的拷贝：

\\`\\`\\`typescript
const cfg = config.getConfig()
\\`\\`\\`

### \\`update(partial)\\`

更新配置（深合并）：

\\`\\`\\`typescript
config.update({
  llm: { provider: 'vertex', projectId: 'my-project' },
})
\\`\\`\\`

### \\`loadFromFile(path)\\`

从 JSON 文件加载配置：

\\`\\`\\`typescript
config.loadFromFile('./settings.json')
\\`\\`\\`

### \\`saveToFile(path)\\`

保存配置到 JSON 文件（自动过滤默认值）：

\\`\\`\\`typescript
config.saveToFile('./settings.json')
\\`\\`\\`

### \\`loadFromEnv()\\`

从环境变量加载配置：

\\`\\`\\`typescript
const envConfig = config.loadFromEnv()
\\`\\`\\`

### \\`mergeFromEnv()\\`

将环境变量合并到当前配置：

\\`\\`\\`typescript
config.mergeFromEnv()
\\`\\`\\`

### \\`loadFromSources(sources)\\`

按优先级从多个来源加载：

\\`\\`\\`typescript
config.loadFromSources({
  filePath: './settings.json',
  env: process.env,
  cliArgs: { permissionMode: 'bypass' },
})
\\`\\`\\`

### \\`validate()\\`

使用内置规则验证配置（兼容旧版）：

\\`\\`\\`typescript
const result = config.validate()
console.log(result.errors) // string[]
\\`\\`\\`

### \\`validateZod()\\`

使用 Zod schema 验证配置，返回结构化错误：

\\`\\`\\`typescript
const result = config.validateZod()
if (!result.valid) {
  result.errors.forEach(e => {
    console.log(\\`\\\${e.path}: \\\${e.message} (期望: \\\${e.expected}, 实际: \\\${e.actual})\\`)
  })
}
// "llm.apiKey: Required (期望: string, 实际: undefined)"
\\`\\`\\`

### \\`onDidChange(callback)\\`

监听配置变更事件：

\\`\\`\\`typescript
const unsubscribe = config.onDidChange((event) => {
  console.log(\\`配置变更: \\\${event.key} = \\\${event.newValue}\\`)
})
\\`\\`\\`

### \\`watch(path)\\`

监听配置文件的外部修改（热更新）：

\\`\\`\\`typescript
config.watch('./settings.json')
\\`\\`\\`

### \\`unwatch()\\`

停止监听配置文件。
`,
  ["api-reference/hooks"]: `# Hook 系统

事件钩子系统，允许在工具调用和 LLM 请求前后插入自定义逻辑。

## HookSystem

\\`\\`\\`typescript
import { HookSystem } from 'claude-code-sdk-ts'

const hooks = new HookSystem()
\\`\\`\\`

## 钩子类型

| 阶段 | 触发时机 | 回调签名 |
|------|----------|---------|
| \\`preTool\\` | 工具执行前 | \\`(name, input) => { allowed: boolean }\\` |
| \\`postTool\\` | 工具执行后 | \\`(name, input, output) => void\\` |
| \\`preTurn\\` | LLM 请求前 | \\`(messages) => { modified: boolean, messages }\\` |
| \\`postTurn\\` | LLM 请求后 | \\`(messages, response) => void\\` |

## 注册钩子

### PreTool — 工具执行前

\\`\\`\\`typescript
hooks.register('preTool', 'audit', async (name, input) => {
  console.log(\\`[审计] 工具 \\\${name} 被调用\\`)
  return { allowed: true } // 允许执行
})

// 拒绝执行
hooks.register('preTool', 'block-dangerous', async (name, input) => {
  if (name === 'BashTool' && input.command?.includes('rm -rf')) {
    return { allowed: false, reason: '禁止的危险命令' }
  }
  return { allowed: true }
})
\\`\\`\\`

### PostTool — 工具执行后

\\`\\`\\`typescript
hooks.register('postTool', 'log-results', async (name, input, output) => {
  console.log(\\`工具 \\\${name} 执行完成，输出:\\`, output)
})
\\`\\`\\`

### PreTurn — LLM 请求前

\\`\\`\\`typescript
hooks.register('preTurn', 'inject-context', async (messages) => {
  return {
    modified: true,
    messages: [
      { role: 'system', content: '当前时间: ' + new Date().toISOString() },
      ...messages,
    ],
  }
})
\\`\\`\\`

### PostTurn — LLM 请求后

\\`\\`\\`typescript
hooks.register('postTurn', 'track-cost', async (messages, response) => {
  console.log(\\`Token 用量: \\\${response.usage?.inputTokens} in / \\\${response.usage?.outputTokens} out\\`)
})
\\`\\`\\`

## 管理钩子

\\`\\`\\`typescript
// 取消注册
hooks.unregister('preTool', 'audit')

// 获取摘要
const summary = hooks.getSummary()
// [{ phase: 'preTool', name: 'audit' }, ...]

// 清空所有钩子
hooks.clear()
\\`\\`\\`

## 完整示例

\\`\\`\\`typescript
import { ClaudeCodeSDK, HookSystem } from 'claude-code-sdk-ts'

const hooks = new HookSystem()

// 审计日志
hooks.register('preTool', 'audit', async (name, input) => {
  console.log(\\`[\\\${new Date().toISOString()}] \\\${name}(\\\${JSON.stringify(input)})\\`)
  return { allowed: true }
})

// 创建 SDK 时传入 HookSystem
const sdk = new ClaudeCodeSDK({
  llm: { provider: 'anthropic', apiKey: process.env.DEEPSEEK_API_KEY! },
    baseUrl: 'https://api.deepseek.com/anthropic',
  // HookSystem 会自动集成
})
\\`\\`\\`
`,
  ["api-reference/logging"]: `# 日志系统

SDK 的调试日志系统，用于诊断和排查问题。

## 基本用法

\\`\\`\\`typescript
import { logForDebugging, enableDebugLogging } from 'claude-code-sdk-ts'

logForDebugging('LLM 请求开始', { level: 'debug' })
logForDebugging('工具执行完成', { level: 'info' })
\\`\\`\\`

## 日志级别

5 个级别，从低到高：

| 级别 | 说明 | 默认是否输出 |
|------|------|-------------|
| \\`verbose\\` | 详细诊断 | ❌ |
| \\`debug\\` | 调试信息 | ✅（默认） |
| \\`info\\` | 一般信息 | ✅ |
| \\`warn\\` | 警告 | ✅ |
| \\`error\\` | 错误 | ✅ |

## 启用方式

\\`\\`\\`bash
# 环境变量
DEBUG_SDK=true node app.js

# 命令行标志
node app.js --debug

# 程序化启用
import { enableDebugLogging } from 'claude-code-sdk-ts'
enableDebugLogging()
\\`\\`\\`

## 分类过滤

使用 \\`--debug=分类\\` 语法过滤特定类别的日志：

\\`\\`\\`bash
node app.js --debug=api,hooks
node app.js --debug=!1p,!file   # 排除特定类别
\\`\\`\\`

## 输出目标

默认写入 \\`./debug/<sessionId>.txt\\` 文件：

\\`\\`\\`bash
# 输出到 stderr
node app.js --debug-to-stderr

# 自定义日志文件路径
DEBUG_SDK_LOG_FILE=/var/log/sdk.log node app.js
\\`\\`\\`

## 环境变量

| 变量 | 说明 |
|------|------|
| \\`DEBUG_SDK\\` | 启用调试日志 |
| \\`DEBUG_SDK_LOG_LEVEL\\` | 最低日志级别（默认 debug） |
| \\`DEBUG_SDK_LOG_FILE\\` | 日志文件路径 |
| \\`DEBUG_SDK_LOGS_DIR\\` | 日志目录 |
`,
  ["api-reference/mcp"]: `# MCP 协议

Model Context Protocol (MCP) 集成，支持连接外部工具服务器。

## MCPServerManager

管理 MCP 服务器连接：

\\`\\`\\`typescript
import { MCPServerManager } from 'claude-code-sdk-ts'

const manager = new MCPServerManager()
\\`\\`\\`

### 添加服务器

支持两种传输模式：

\\`\\`\\`typescript
// stdio 模式
await manager.addServer({
  name: 'my-tools',
  transport: 'stdio',
  command: 'node',
  args: ['./mcp-server.js'],
})

// URL 模式
await manager.addServer({
  name: 'remote-tools',
  transport: 'url',
  url: 'https://mcp.example.com/sse',
})
\\`\\`\\`

### 获取工具

\\`\\`\\`typescript
const tools = manager.getTools()
console.log(\\`可用 MCP 工具: \\\${tools.length}\\`)
\\`\\`\\`

### 适配工具

\\`\\`\\`typescript
import { adaptMCPTool, ToolRegistry } from 'claude-code-sdk-ts'

const registry = new ToolRegistry()
for (const mcpTool of manager.getTools()) {
  const adapted = adaptMCPTool(mcpTool)
  registry.register(adapted)
}
\\`\\`\\`

## MCP 资源配置

\\`\\`\\`typescript
// MCP 配置集成到主配置
const sdk = new ClaudeCodeSDK({
  llm: { provider: 'anthropic', apiKey: 'sk-...' },
    baseUrl: 'https://api.deepseek.com/anthropic',
  mcpServers: [
    {
      name: 'filesystem',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', './data'],
    },
  ],
})
\\`\\`\\`
`,
  ["core-concepts/conversation"]: `# Conversation Manager

Conversation Manager 管理多轮对话的状态、Token 预算和自动压缩。

## 核心组件

### TokenTracker
追踪对话的 token 使用情况：

\\`\\`\\`typescript
import { TokenTracker } from 'claude-code-sdk-ts'

const tracker = new TokenTracker(100000) // 预算 100K tokens
tracker.addUsage({ inputTokens: 1500, outputTokens: 500 })
console.log(tracker.usage) // { inputTokens: 1500, outputTokens: 500 }
console.log(tracker.remaining) // 98000
console.log(tracker.percentage) // 2
\\`\\`\\`

### CircularBuffer
固定大小的循环缓冲区，用于管理消息历史：

\\`\\`\\`typescript
import { CircularBuffer } from 'claude-code-sdk-ts'

const buffer = new CircularBuffer(100) // 最多 100 条消息
buffer.push({ role: 'user', content: 'Hello' })
buffer.push({ role: 'assistant', content: 'Hi!' })
console.log(buffer.toArray())
// [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi!' }]
\\`\\`\\`

### TokenBudget
自动计算并管理 token 预算：

\\`\\`\\`typescript
import { TokenBudget, parseTokenBudget } from 'claude-code-sdk-ts'

// 解析预算字符串
const budget = parseTokenBudget('100K') // { maxTokens: 100000 }
const budget2 = parseTokenBudget('50%') // 按比例

// 获取预算续言消息
const continuation = getBudgetContinuationMessage(budget)
\\`\\`\\`

### AutoCompactor
当对话接近 token 预算上限时自动压缩历史：

\\`\\`\\`typescript
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
\\`\\`\\`

### MicroCompactor
用于更细粒度的消息级压缩：

\\`\\`\\`typescript
import { MicroCompactor } from 'claude-code-sdk-ts'

const micro = new MicroCompactor({ maxTokens: 80000 })
const compacted = await micro.compactIfNeeded(messages, currentTokens)
\\`\\`\\`

## ConversationManager 完整示例

\\`\\`\\`typescript
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
console.log(\\`当前上下文约 \\\${tokens} tokens\\`)
\\`\\`\\`
`,
  ["core-concepts/sdk-overview"]: `# SDK 架构概览

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
| **高级 API 层** | 屏蔽底层复杂性，提供 \\`ask()\\`/\\`askStream()\\` 简洁接口 | 服务员 |
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
`,
  ["core-concepts/session-engine"]: `# Session Engine

Session Engine 是 SDK 的核心会话管理模块，负责管理独立的对话会话。

## 基本使用

\\`\\`\\`typescript
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
\\`\\`\\`

## 会话配置

\\`\\`\\`typescript
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
\\`\\`\\`

## 会话持久化

\\`\\`\\`typescript
import { SessionPersistence } from 'claude-code-sdk-ts'

// 列出所有保存的会话
const sessions = await SessionPersistence.list('./sessions')
console.log(sessions)
// [{ id: 'abc123', createdAt: '2024-...', messageCount: 5 }]

// 恢复会话
const session = await SessionPersistence.restore('./sessions/abc123.json', sdk)
const response = await sdk.send('Continue from where we left off')
\\`\\`\\`

## 归因 (Attribution)

归因组件追踪每个消息的来源，便于审计和调试：

\\`\\`\\`typescript
const snapshots = session.getAttributionSnapshots()
snapshots.forEach(s => {
  console.log(\\`Turn \\\${s.turn}: \\\${s.mode} (\\\${s.sources.join(', ')})\\`)
})
\\`\\`\\`
`,
  ["core-concepts/tool-system"]: `# 工具系统

工具系统是 SDK 的核心能力之一，允许 Claude 调用外部工具来完成任务。

## 工具注册

\\`\\`\\`typescript
import { ToolRegistry, createTool, BaseTool } from 'claude-code-sdk-ts'
import { z } from 'zod'

// 通过工厂函数创建工具
const myTool = createTool({
  name: 'my_tool',
  description: '我的自定义工具',
  inputSchema: z.object({
    input: z.string().describe('输入参数'),
  }),
  execute: async (input) => {
    return { result: \\`处理: \\\${input.input}\\` }
  },
})

// 注册到注册表
const registry = new ToolRegistry()
registry.register(myTool)
\\`\\`\\`

## 继承 BaseTool

更复杂的工具可以通过继承 \\`BaseTool\\` 实现：

\\`\\`\\`typescript
import { BaseTool } from 'claude-code-sdk-ts'
import { z } from 'zod'

class CalculatorTool extends BaseTool {
  name = 'calculator'
  description = '执行数学计算'
  inputSchema = z.object({
    expression: z.string().describe('数学表达式'),
  })

  async execute(input: { expression: string }) {
    try {
      const result = Function(\\`'use strict'; return (\\\${input.expression})\\`)()
      return { result: String(result) }
    } catch (err) {
      return { error: \\`计算失败: \\\${(err as Error).message}\\` }
    }
  }
}

// 注册
registry.register(new CalculatorTool())
\\`\\`\\`

## 内置工具

SDK 提供 8 个内置工具，通过 \\`registerAllBuiltInTools()\\` 批量注册：

\\`\\`\\`typescript
import { registerAllBuiltInTools } from 'claude-code-sdk-ts'

const registry = new ToolRegistry()
registerAllBuiltInTools(registry)
// 注册: BashTool, FileReadTool, FileWriteTool, FileEditTool,
//       GlobTool, GrepTool, WebFetchTool, WebSearchTool
\\`\\`\\`

## 工具调用流程

\\`\\`\\`
用户请求
    │
    ▼
LLM 分析 → 决定调用工具
    │
    ▼
权限系统检查 (auto/manual/bypass/plan)
    │
    ▼
工具执行
    │
    ▼
结果返回给 LLM
    │
    ▼
LLM 生成最终回复
\\`\\`\\`

## 设计理念：插件化工具系统

工具系统的设计借鉴了**插件架构（Plugin Architecture）**的思想：

1. **统一接口** — 每个工具实现 \\`BaseTool\\` 抽象类，SDK 不关心工具内部实现，只通过 \\`name\\`/\\`description\\`/\\`schema\\`/\\`execute\\` 四个接口交互
2. **即插即用** — 工具通过 \\`ToolRegistry\\` 注册/注销，无需修改 SDK 核心代码即可增减功能
3. **MCP 协议** — 外部工具通过 MCP（Model Context Protocol）标准化协议接入，进一步放宽了工具的来源
4. **权限解耦** — 工具的「执行逻辑」与「安全策略」分离：工具只关心「怎么做」，权限系统决定「能不能做」

这种设计带来的实际好处：
- 社区可以贡献新的内置工具，无需修改核心库
- 企业可以开发内部工具并通过 MCP 服务器暴露
- 测试时可以直接 mock 工具的行为

## MCP 协议工具

通过 MCP 协议集成外部工具服务器：

\\`\\`\\`typescript
import { MCPServerManager, adaptMCPTool } from 'claude-code-sdk-ts'

const manager = new MCPServerManager()

// 添加 MCP 服务器
await manager.addServer({
  name: 'my-server',
  transport: 'stdio',
  command: 'node',
  args: ['./mcp-server.js'],
})

// 获取所有可用的 MCP 工具
const mcpTools = manager.getTools()
for (const mcpTool of mcpTools) {
  const adapted = adaptMCPTool(mcpTool)
  registry.register(adapted)
}
\\`\\`\\`
`,
  ["examples/basic-chat"]: `# 基本对话

最简单的 SDK 使用方式 — 发送消息并获取回复。

## 完整代码

\\`\\`\\`typescript
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
\\`\\`\\`

**输出：**

\\`\\`\\`
AI: SDK（Software Development Kit，软件开发工具包）是一组工具、库和文档的集合，
帮助开发者更快地为特定平台或服务构建应用。
\\`\\`\\`

## 多轮对话 — AI 记住上下文

SDK 的 Session 会自动维护对话历史，AI 能记住之前说过的话：

\\`\\`\\`typescript
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
  // AI: 你叫小明，刚才你告诉我的 \\u{1F60A}

  // 第三轮：更复杂的追问
  const r3 = await sdk.send('我多大了？')
  console.log('AI:', r3.content)
  // AI: 你今年 25 岁。
}

chat()
\\`\\`\\`

> \\u{1F4A1} **关键点**：Session 自动把之前的对话历史传给 AI，所以你不需要手动拼接上下文。

## 使用 \\`ask()\\` 简化

如果只需要一轮对话，\\`ask()\\` 是最简洁的方式：

\\`\\`\\`typescript
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
\\`\\`\\`

## 错误处理

如果请求失败，SDK 会自动重试（默认最多 3 次）：

\\`\\`\\`typescript
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
\\`\\`\\`

## 底层机制：流式与非流式的区别

SDK 默认使用**流式（SSE）**传输，无论你调用 \\`sdk.send()\\` 还是 \\`sdk.stream()\\`。

### SSE（Server-Sent Events）的工作原理

\\`\\`\\`
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
\\`\\`\\`

**什么时候用流式，什么时候用非流式？**

| 场景 | 推荐方式 | 原因 |
|------|---------|------|
| 生成长文本（文章、代码） | \\`sdk.stream()\\` 流式 | 用户无需等待全部生成，逐字看到输出 |
| 需要完整结果再处理 | \\`sdk.send()\\` + \\`response.content\\` | 内部流式聚合，外部拿到完整文本 |
| UI 实时显示 + 需要完整结果 | \\`sdk.stream()\\` + \\`StreamConsumer\\` | 同时满足实时和聚合需求 |
| 简单一问一答 | \\`sdk.send()\\` | 简便，SDK 内部自动管理 |

### Token 消耗与上下文管理

每次对话不仅有**本次的 token 消耗**，还有**历史上下文的累积消耗**：

\\`\\`\\`
第 1 轮: 发送 50 tokens → 回复 200 tokens → 总计 250
第 2 轮: 发送 50 + 历史 250 = 300 → 回复 200 → 总计 500
第 10 轮: 发送 50 + 历史 4250 = 4300 → ... 
\\`\\`\\`

当历史过长时，SDK 的 [Conversation Manager](/core-concepts/conversation) 自动执行：
1. **Micro-Compact** — 压缩单条过长的消息（截断代码片段、简化日志）
2. **Auto-Compact** — 将早期对话轮次智能总结为摘要
3. **Token Budget** — 跟踪预算使用百分比，触发自动压缩

## 进阶：自定义模型参数

\\`\\`\\`typescript
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
\\`\\`\\`

## 完整 API 参考

- [Session Engine](/core-concepts/session-engine) — 深入了解 Session
- [Conversation Manager](/core-concepts/conversation) — 对话状态管理
- [错误处理](/advanced/error-handling) — 重试和超时配置
`,
  ["examples/mcp-integration"]: `# MCP 集成

集成 MCP (Model Context Protocol) 工具服务器的完整示例。

## 文件系统服务器

\\`\\`\\`typescript
import { ClaudeCodeSDK, MCPServerManager, adaptMCPTool, ToolRegistry } from 'claude-code-sdk-ts'

async function main() {
  // 1. 创建 MCP 服务器管理器
  const manager = new MCPServerManager()

  // 2. 添加文件系统 MCP 服务器
  await manager.addServer({
    name: 'fs',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', './data'],
  })

  // 3. 适配 MCP 工具
  const registry = new ToolRegistry()
  for (const mcpTool of manager.getTools()) {
    registry.register(adaptMCPTool(mcpTool))
  }

  // 4. 创建 SDK 并使用
  const sdk = new ClaudeCodeSDK({
    llm: {
      provider: 'anthropic',
    baseUrl: 'https://api.deepseek.com/anthropic',
      apiKey: process.env.DEEPSEEK_API_KEY!,
    },
  })

  const response = await sdk.send('List files in the data directory')
  console.log(response.content)
}
\\`\\`\\`

## 多个 MCP 服务器

\\`\\`\\`typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: { provider: 'anthropic', apiKey: process.env.DEEPSEEK_API_KEY! },
    baseUrl: 'https://api.deepseek.com/anthropic',
  mcpServers: [
    {
      name: 'database',
      transport: 'stdio',
      command: 'node',
      args: ['./mcp-db-server.js'],
    },
    {
      name: 'weather',
      transport: 'url',
      url: 'https://weather-mcp.example.com/sse',
    },
  ],
})

// MCP 工具自动注册到 SDK
const response = await sdk.send('Query the database for recent users')
console.log(response.content)
\\`\\`\\`
`,
  ["examples/streaming"]: `# 流式对话

使用流式 API 实时获取 LLM 响应，适合聊天界面、打字机效果等场景。

## 基础流式 — 逐字输出

\\`\\`\\`typescript
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
  const stream = sdk.stream('讲一个程序员的笑话')

  for await (const event of stream) {
    if (event.type === 'text') {
      process.stdout.write(event.text)
    }
  }
}

main()
\\`\\`\\`

**效果**：文字会逐字打印出来，像打字机一样：
\\`\\`\\`
为...什么...程...序...员...分...不...清...万...圣...节...和...圣...诞...节？
因...为... Oct 31 == Dec 25
\\`\\`\\`

## StreamConsumer — 灵活的流式处理

\\`\\`\\`typescript
import { ClaudeCodeSDK, createStreamConsumer } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'anthropic',
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: process.env.DEEPSEEK_API_KEY!,
    model: 'deepseek-v4-flash',
  },
})

const stream = sdk.stream('用中文写一首五言绝句')
const consumer = createStreamConsumer(stream)

// 方式 1: 文本流（逐段输出）
for await (const text of consumer.toTextStream()) {
  process.stdout.write(text)
}

// 方式 2: 块流（含 tool_use 信息）
const stream2 = sdk.stream('搜索当前目录的文件')
const consumer2 = createStreamConsumer(stream2)
for await (const block of consumer2.toBlockStream()) {
  if (block.type === 'text') {
    console.log('文本:', block.text)
  } else if (block.type === 'tool_use') {
    console.log(\\`调用工具: \\\${block.name}\\`)
    console.log(\\`参数:\\`, block.input)
  }
}
// 调用工具: GlobTool
// 参数: { pattern: '*', path: '.' }

// 方式 3: 事件订阅
consumer.on('text', (event) => process.stdout.write(event.text))
consumer.on('done', (usage) => {
  console.log('Token 用量:', usage)
  // Token 用量: { inputTokens: 45, outputTokens: 128 }
})

// 方式 4: 聚合为完整结果
const result = await consumer.toPromise()
console.log('完整文本:', result.text)
console.log('Token 用量:', result.usage)
\\`\\`\\`

**\\`toPromise()\\` 输出示例：**

\\`\\`\\`
完整文本: 床前明月光，疑是地上霜。举头望明月，低头思故乡。
Token 用量: { inputTokens: 45, outputTokens: 128 }
\\`\\`\\`

## askStream() — 流式 + 自动工具执行

\\`askStream()\\` 是流式 + 自动工具执行的高级 API，适合需要 AI 自动调用工具的场景：

\\`\\`\\`typescript
import { ClaudeCodeSDK, askStream, ToolRegistry, registerAllBuiltInTools } from 'claude-code-sdk-ts'

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

async function main() {
  for await (const event of askStream(sdk.getLLM(), {
    systemPrompt: 'You have file system access.',
    messages: [{ role: 'user', content: '列出当前目录的文件' }],
    tools: registry,
  })) {
    if (event.type === 'text') {
      process.stdout.write(event.text)
    } else if (event.type === 'tool_call') {
      console.log(\\`\\\\n[调用工具: \\\${event.toolName}]\\`)
    } else if (event.type === 'result') {
      console.log('\\\\n✅ 完成!')
    }
  }
}

main()
\\`\\`\\`

**输出示例：**

\\`\\`\\`
[调用工具: GlobTool]
当前目录包含以下文件：

├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   └── utils.ts
└── README.md

✅ 完成!
\\`\\`\\`

## 对比：流式 vs 非流式

| 方式 | 适用场景 | 特点 |
|------|----------|------|
| \\`sdk.send()\\` | 需要完整结果 | 等待全部返回 |
| \\`sdk.stream()\\` + \\`for await\\` | 实时展示 | 逐字输出，用户无需等待 |
| \\`askStream()\\` | 工具自动调用 | 流式 + 工具执行一体化 |

## 下一步

- [工具调用](/examples/tool-usage) — 让 AI 自动执行命令
- [Conversation Manager](/core-concepts/conversation) — 对话状态管理
`,
  ["examples/tool-usage"]: `# 工具调用

让 AI 自动调用工具完成任务的完整示例。SDK 内置 8 个工具，开箱即用。

## 读取文件并分析

\\`\\`\\`typescript
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
\\`\\`\\`

**输出示例：**

\\`\\`\\`
AI: 这个项目使用了以下依赖：

主要依赖：
- claude-code-sdk-ts：SDK 核心库
- zod：运行时数据验证
- ...（其他依赖）

AI 在回答前自动调用了 FileReadTool 来读取 package.json 文件内容。
\\`\\`\\`

## 执行 Shell 命令

\\`\\`\\`typescript
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
\\`\\`\\`

**输出示例：**

\\`\\`\\`
AI: 当前目录磁盘用量如下：

总用量 4.0M
drwxr-xr-x  38 user user  1.2K  node_modules/
-rw-r--r--   1 user user   380  package.json
-rw-r--r--   1 user user   226  tsconfig.json
...

AI 内部调用了 BashTool 来执行 du -sh * 命令。
\\`\\`\\`

## 搜索代码文件

\\`\\`\\`typescript
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
\\`\\`\\`

**输出示例：**

\\`\\`\\`
找到以下包含 "createTool" 的 TypeScript 文件：

src/tool-creation.ts:     15: export function createTool(name: string)
src/registry.ts:          42: registry.createTool('myTool')
src/built-in/bash.ts:      8: createTool({ name: 'BashTool', ... })
src/built-in/glob.ts:      8: createTool({ name: 'GlobTool', ... })

AI 先调用 GlobTool 查找所有 .ts 文件，再调用 GrepTool 搜索关键词。
\\`\\`\\`

## 自定义工具

你也可以注册自己的工具：

\\`\\`\\`typescript
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
    const result = Function(\\`'use strict'; return (\\\${input.expression})\\`)()
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
  const response = await sdk.send('账单 \$47.50，15% 小费是多少？')
  console.log('AI:', response.content)
}

main()
\\`\\`\\`

**输出示例：**

\\`\\`\\`
AI: 15% 的小费是 \$7.13。

计算过程：\$47.50 \\xD7 15% = \$47.50 \\xD7 0.15 = \$7.125 ≈ \$7.13
\\`\\`\\`

## 可用内置工具

| 工具 | 用途 | 安全等级 |
|------|------|----------|
| \\`BashTool\\` | 执行 Shell 命令 | ⚠️ 高风险 |
| \\`FileReadTool\\` | 读取文件内容 | ✅ 低风险 |
| \\`FileWriteTool\\` | 创建/覆盖文件 | ⚠️ 中风险 |
| \\`FileEditTool\\` | 精确替换文件内容 | ⚠️ 中风险 |
| \\`GlobTool\\` | 搜索文件路径 | ✅ 低风险 |
| \\`GrepTool\\` | 搜索文件内容 | ✅ 低风险 |
| \\`WebFetchTool\\` | 抓取网页内容 | ✅ 低风险 |
| \\`WebSearchTool\\` | 联网搜索 | ✅ 低风险 |

## 下一步

- [工具系统详解](/core-concepts/tool-system) — 深入了解工具注册和执行的完整流程
- [权限系统](/advanced/permission-system) — 控制哪些工具可以执行
- [MCP 集成](/examples/mcp-integration) — 集成外部工具服务器
`,
  ["getting-started/configuration"]: `# 配置说明

SDK 支持从多种来源加载配置，按优先级从低到高排列：

1. **默认值** — 内置默认配置
2. **配置文件** — JSON 文件
3. **环境变量** — 操作系统环境
4. **编程覆盖** — 代码中直接传入

## 基础配置

\\`\\`\\`typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'anthropic',
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: process.env.DEEPSEEK_API_KEY!,
    model: 'deepseek-v4-flash',
    maxTokens: 8192,
    temperature: 0.7,
  },
  // 权限模式
  permissionMode: 'auto', // 'auto' | 'manual' | 'bypass' | 'plan'
  // 默认启用所有内置工具
  defaultTools: true,
})
\\`\\`\\`

## ConfigManager

使用 ConfigManager 可以更精细地管理配置：

\\`\\`\\`typescript
import { ConfigManager } from 'claude-code-sdk-ts'

const config = new ConfigManager()

// 从文件加载
config.loadFromFile('./claude-code-sdk.json')

// 从环境变量加载
config.mergeFromEnv()

// 编程更新
config.update({
  llm: { provider: 'vertex', projectId: 'my-project' },
})

// 获取配置
const current = config.getConfig()
console.log(current.llm.provider) // 'vertex'
\\`\\`\\`

## 配置验证

\\`\\`\\`typescript
import { sdkConfigSchema } from 'claude-code-sdk-ts/config'

const result = sdkConfigSchema.safeParse(myConfig)
if (!result.success) {
  console.error('配置验证失败:', result.error.issues)
  // [
  //   { path: ['llm', 'apiKey'], message: 'Required' },
  //   { path: ['llm', 'provider'], message: "Expected 'anthropic' | 'bedrock' | 'vertex' | 'foundry'" }
  // ]
}
\\`\\`\\`

## 配置优先级

\\`\\`\\`typescript
const config = new ConfigManager()

// 按优先级合并多个来源
config.loadFromSources({
  filePath: './settings.json',  // 低优先级
  env: process.env,             // 中优先级
  cliArgs: {                    // 高优先级
    permissionMode: 'bypass',
  },
})
\\`\\`\\`

## 环境变量对照

| 环境变量 | 对应配置项 | 示例 |
|----------|-----------|------|
| \\`DEEPSEEK_API_KEY\\` | \\`llm.apiKey\\` | \\`sk-...\\` |
| \\`DEEPSEEK_MODEL\\` | \\`llm.model\\` | \\`deepseek-v4-flash\\` |
| \\`DEEPSEEK_BASE_URL\\` | \\`llm.baseUrl\\` | \\`https://api.deepseek.com/anthropic\\` |
| \\`AWS_ACCESS_KEY_ID\\` | \\`llm.accessKeyId\\` | Bedrock 凭证 |
| \\`AWS_SECRET_ACCESS_KEY\\` | \\`llm.secretAccessKey\\` | Bedrock 凭证 |
| \\`ANTHROPIC_VERTEX_PROJECT_ID\\` | \\`llm.projectId\\` | Vertex 项目 ID |
| \\`CLAUDE_CODE_PERMISSION_MODE\\` | \\`permissionMode\\` | \\`auto/manual/bypass/plan\\` |

## 进阶配置（Phase 3D+）

### EffortLevel 思考深度

控制 AI 的思考/推理深度，影响回答质量和延迟：

\\`\\`\\`typescript
import type { EffortLevel } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: { provider: 'anthropic', baseUrl: 'https://api.deepseek.com/anthropic', apiKey: process.env.DEEPSEEK_API_KEY!, model: 'deepseek-v4-flash' },
  effort: 'high',  // 'low' | 'medium' | 'high'
})
\\`\\`\\`

| 级别 | 说明 | 适用场景 |
|------|------|---------|
| \\`low\\` | 快速响应，推理更少 | 简单问答、闲聊 |
| \\`medium\\` | 平衡质量与速度（默认） | 日常编码辅助 |
| \\`high\\` | 深度推理，更详细 | 复杂逻辑、架构设计 |

### AgentDefinition 自定义 Agent

定义可调用的子 Agent：

\\`\\`\\`typescript
import type { AgentDefinition } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: { provider: 'anthropic', baseUrl: 'https://api.deepseek.com/anthropic', apiKey: process.env.DEEPSEEK_API_KEY!, model: 'deepseek-v4-flash' },
  agents: {
    'code-reviewer': {
      description: 'Code review specialist agent',
      systemPrompt: 'You are a senior code reviewer...',
      tools: ['FileRead', 'Grep', 'Glob'],
      model: 'deepseek-v4-flash',
    },
  },
})
\\`\\`\\`

### FastMode 快速模式

并发工具执行状态管理：

\\`\\`\\`typescript
import { isFastModeEnabled, type FastModeState } from 'claude-code-sdk-ts'

const state: FastModeState = { enabled: true, concurrency: 3 }

if (isFastModeEnabled(state)) {
  console.log('FastMode 已启用，最多 3 个并发工具调用')
}
\\`\\`\\`

### PermissionUpdate 权限更新

动态更新权限规则：

\\`\\`\\`typescript
import { applyPermissionUpdate, createPermissionUpdateContext, type PermissionUpdate } from 'claude-code-sdk-ts'

const context = createPermissionUpdateContext('auto')

const update: PermissionUpdate = {
  type: 'addRules',
  rules: [{ toolName: 'Bash', decision: 'allow' }],
  destination: 'session',
}

const updated = applyPermissionUpdate(context, update)
\\`\\`\\`
`,
  ["getting-started/installation"]: `# 安装

## 系统要求

- **Node.js** ≥ 18.x（LTS）
- **TypeScript** ≥ 5.0
- **ESM** — SDK 仅支持 ES Module 项目

## 设计理念：为什么用 DeepSeek 做默认 Provider？

SDK 默认使用 **DeepSeek** 的 Anthropic 兼容接口，而非直接接入 Anthropic Claude：

- **价格优势** — DeepSeek API 成本约为原生 Anthropic Claude 的 1/20，适合开发测试和高频调用场景
- **即开即用** — 无需申请 Anthropic 密钥、无需通过企业审批，注册 DeepSeek 即可获得 API Key
- **协议兼容** — DeepSeek 实现了标准的 Anthropic Messages API，SDK 零适配即可通信
- **灵活性** — 如需切换回原生 Anthropic 或其他 Provider，只需修改 \\`provider\\`/\\`baseUrl\\`/\\`apiKey\\` 三个字段

> \\u{1F4A1} SDK 的多 Provider 架构（见 [LLM Provider 配置](/getting-started/configuration)）使得换底层模型只需改配置，代码零改动。这也是「关注点分离」的设计体现——业务逻辑与模型服务解耦。

## 设计理念：零运行时设计

Claude Code SDK **不依赖 Claude Code 运行时环境**，这是 SDK 最根本的设计决策：

- **独立运行** — SDK 是纯 TypeScript 库，可以在任何 Node.js 环境中运行（CI/CD、Edge Function、桌面应用）
- **无隐式依赖** — 不读取 \\`.claude/settings.json\\`、不依赖系统安装的 Claude Code 二进制文件
- **可测试性** — 因为不依赖外部运行时，单元测试和集成测试都可以在隔离环境中运行
- **Tree-shakeable** — 只引用需要的模块，不影响打包体积

## npm 安装

\\`\\`\\`bash
npm install claude-code-sdk-ts
\\`\\`\\`

## 获取 API 密钥

SDK 通过 **DeepSeek** 的 Anthropic 兼容接口调用 AI 模型，需要先获取 DeepSeek API 密钥：

1. 前往 [platform.deepseek.com](https://platform.deepseek.com) 注册账号
2. 在 API Keys 页面创建新的密钥
3. 复制密钥（格式为 \\`sk-xxxxxxxxxxxx\\`）

配置方式有两种：

**方式一：环境变量**

\\`\\`\\`bash
export DEEPSEEK_API_KEY=sk-your-deepseek-api-key-here
\\`\\`\\`

**方式二：代码中直接传入**

\\`\\`\\`typescript
import { ClaudeCodeSDK, VERSION } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'anthropic',                       // DeepSeek 的 Anthropic 兼容接口
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: 'sk-your-deepseek-api-key-here',
    model: 'deepseek-v4-flash',
  },
})
\\`\\`\\`

## 验证安装

运行以下代码验证 SDK 是否正常工作：

\\`\\`\\`typescript
import { ClaudeCodeSDK, VERSION } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'anthropic',
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: process.env.DEEPSEEK_API_KEY!,
    model: 'deepseek-v4-flash',
  },
})

console.log('SDK 版本:', VERSION)
// SDK 版本: 0.5.0
\\`\\`\\`

### 完整验证（发送一条真实消息）

\\`\\`\\`typescript
import { ClaudeCodeSDK, VERSION } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'anthropic',
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: process.env.DEEPSEEK_API_KEY!,
    model: 'deepseek-v4-flash',
  },
})

const response = await sdk.send('Hello!')
console.log('AI 回复:', response.content)
// AI 回复: Hello! How can I help you today?
\\`\\`\\`

## 下一步

完成安装后，请阅读 [5 分钟快速上手](/getting-started/quick-start) 开始使用 SDK。

## 设计细节：为什么 ask() 需要 ToolRegistry 参数？

细心的读者可能注意到 \\`ask()\\` 函数即使不需要工具也要传 \\`new ToolRegistry()\\`。这背后是**明确性原则**：

- \\`ask()\\` 内部使用工具系统驱动 AI 的推理循环（工具结果 → 下一轮推理 → 再尝试工具），整个流程依赖于 ToolRegistry
- 即使没有注册任何工具，空的 ToolRegistry 也能为 \\`ask()\\` 提供标准的「无工具」合约
- 这样设计的好处是内部代码路径统一：无论有没有工具，\\`ask()\\` 的执行逻辑完全一致

> 在 SDK 的未来版本中，我们计划将 \\`tools\\` 改为可选参数，内部默认构造空 ToolRegistry。

## 可选依赖

根据不同 Provider，可能需要安装额外的包：

| Provider | 包名 |
|----------|------|
| AWS Bedrock | \\`@anthropic-ai/bedrock-sdk\\` |
| Google Vertex AI | \\`@anthropic-ai/vertex-sdk\\` |
| Anthropic Foundry | \\`@anthropic-ai/foundry-sdk\\` |

> \\u{1F4A1} **开源地址** — 源码和贡献指南请访问 [github.com/DZCD/claude-code-sdk](https://github.com/DZCD/claude-code-sdk)
`,
  ["getting-started/quick-start"]: `# 5 分钟快速上手

本教程将带你从零开始完成一个完整的 SDK 使用流程。每个步骤都附带**输入 → 输出**示例。

---

## 1. 初始化项目

\\`\\`\\`bash
mkdir my-claude-app && cd my-claude-app
npm init -y
npm install claude-code-sdk-ts typescript @types/node
npx tsc --init --target ES2022 --module ESNext --moduleResolution bundler
\\`\\`\\`

## 2. 设置 API 密钥

SDK 使用 **DeepSeek** 的 Anthropic 兼容接口，配置简单：

\\`\\`\\`bash
export DEEPSEEK_API_KEY=sk-your-deepseek-api-key-here
\\`\\`\\`

你也可以在 \\`.env\\` 文件中管理（推荐）：

\\`\\`\\`bash
echo "DEEPSEEK_API_KEY=sk-your-deepseek-api-key-here" > .env
\\`\\`\\`

## 3. Hello World — 你的第一段对话

创建 \\`index.ts\\`：

\\`\\`\\`typescript
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
\\`\\`\\`

运行：

\\`\\`\\`bash
npx tsx index.ts
\\`\\`\\`

**输出示例：**

\\`\\`\\`
AI: SDK（Software Development Kit，软件开发工具包）是一组工具、库和文档的集合，帮助开发者更快地为特定平台或服务构建应用。
\\`\\`\\`

> \\u{1F4A1} **看到上面的输出了吗？** 从安装到首次对话，只需要 3 步。

## 4. 使用 \\`ask()\\` 快速对话

\\`ask()\\` 是比 \\`Session\\` 更轻量的方式，自动完成一轮对话：

\\`\\`\\`typescript
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
\\`\\`\\`

**输出示例：**

\\`\\`\\`
TypeScript 和 JavaScript 最大的区别是类型系统。TypeScript 是 JavaScript 的超集，
增加了静态类型检查，能在开发阶段捕捉类型错误，提高代码质量和可维护性。
\\`\\`\\`

> \\u{1F4A1} **设计思路：\\`ask()\\` vs \\`Session.send()\\`**
>
> 看到这里你可能会问：什么时候用 \\`ask()\\`，什么时候用 \\`Session\\`？
> - **\\`ask()\\`** — 一次性对话。适合「单轮问答」「快速测试」「简单的工具调用」。内部自动创建一个临时会话，用完即弃，无需管理生命周期。
> - **\\`Session.send()\\`** — 多轮对话。适合「需要记忆上下文的聊天」「逐步引导的推理任务」。Session 会累积对话历史，让你能**分多次调用**与 AI 交互。
>
> 简单规则：**一次提问用 ask()，多次对话用 session.send()**。

## 5. 多轮对话 — 上下文自动累积

SDK 的 \\`Session\\` 会自动累积对话历史，无需手动管理上下文：

\\`\\`\\`typescript
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
  // AI: 你叫小明，刚才你告诉我的 \\u{1F60A}
}

chat()
\\`\\`\\`

> \\u{1F4A1} **关键点**：第二次发送时，Session 自动把第一次的对话历史传给了 AI，所以 AI 记得你的名字。

> \\u{1F4A1} **背后原理：对话历史管理**
>
> 每次调用 \\`sdk.send()\\` 时，SDK 自动将本次的「用户消息 + AI 回复」追加到对话历史中，并在下一次请求时全部发送给 LLM。
>
> 这意味着：**对话轮次越多，token 消耗越大**。当对话积累到数万 token 时，SDK 的 [Conversation Manager](/core-concepts/conversation) 会自动启用 **Auto-Compact**（智能压缩早期对话）来节省预算，确保长对话不会因为 token 超限而中断。

## 6. 使用工具 — AI 帮你执行命令

让 AI 自动调用工具来完成任务：

\\`\\`\\`typescript
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
\\`\\`\\`

**输出示例：**

\\`\\`\\`
当前目录包含以下文件：

├── index.ts
├── package.json
├── tsconfig.json
└── node_modules/
\\`\\`\\`

> \\u{1F4A1} 当 AI 需要执行命令时，SDK 会自动调用 BashTool 来执行 \\`ls\\`、\\`cat\\` 等命令，并把结果返回给 AI 生成最终回复。

## 下一步

- [核心概念 → SDK 架构概览](/core-concepts/sdk-overview) — 了解 SDK 的内部结构
- [基本对话示例](/examples/basic-chat) — 更多对话模式
- [配置说明](/getting-started/configuration) — 深入了解配置选项
- [GitHub 开源地址](https://github.com/DZCD/claude-code-sdk) — 源码和贡献指南
`,
  ["llm-providers/anthropic"]: `# DeepSeek (Anthropic 兼容)

DeepSeek 是 SDK 推荐的 LLM Provider，通过 **Anthropic 兼容 API** 接入。使用 \\`provider: 'anthropic'\\` 配置，指向 DeepSeek 的 API 端点即可。

## 为什么用 DeepSeek？

- **价格更低** — DeepSeek 的 API 价格远低于原生 Anthropic
- **兼容性好** — 支持 Anthropic Messages API 格式，SDK 直接适配
- **模型能力** — \\`deepseek-v4-flash\\` 在推理任务上表现优秀

## 配置

\\`\\`\\`typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'anthropic',                       // 固定使用 anthropic 作为 provider
    baseUrl: 'https://api.deepseek.com/anthropic', // DeepSeek 兼容端点
    apiKey: process.env.DEEPSEEK_API_KEY!,
    model: 'deepseek-v4-flash',
    maxTokens: 8192,
    temperature: 0.7,
  },
})
\\`\\`\\`

### 验证配置是否生效

\\`\\`\\`typescript
const response = await sdk.send('1+1=？')
console.log(response.content)
// 1+1=2
\\`\\`\\`

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| \\`DEEPSEEK_API_KEY\\` | 是 | DeepSeek API 密钥 |
| \\`DEEPSEEK_MODEL\\` | 否 | 模型名称（默认 deepseek-v4-flash） |
| \\`DEEPSEEK_BASE_URL\\` | 否 | API 基础地址（默认 https://api.deepseek.com/anthropic） |

## 支持模型

- \\`deepseek-v4-flash\\`（默认，推荐）
- \\`deepseek-v4\\`（完整版，速度较慢但更强）

## 流式响应

\\`\\`\\`typescript
import { ClaudeCodeSDK, createStreamConsumer } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'anthropic',
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: process.env.DEEPSEEK_API_KEY!,
    model: 'deepseek-v4-flash',
  },
})

// 方式 1: 直接消费文本流
const stream = sdk.stream('写一个简短的故事')
for await (const event of stream) {
  if (event.type === 'text') {
    process.stdout.write(event.text)
  }
}
// 输出（逐字打印）: 从前有座山，山里有座庙...

// 方式 2: 聚合为完整结果
const consumer = createStreamConsumer(sdk.stream('讲个笑话'))
const result = await consumer.toPromise()
console.log(result.text)
// 为什么程序员分不清万圣节和圣诞节？因为 Oct 31 == Dec 25
\\`\\`\\`

## 多 Provider 适配层的价值

SDK 的 LLM 连接器层是**一次集成，到处运行**的最佳实践：

\\`\\`\\`
          ┌─────────────┐
          │  你的代码     │
          └──────┬──────┘
                 │ 统一的 LLMConnector 接口
                 ▼
     ┌───────────────────────┐
     │    LLM 连接器层        │
     ├───────────────────────┤
     │ Anthropic │ Bedrock   │
     │ Vertex    │ Foundry   │
     └───────────────────────┘
                 │ 各自的 SDK/API
                 ▼
     DeepSeek   AWS   GCP   Anthropic
\\`\\`\\`

**带来的核心价值：**

- **切换零成本** — 从 DeepSeek 迁移到 Bedrock 只需改 \\`provider\\` 字段，不需要改任何业务代码
- **统一体验** — 无论底层是哪个 Provider，\\`send()\\`、\\`stream()\\`、工具调用等 API 完全一致
- **渐进式增强** — 测试阶段用便宜的 DeepSeek，上线后用 Bedrock/Vertex 的企业级 SLA
- **故障隔离** — 如果某个 Provider 宕机，可以快速切换到备选 Provider，不影响业务

## 其他 Provider

SDK 也支持其他 Anthropic 兼容或原生 Provider：

- [AWS Bedrock](/llm-providers/bedrock) — 通过 AWS 使用 Claude
- [Google Vertex AI](/llm-providers/vertex) — 通过 GCP 使用 Claude
- [Anthropic Foundry](/llm-providers/foundry) — 原生 Anthropic 企业版
`,
  ["llm-providers/bedrock"]: `# AWS Bedrock Provider

通过 AWS Bedrock 使用 Claude 模型。

## 配置

\\`\\`\\`typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'bedrock',
    model: 'anthropic.deepseek-v4-flash',
    region: 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})
\\`\\`\\`

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| \\`AWS_ACCESS_KEY_ID\\` | 推荐 | AWS 访问密钥 |
| \\`AWS_SECRET_ACCESS_KEY\\` | 推荐 | AWS 秘密密钥 |
| \\`AWS_REGION\\` | 否 | 区域（默认 us-east-1） |

## 使用 IAM Role

如果你使用 IAM Role（如在 EC2 上），可以省略凭证：

\\`\\`\\`typescript
const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'bedrock',
    model: 'anthropic.deepseek-v4-flash',
    region: 'ap-northeast-1',
  },
})
\\`\\`\\`

SDK 会自动使用 AWS 默认凭证链（环境变量 → 配置文件 → IAM Role）。
`,
  ["llm-providers/foundry"]: `# Anthropic Foundry Provider

通过 Anthropic Foundry 平台使用 Claude 模型。

## 配置

\\`\\`\\`typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'foundry',
    resourceName: 'organizations/my-org/projects/my-project',
    apiKey: process.env.FOUNDRY_API_KEY!,
    model: 'deepseek-v4-flash',
  },
})
\\`\\`\\`

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| \\`FOUNDRY_API_KEY\\` | 否 | Foundry API 密钥 |
| \\`resourceName\\` | 是 | Foundry 资源路径 |

## 适用场景

Foundry 适用于企业级部署，提供：
- 更高的 API 配额
- 专用的计算资源
- 企业级安全合规
- 自定义模型部署
`,
  ["llm-providers/vertex"]: `# Google Vertex AI Provider

通过 Google Vertex AI 使用 Claude 模型。

## 配置

\\`\\`\\`typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'vertex',
    projectId: process.env.ANTHROPIC_VERTEX_PROJECT_ID!,
    model: 'deepseek-v4-flash',
    region: 'us-east5',
  },
})
\\`\\`\\`

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| \\`ANTHROPIC_VERTEX_PROJECT_ID\\` | 是 | GCP 项目 ID |
| \\`CLOUD_ML_REGION\\` | 否 | 区域（默认 us-east5） |

## 认证

Vertex AI 使用 Google Cloud 应用默认凭证 (ADC) 进行认证：

\\`\\`\\`bash
# 使用服务账号
export GOOGLE_APPLICATION_CREDENTIALS=./service-account-key.json

# 或使用 gcloud
gcloud auth application-default login
\\`\\`\\`

## 支持的模型

- \\`deepseek-v4-flash\\`
- \\`claude-3-opus@20240229\\`
- \\`claude-3-sonnet@20240229\\`
- \\`claude-3-haiku@20240307\\`
`,
  ["tools/bash"]: `# Bash Tool

## 功能说明

BashTool 用于在本地系统中执行 Shell 命令。支持命令执行、工作目录设置、超时控制和安全限制。

## 类型定义

\\`\\`\\`typescript
interface BashInput {
  command: string
  description?: string
  timeout?: number       // 超时(ms)，默认 30000
  workdir?: string       // 工作目录
  isCentibexSensitive?: boolean
  approved?: boolean
}

interface BashOutput {
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
}
\\`\\`\\`

## 使用示例

\\`\\`\\`typescript
import { BashTool } from 'claude-code-sdk-ts'

const tool = new BashTool()
const result = await tool.execute({
  command: 'ls -la',
  timeout: 10000,
})

console.log('输出:', result.stdout)
console.log('退出码:', result.exitCode) // 0
\\`\\`\\`

## 安全特性

- 自动检测危险命令模式
- 支持 YOLO 风险分类
- 路径白名单验证
- stderr 输出限制（前 2000 字符）
`,
  ["tools/file-edit"]: `# FileEdit Tool

## 功能说明

FileEditTool 用于对已有文件进行精确的字符串替换编辑，支持单次替换和全局替换。

## 类型定义

\\`\\`\\`typescript
interface FileEditInput {
  filePath: string
  oldString: string
  newString: string
  replaceAll?: boolean   // 是否替换所有匹配项
}

interface FileEditOutput {
  path: string
  replacements: number   // 替换次数
}
\\`\\`\\`

## 使用示例

\\`\\`\\`typescript
import { FileEditTool } from 'claude-code-sdk-ts'

const tool = new FileEditTool()
const result = await tool.execute({
  filePath: './index.ts',
  oldString: 'console.log',
  newString: 'console.info',
  replaceAll: true,
})

console.log(\\`已替换 \\\${result.replacements} 处\\`)
\\`\\`\\`
`,
  ["tools/file-read"]: `# FileRead Tool

## 功能说明

FileReadTool 用于读取文件内容。支持指定行范围、自动处理大文件。

## 类型定义

\\`\\`\\`typescript
interface FileReadInput {
  filePath: string
  limit?: number   // 最多读取行数
  offset?: number  // 起始行号（0-based）
}

interface FileReadOutput {
  content: string
  lineCount: number
  totalLines: number
}
\\`\\`\\`

## 使用示例

\\`\\`\\`typescript
import { FileReadTool } from 'claude-code-sdk-ts'

const tool = new FileReadTool()
const result = await tool.execute({
  filePath: './package.json',
  limit: 50,
})

console.log(result.text)
\\`\\`\\`
`,
  ["tools/file-write"]: `# FileWrite Tool

## 功能说明

FileWriteTool 用于创建新文件或覆盖已有文件内容。

## 类型定义

\\`\\`\\`typescript
interface FileWriteInput {
  filePath: string
  content: string
}

interface FileWriteOutput {
  path: string
  size: number
}
\\`\\`\\`

## 使用示例

\\`\\`\\`typescript
import { FileWriteTool } from 'claude-code-sdk-ts'

const tool = new FileWriteTool()
const result = await tool.execute({
  filePath: './hello.txt',
  content: 'Hello, World!',
})

console.log(\\`已写入 \\\${result.size} 字节\\`)
\\`\\`\\`
`,
  ["tools/glob"]: `# Glob Tool

## 功能说明

GlobTool 使用 Glob 模式搜索文件路径，支持通配符和递归搜索。

## 类型定义

\\`\\`\\`typescript
interface GlobInput {
  pattern: string    // Glob 模式，如 "**/*.ts"
  path?: string       // 搜索起始目录
}

interface GlobOutput {
  files: string[]    // 匹配的文件路径列表
  count: number      // 匹配数量
}
\\`\\`\\`

## 使用示例

\\`\\`\\`typescript
import { GlobTool } from 'claude-code-sdk-ts'

const tool = new GlobTool()
const result = await tool.execute({
  pattern: 'src/**/*.ts',
  path: '.',
})

console.log(\\`找到 \\\${result.count} 个 TypeScript 文件\\`)
result.files.forEach(f => console.log(' -', f))
\\`\\`\\`
`,
  ["tools/grep"]: `# Grep Tool

## 功能说明

GrepTool 在文件内容中搜索匹配正则表达式的行，支持文件类型过滤。

## 类型定义

\\`\\`\\`typescript
interface GrepInput {
  pattern: string     // 正则表达式
  include?: string    // 文件过滤模式，如 "*.ts"
  path?: string       // 搜索目录
}

interface GrepOutput {
  matches: Array<{
    file: string
    line: number
    content: string
  }>
  count: number
}
\\`\\`\\`

## 使用示例

\\`\\`\\`typescript
import { GrepTool } from 'claude-code-sdk-ts'

const tool = new GrepTool()
const result = await tool.execute({
  pattern: 'class.*extends',
  include: '*.ts',
  path: './src',
})

console.log(\\`找到 \\\${result.count} 个类继承\\`)
\\`\\`\\`
`,
  ["tools/web-fetch"]: `# WebFetch Tool

## 功能说明

WebFetchTool 用于获取网页内容并提取可读文本。

## 类型定义

\\`\\`\\`typescript
interface WebFetchInput {
  url: string
  maxChars?: number    // 最大字符数，默认 50000
}

interface WebFetchOutput {
  content: string
  url: string
  truncated: boolean
}
\\`\\`\\`

## 使用示例

\\`\\`\\`typescript
import { WebFetchTool } from 'claude-code-sdk-ts'

const tool = new WebFetchTool()
const result = await tool.execute({
  url: 'https://example.com',
  maxChars: 10000,
})

console.log(result.text)
\\`\\`\\`
`,
  ["tools/web-search"]: `# WebSearch Tool

## 功能说明

WebSearchTool 用于执行网络搜索，支持 DuckDuckGo 和 Exa 两种搜索引擎。

## 类型定义

\\`\\`\\`typescript
interface WebSearchInput {
  query: string
  maxResults?: number     // 最大结果数，默认 8
  type?: 'auto' | 'fast' | 'deep'
  engine?: 'duckduckgo' | 'exa'
}

interface WebSearchOutput {
  results: Array<{
    title: string
    url: string
    content: string
    source?: string
  }>
}
\\`\\`\\`

## 使用示例

\\`\\`\\`typescript
import { WebSearchTool } from 'claude-code-sdk-ts'

const tool = new WebSearchTool()
const result = await tool.execute({
  query: 'TypeScript latest version',
  maxResults: 5,
})

result.results.forEach(r => {
  console.log(\\`[\\\${r.title}](\\\${r.url})\\`)
})
\\`\\`\\`
`,
};

export default contentMap;
