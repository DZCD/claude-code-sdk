# Task 子系统

Task 子系统提供持久化的任务管理能力。Task 是文件系统支持的 JSON 格式工作项，遵循 `pending → in_progress → completed` 生命周期，支持依赖关系和元数据。

## 概述

Task 子系统由两部分组成：

| 组件 | 说明 |
|------|------|
| **Task Engine** | 底层 CRUD 引擎，文件系统存储（`~/.claude/tasks/{taskListId}/`） |
| **Task 工具** | 6 个内置工具，让 AI 通过对话自动管理任务 |

```
Task Engine (engine.ts)
├── createTask()    — 创建任务，自动生成顺序 ID
├── getTask()       — 按 ID 检索任务
├── listTasks()     — 列出所有任务
├── updateTask()    — 部分更新任务
├── deleteTask()    — 删除任务并清理引用
├── blockTask()     — 建立任务依赖关系
└── resetTaskList() — 清空任务列表
```

## 定义 Task

每个 Task 有标准的 JSON 结构：

```typescript
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
```

## 使用 Task 引擎

Task Engine 提供纯函数式 API，直接操作文件系统：

```typescript
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
console.log(`Created task #${taskId}`)  // "Created task #1"

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
```

## Task 工具

SDK 提供 6 个内置 Task 工具，AI 可在对话中自动调用：

### TaskCreate
创建新任务，初始状态为 `pending`。

```typescript
// AI 可调用：
// TaskCreate({ subject: '修复登录Bug', description: 'OAuth 回调返回 500...' })
```

**参数**：`subject`（必填）、`description`（必填）、`activeForm`（可选）、`metadata`（可选）

### TaskGet
按 ID 检索完整任务信息。

```typescript
// AI 可调用：
// TaskGet({ taskId: '1' })
// → Task #1: 修复登录Bug
//   状态: pending, 描述: OAuth 回调返回 500...
```

**参数**：`taskId`（必填）

### TaskList
列出当前任务列表中的所有任务。

```typescript
// AI 可调用：
// TaskList({})
// → 3 tasks: #1 pending, #2 in_progress, #3 completed
```

无必填参数。

### TaskUpdate
更新任务状态、标题、描述、依赖等。支持将状态设为 `deleted` 来删除任务。

```typescript
// AI 可调用：
// TaskUpdate({ taskId: '1', status: 'in_progress' })
// → Task #1 updated: status → in_progress
```

**参数**：`taskId`（必填）、`subject`、`description`、`status`、`addBlocks`、`addBlockedBy`、`owner`、`metadata`（均可选）

### TaskStop
将任务状态设为 `completed`。

```typescript
// AI 可调用：
// TaskStop({ taskId: '1' })
// → Task #1 stopped: status → completed
```

**参数**：`taskId`（必填）

### TaskOutput
获取任务的捕获输出（如命令执行结果）。

```typescript
// AI 可调用：
// TaskOutput({ taskId: '1' })
// → Task #1 output: "用户名验证通过\
密码哈希匹配成功\
..."
```

**参数**：`taskId`（必填）

## 完整示例

```typescript
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
  console.log(`当前有 ${tasks.length} 个任务`)

  // 让 AI 帮忙管理任务
  // AI 会自动调用 TaskUpdate、TaskStop 等工具
  const response = await sdk.send('把第一个任务标记为完成，第二个任务的状态更新为进行中')
  console.log('AI:', response.content)
}

main()
```

**输出示例：**

```
当前有 2 个任务
AI: 已完成以下操作：
  - Task #1（实现登录模块）→ completed
  - Task #2（编写 API 文档）→ in_progress
```

## 最佳实践

### 1. 任务描述要具体

```typescript
// ❌ 太模糊
createTask('default', { subject: '修复Bug', description: '有个Bug' })

// ✅ 清晰可执行
createTask('default', {
  subject: '修复 OAuth token 刷新 401 错误',
  description: 'Token 过期后刷新接口返回 401 而非 200。需要在 refreshToken() 中添加错误处理并记录日志。',
})
```

### 2. 使用依赖关系建模阻塞

```typescript
// 任务 B 依赖任务 A 完成
await createTask('default', { subject: '数据库迁移', description: '...' })        // #1
await createTask('default', { subject: 'API 对接新表', description: '...' })       // #2
await blockTask('default', '2', '1')  // #2 被 #1 阻塞
```

### 3. 利用 metadata 扩展信息

```typescript
await createTask('default', {
  subject: '性能优化',
  description: '优化首页加载时间',
  metadata: {
    priority: 'high',
    estimatedHours: 4,
    relatedPR: 'https://github.com/DZCD/claude-code-sdk/pull/42',
  },
})
```

### 4. 存储位置管理

```typescript
// 项目 A 使用独立任务目录
configureTaskEngine({ baseDir: './project-a/.tasks' })

// 项目 B 用环境变量隔离
process.env.CLAUDE_CODE_TASK_LIST_ID = 'project-b'
```

### 5. 让 AI 管理任务状态

将 Task 工具注册到 SDK 后，AI 可以：

- 创建新任务来跟踪复杂工作
- 开始工作时将任务标记为 `in_progress`
- 完成时标记为 `completed`
- 创建任务间的依赖关系
- 读取任务输出来了解之前的结果

---

## 相关文档

- [工具系统](/core-concepts/tool-system) — 了解工具注册和执行机制
- [Skill 系统](/advanced/skill-system) — 自定义 Skill 与 Task 工具的协同使用
- [权限系统](/advanced/permission-system) — 控制 Task 工具的权限
