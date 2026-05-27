# Phase 3B — B2: Tool Call 自动执行循环 (ask)

> **任务**: B2 — `ask()` 一键"思考→调工具→返回结果"全流程
> **状态**: Design Doc (Superpowers Phase 2)
> **日期**: 2026-05-27
> **项目**: claude-code-sdk v0.3.0 → v0.4.0

---

## 1. 背景

当前 `conversationLoop()` 将 low-level StreamEvent 暴露给调用方。高频场景是"发一条消息，自动调工具，等结果"——需要 `ask()` 简化为 Promise-based 接口。

## 2. 设计目标

- **ask()**: 单次调用，内部走完"思考→调工具→返回结果"的完整循环
- **askStream()**: 同 ask() 但保留流式中间事件（可用于 UI 展示思考过程）
- **AskResult**: 结构化返回（文本 + 工具调用记录 + token用量）
- 默认自动处理工具调用，可选手动覆盖

## 3. API 设计

### 3.1 核心函数

```typescript
// src/ask/index.ts

export interface AskOptions extends LoopOptions {
  /** 自动执行工具调用（默认 true）。设为 false 只返回 tool_use 信息，不执行 */
  autoExecuteTools?: boolean
  /** 每个工具执行前的钩子（可用于权限确认） */
  onToolCall?: (toolName: string, input: Record<string, unknown>) => Promise<boolean> | boolean
  /** 最大 tool call 深度（默认 10） */
  maxToolCallDepth?: number
  /** AbortSignal */
  signal?: AbortSignal
}

export interface AskResult {
  /** 最终回复文本 */
  text: string
  /** 执行的工具调用记录 */
  toolCalls: ToolCallRecord[]
  /** token 用量汇总 */
  usage: TokenUsage
  /** 完整的消息历史（含内部 tool result 消息） */
  messages: Message[]
}

export interface ToolCallRecord {
  id: Snowflake
  name: string
  input: Record<string, unknown>
  result: string
  isError?: boolean
}
```

### 3.2 顶层函数签名

```typescript
/** 一键 ask: 自动执行工具调用，返回最终结果 */
export async function ask(
  llm: LLMConnector,
  params: {
    systemPrompt?: string
    messages: Message[]
    tools: ToolRegistry
    options?: AskOptions
  },
): Promise<AskResult>

/** 流式 ask: 保留中间事件，最后产出 AskResult */
export async function* askStream(
  llm: LLMConnector,
  params: {
    systemPrompt?: string
    messages: Message[]
    tools: ToolRegistry
    options?: AskOptions
  },
): AsyncIterable<StreamEvent | { type: 'result'; result: AskResult }>
```

## 4. 实现策略

### 4.1 ask() 实现

```typescript
export async function ask(llm, params): Promise<AskResult> {
  const result: AskResult = {
    text: '',
    toolCalls: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    messages: [...params.messages],
  }

  const depth = params.options?.maxToolCallDepth ?? 10
  const autoExec = params.options?.autoExecuteTools !== false
  let iteration = 0

  while (iteration < depth) {
    let turnText = ''
    const turnToolUses: Array<{ id: string; name: string; input: any }> = []
    let pendingTool: any = null
    let turnUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 }

    // 一轮 LLM 调用
    for await (const event of conversationLoop(llm, params.systemPrompt, result.messages, params.tools, {
      ...params.options,
      maxToolCallDepth: 1, // ask 自己控制外层循环
    })) {
      switch (event.type) {
        case 'text':
          turnText += event.text
          break
        case 'tool_use_start':
          pendingTool = { id: event.id, name: event.name, input: event.input }
          break
        case 'tool_use_end':
          if (pendingTool) {
            turnToolUses.push({ ...pendingTool, result: event.output, isError: event.isError })
            pendingTool = null
          }
          break
        case 'done':
          turnUsage = event.usage
          break
        case 'error':
          throw event.error
      }
    }

    result.text += turnText
    result.usage.inputTokens += turnUsage.inputTokens
    result.usage.outputTokens += turnUsage.outputTokens

    // 无工具调用 → 完成
    if (turnToolUses.length === 0) break

    // 执行或记录工具调用
    for (const toolUse of turnToolUses) {
      // onToolCall 钩子
      if (params.options?.onToolCall) {
        const proceed = await params.options.onToolCall(toolUse.name, toolUse.input)
        if (!proceed) continue
      }

      let toolResult: string
      if (autoExec) {
        const execResult = await params.tools.execute(toolUse.name, toolUse.input, {
          signal: params.options?.signal,
        })
        toolResult = execResult.content
      } else {
        toolResult = toolUse.result || ''
      }

      result.toolCalls.push({
        id: toolUse.id,
        name: toolUse.name,
        input: toolUse.input,
        result: toolResult,
        isError: toolUse.isError,
      })

      // 注入 tool result 到消息历史
      result.messages.push({
        id: `${Date.now()}-result-${toolUse.id}`,
        role: 'user',
        content: toolResult,
        createdAt: new Date().toISOString(),
      })
    }

    iteration++
  }

  return result
}
```

### 4.2 askStream() 实现

askStream 在 ask() 的基础上，在每个关键节点 yield 事件：

```typescript
export async function* askStream(llm, params): AsyncIterable<...> {
  // ... 同 ask() 逻辑，但在以下点位 yield：
  // - 每轮 LLM 调用时：yield 透传 StreamEvent
  // - 每个工具调用前：yield { type: 'before_tool', ... }
  // - 每个工具调用后：yield { type: 'after_tool', ... }
  // - 最终：yield { type: 'result', result }
}
```

## 5. 与现有模块的集成

| 依赖 | 说明 |
|:---|:---|
| `LLMConnector` | 来自 `src/llm/types.ts` |
| `ToolRegistry` | 来自 `src/tools/registry.ts` |
| `conversationLoop` | 来自 `src/conversation/loop.ts` — ask 内部调用，外层控制深度 |
| `StreamEvent` / `TokenUsage` | 来自 `src/llm/types.ts` |
| `Snowflake` | 来自 `src/types/message.ts` |

导出路径：

```typescript
// src/index.ts 追加
export { ask, askStream } from './ask/index.js'
export type { AskOptions, AskResult, ToolCallRecord } from './ask/index.js'
```

## 6. 测试策略

| 测试 | 类型 | 说明 |
|:---|:---|:---|
| ask 无工具 | 单元 | 纯文本回复，验证 text + usage |
| ask 单工具 | 单元 | 工具被自动调用，result 注入消息历史 |
| ask 多工具链 | 单元 | 连续多轮工具调用 |
| askStream 事件流 | 单元 | 验证 yield 到 result 的全部事件 |
| onToolCall 钩子 | 单元 | 阻止/允许工具调用 |
| autoExecuteTools=false | 单元 | 只记录不执行 |
| 深度超限 | 单元 | maxToolCallDepth 限制 |
| API 集成 | 集成 | 使用真实 API Key 验证端到端流程 |
| Abort 取消 | 单元 | signal.aborted 后立即停止 |

## 7. 文件清单（新建）

| 文件 | 内容 |
|:---|:---|
| `src/ask/index.ts` | ask(), askStream() 导出 |
| `src/__tests__/ask.test.ts` | 单元测试 |
| `src/__tests__/ask.integration.test.ts` | 集成测试 |
