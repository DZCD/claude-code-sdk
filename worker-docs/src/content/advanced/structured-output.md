# Structured Output

SDK 支持约束 LLM 输出为结构化 JSON 格式，通过 JSON Schema 定义输出形状，确保 AI 响应始终符合预期结构。

## OutputFormat 类型

```typescript
import type { OutputFormat } from 'claude-code-sdk-ts'

// OutputFormat 目前支持 json_schema 类型
type OutputFormat = {
  type: 'json_schema'
  schema: Record<string, unknown>  // JSON Schema 定义
}
```

## 基本用法

通过 `ask()` 的 `options.outputFormat` 参数指定输出格式：

```typescript
import { ask, ToolRegistry, type OutputFormat } from 'claude-code-sdk-ts'

const registry = new ToolRegistry()

const result = await ask(llm, {
  messages: [
    { role: 'user', content: [{ type: 'text', text: '请分析以下代码的质量：export function add(a,b){return a+b}' }] },
  ],
  tools: registry,
  options: {
    outputFormat: {
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: {
          score: { type: 'number', description: '代码质量评分（1~10）' },
          issues: {
            type: 'array',
            items: { type: 'string' },
            description: '发现的问题列表',
          },
          suggestion: { type: 'string', description: '优化建议' },
        },
        required: ['score', 'issues'],
      },
    },
  },
})

console.log(JSON.parse(result.text))
// {
//   "score": 6,
//   "issues": ["缺少类型注解", "缺少 JSDoc 注释"],
//   "suggestion": "建议添加参数类型和返回值类型"
// }
```

## 典型场景

### API 响应格式化

```typescript
const response = await ask(llm, {
  systemPrompt: '你是一个天气查询助手。',
  messages: [
    { role: 'user', content: [{ type: 'text', text: '北京未来 3 天的天气如何？' }] },
  ],
  tools: registry,
  options: {
    outputFormat: {
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: {
          city: { type: 'string' },
          forecast: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                date: { type: 'string' },
                temperature: { type: 'number' },
                condition: { type: 'string' },
              },
              required: ['date', 'temperature', 'condition'],
            },
          },
        },
        required: ['city', 'forecast'],
      },
    },
  },
})
```

### 数据提取

```typescript
const extracted = await ask(llm, {
  messages: [
    {
      role: 'user',
      content: [{ type: 'text', text: '从以下文本中提取人名和邮箱：\
张三 (zhangsan@example.com)、李四 (lisi@test.com)' }],
    },
  ],
  tools: registry,
  options: {
    outputFormat: {
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: {
          people: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                email: { type: 'string' },
              },
              required: ['name', 'email'],
            },
          },
        },
        required: ['people'],
      },
    },
  },
})

console.log(JSON.parse(extracted.text))
// {
//   "people": [
//     { "name": "张三", "email": "zhangsan@example.com" },
//     { "name": "李四", "email": "lisi@test.com" }
//   ]
// }
```

## 与 Zod Schema 的关系

`OutputFormat` 的 schema 使用 JSON Schema 格式。如果你已经用 Zod 定义了类型，需要转换为 JSON Schema：

```typescript
import { z } from 'zod'
import zodToJsonSchema from 'zod-to-json-schema'  // 第三方库

// Zod 定义
const CodeReviewSchema = z.object({
  score: z.number().min(1).max(10).describe('代码质量评分'),
  issues: z.array(z.string()).describe('发现的问题'),
  suggestion: z.string().optional().describe('优化建议'),
})

// 转换为 JSON Schema
const jsonSchema = zodToJsonSchema(CodeReviewSchema)

// 传入 outputFormat
const result = await ask(llm, {
  messages: [{ role: 'user', content: '...' }],
  tools: registry,
  options: {
    outputFormat: { type: 'json_schema', schema: jsonSchema },
  },
})
```

## StreamlinedMessage

SDK 支持精简消息格式 `StreamlinedMessage`，用于减少上下文长度：

```typescript
import type { StreamlinedMessage } from 'claude-code-sdk-ts'

// 普通消息 → 精简消息
const streamlined: StreamlinedMessage = {
  role: 'user',
  content: 'hello',  // 简化为纯文本字符串
}
```

精简格式适用于：
- 大批量历史消息压缩
- Token 预算紧张场景
- 不需要富内容块的简单消息

## PromptRequest / PromptResponse

SDK 提供标准的交互式提示机制，用于用户决策场景：

### PromptRequest — 向用户提问

```typescript
import { createPromptRequest, type PromptRequestOption } from 'claude-code-sdk-ts'

const options: PromptRequestOption[] = [
  { key: 'first', label: '打开第一个文件', description: '打开 src/index.ts' },
  { key: 'second', label: '打开第二个文件', description: '打开 src/app.ts' },
  { key: 'none', label: '都不打开' },
]

const request = createPromptRequest(
  'file_select',           // prompt ID
  '你要打开哪个文件？',     // 显示消息
  options
)

console.log(request)
// {
//   prompt: 'file_select',
//   message: '你要打开哪个文件？',
//   options: [
//     { key: 'first', label: '打开第一个文件', ... },
//     ...
//   ]
// }
```

### PromptResponse — 用户回复

```typescript
import { createPromptResponse, promptResponseToKey } from 'claude-code-sdk-ts'

const response = createPromptResponse('file_select', 'first')
console.log(response)
// { prompt_response: 'file_select', selected: 'first' }

// 提取选中的 key
const selectedKey = promptResponseToKey(response)
console.log(selectedKey)  // "first"
```

### 类型守卫

```typescript
import { isPromptRequest, isPromptResponse } from 'claude-code-sdk-ts'

const data = { prompt: 'q1', message: 'Confirm?', options: [] }
if (isPromptRequest(data)) {
  console.log('这是一个 PromptRequest')
}

const reply = { prompt_response: 'q1', selected: 'yes' }
if (isPromptResponse(reply)) {
  console.log('用户选择了:', reply.selected)  // "yes"
}
```

### 与 Skill 集成

在 Skill 中使用 PromptRequest/Response 实现交互式工作流：

```typescript
const interactiveSkill = createTool({
  name: 'confirm_delete',
  description: '在执行删除操作前向用户确认',
  inputSchema: z.object({
    target: z.string().describe('要删除的文件路径'),
  }),
  async execute(input) {
    // 返回 PromptRequest，让 AI 向用户提问
    const promptReq = createPromptRequest('delete_confirm', `确认删除 ${input.target}？`, [
      { key: 'yes', label: '确认删除' },
      { key: 'no', label: '取消' },
    ])

    return {
      content: JSON.stringify(promptReq),
      data: { prompt: promptReq },
    }
  },
})
```

## 最佳实践

### 1. Schema 设计要务实

只约束你真正需要的字段。过多的 `required` 字段会限制 AI 的灵活性：

```typescript
// ❌ 过度约束
schema: {
  type: 'object',
  properties: { a: { type: 'string' }, b: { type: 'string' }, c: { type: 'string' }, /* ...10 more */ },
  required: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],  // 太多必填字段
}

// ✅ 仅约束核心字段
schema: {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    details: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary'],  // 只有最关键的字段是必填的
}
```

### 2. 添加 description 帮助 AI 理解格式

```typescript
properties: {
  confidence: {
    type: 'number',
    description: '置信度（0~1），1 表示完全确定',  // 👈 AI 会用这个理解该填什么
  },
}
```

### 3. 处理解析失败

```typescript
const result = await ask(llm, { /* ... */, options: { outputFormat: { /* ... */ } } })

try {
  const parsed = JSON.parse(result.text)
  console.log('结构化输出：', parsed)
} catch {
  // JSON 解析失败 — AI 可能没有遵守 Schema（罕见）
  console.warn('输出不是有效 JSON：', result.text)
}
```

---

## 相关文档

- [Skill 系统](/advanced/skill-system) — Skill 与 PromptRequest 的集成示例
- [工具系统](/core-concepts/tool-system) — 工具注册和执行
- [API 参考 — ask()](/api-reference/claude-code-sdk) — ask() 完整参数说明
