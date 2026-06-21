# Skill 系统

Skill 是 SDK 的**渐进式暴露（Progressive Exposure）指令集**，让 AI 按需发现并加载专业能力。

## 设计理念：Skill 不是 Tool

在理解 Skill 之前，必须澄清一个重要区别：

| | Tool（工具） | Skill（技能） |
|:---|:-------------|:--------------|
| **暴露方式** | 全量暴露（每次请求都带完整参数 schema） | **渐进式**（先只展示名称和简介，选中后才加载完整内容） |
| **AI 看到** | 完整函数签名 + 参数 schema | Listing 阶段只看到 `name: description` |
| **内容形式** | 函数签名 + 参数 schema | **任意 Markdown 指令文本** |
| **执行方式** | 一次函数调用 → 返回结构化的 tool result | 指令注入对话 → AI 按指令行事 |
| **子工具** | 无（工具本身是原子操作） | 可声明 `allowedTools` 允许 AI 在执行时按需调用 |

> **核心思想**：Skill 不是"一个函数调用"，它是**一个动态注入的指令集**。当 AI 选中某个 Skill 后，系统把该 Skill 的完整指令注入对话，AI 从此以该身份或角色工作。

## 工作流程

```
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
```

**关键约束**：整个 Skill 列表只占上下文 token 预算的约 **1%**，每个 Skill 描述最多 **250 字符**。这使得 AI 可以浏览大量 Skill 而不影响核心对话的 token 预算。

## 定义 Skill

使用 `createSkill()` 方法定义 Skill：

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

// 定义代码审查 Skill
sdk.createSkill({
  name: 'code_review',
  description: '对代码进行全面审查，发现潜在问题',
  instruction: `你是一个资深代码审查专家。

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
`,
  allowedTools: ['FileRead', 'Grep', 'Glob'],  // AI 可使用这些工具来完成审查
})
```

### 参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `name` | `string` | ✅ | Skill 唯一名称，AI 通过此名称调用 |
| `description` | `string` | ✅ | 简介（最多 **250 字符**，Listing 阶段只显示这个） |
| `instruction` | `string` | ✅ | 完整指令（Markdown 格式），AI 选中 Skill 后注入对话 |
| `allowedTools` | `string[]` | 否 | AI 在执行该 Skill 时可以调用的工具列表 |
| `context` | `'inline' \| 'fork'` | 否 | 执行模式：`inline`（默认，当前对话中执行）/ `fork`（独立上下文中执行） |

## 注册多个 Skill

注册多个 Skill，AI 会根据问题自动选择合适的：

```typescript
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
  instruction: `你是一个运维专家。

分析日志时关注：
1. ERROR 级别日志的频率和分布
2. 异常堆栈的关键信息
3. 时间维度的趋势分析

输出清晰的排查结论和修复建议。`,
  allowedTools: ['Bash', 'Grep', 'FileRead'],
})
```

## 调用 Skill

注册后，AI 会自动在对话中看到 Skill 列表。无需额外调用代码——当 AI 判断需要某个 Skill 时，会自动调用 `SkillTool` 加载指令：

```typescript
// 用户提问 → AI 自动选择匹配的 Skill
const response = await sdk.send('帮我审查一下当前项目的代码质量')
// AI: 检查到你有 code_review Skill
// → 自动调用 SkillTool("code_review")
// → 注入代码审查指令
// → 开始审查项目代码...
```

你也可以通过 `ask()` 使用 Skill：

```typescript
import { ask, ToolRegistry } from 'claude-code-sdk-ts'

const registry = new ToolRegistry()
const result = await ask(sdk.getLLM(), {
  systemPrompt: 'You are a helpful assistant.',
  messages: [{ role: 'user', content: '帮我分析一下日志文件中的错误' }],
  tools: registry,
})
```

## 完整示例

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

// 创建一个翻译 Skill
sdk.createSkill({
  name: 'translator',
  description: '将中文文本翻译为英文',
  instruction: `你是一个专业翻译。

## 要求
1. 准确传达原文意思
2. 保持自然的英文表达
3. 注意文化差异和语境

## 输出格式
原文：...
译文：...
`,
  allowedTools: [],
})

async function main() {
  const response = await sdk.send('请帮我把"机器学习正在改变世界"翻译成英文')
  console.log(response.content)
}

main()
```

## 最佳实践

1. **描述精准** — `description` 是 AI 唯一的筛选依据，要用简练的语言说明 Skill 的用途
2. **指令结构清晰** — `instruction` 使用 Markdown 标题、列表组织内容，便于 AI 理解
3. **限定工具范围** — `allowedTools` 只列出必需的工具，减少 AI 的决策负担
4. **关注 Token 效率** — Skill 的内容会注入对话，过长的指令会消耗 token；保持指令精简
5. **命名规范** — 使用蛇形命名（`code_review`、`log_analysis`），便于 AI 识别
6. **Context 选择** — 大多数场景用默认的 `inline`；如果需要隔离执行环境（如审计功能），用 `fork`

## 交互式 Skill（PromptRequest/Response）

Skill 可以返回 `PromptRequest` 来向用户提问，接收 `PromptResponse` 作为回答：

```typescript
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
        createPromptRequest('confirm', `确认执行：${input.action}？`, [
          { key: 'yes', label: '确认' },
          { key: 'no', label: '取消' },
        ])
      ),
      data: { promptId: 'confirm', action: input.action },
    }
  },
})
```

当 Skill 需要结构化输出时，结合 [Structured Output](/advanced/structured-output) 使用 OutputFormat。

### LocalCommandOutput 使用场景

如果 Skill 涉及本地命令执行，可以利用 `LocalCommandOutput` 捕获命令输出并作为 Task 的输出数据保存：

```typescript
const deploySkill = createTool({
  name: 'deploy_project',
  description: '部署项目到 Cloudflare Workers',
  inputSchema: z.object({ environment: z.string() }),
  async execute(input) {
    // 通过 BashTool 执行命令 → 捕获输出 → 写入 Task output
    return {
      content: `部署到 ${input.environment} 已完成`,
      data: {
        environment: input.environment,
        commandOutput: '...',  // LocalCommandOutput 等效
      },
    }
  },
})
```
