/**
 * ask / askStream — Tool Call 自动执行循环
 *
 * 高频场景："发一条消息，自动调工具，等结果"
 * ask() 将 conversationLoop 简化为 Promise-based 接口，
 * 内部自动完成"思考→调工具→返回结果"的完整循环。
 *
 * @public
 */
import type { LLMConnector, StreamEvent, TokenUsage } from '../llm/types.js'
import type { Message, Snowflake } from '../types/message.js'
import type { ToolRegistry } from '../tools/registry.js'
import type { LoopOptions } from '../conversation/loop.js'

// ─── Types ────────────────────────────────────────────────

/**
 * Options for ask() and askStream().
 * Extends LoopOptions with tool execution control.
 */
export interface AskOptions extends LoopOptions {
  /** 自动执行工具调用（默认 true）。设为 false 只记录 tool_use 信息，不执行 */
  autoExecuteTools?: boolean
  /** 每个工具执行前的钩子（可用于权限确认）。返回 false 跳过该工具 */
  onToolCall?: (toolName: string, input: Record<string, unknown>) => Promise<boolean> | boolean
  /** 最大 tool call 深度（默认 10） */
  maxToolCallDepth?: number
}

/**
 * 结构化返回结果。
 * 包含最终文本、工具调用记录、token 用量和完整的消息历史。
 */
export interface AskResult {
  /** 最终回复文本（所有轮次的拼接） */
  text: string
  /** 执行的工具调用记录 */
  toolCalls: ToolCallRecord[]
  /** token 用量汇总（所有轮次累加） */
  usage: TokenUsage
  /** 完整的消息历史（含内部 tool result 消息） */
  messages: Message[]
}

/**
 * 单次工具调用的记录。
 * 包含工具名、输入、执行结果和错误状态。
 */
export interface ToolCallRecord {
  /** 工具调用 ID */
  id: Snowflake
  /** 工具名 */
  name: string
  /** 输入参数 */
  input: Record<string, unknown>
  /** 执行结果文本 */
  result: string
  /** 是否执行出错 */
  isError?: boolean
}

// ─── Defaults ─────────────────────────────────────────────

const DEFAULT_MAX_TOOL_CALL_DEPTH = 10

// ─── Internal: LLM one-turn helper ────────────────────────

interface TurnResult {
  text: string
  toolUses: Array<{
    id: string
    name: string
    input: Record<string, unknown>
    isError?: boolean
  }>
  usage: TokenUsage
}

async function doOneTurn(
  llm: LLMConnector,
  systemPrompt: string | undefined,
  messages: Message[],
  tools: ToolRegistry,
  signal?: AbortSignal,
): Promise<TurnResult> {
  const apiMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }))

  const apiTools = tools.toAPISchemas()

  let text = ''
  const toolUses: TurnResult['toolUses'] = []
  let pendingTool: { id: string; name: string; input: Record<string, unknown> } | null = null
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 }

  for await (const event of llm.send(systemPrompt, apiMessages, apiTools, { signal })) {
    switch (event.type) {
      case 'text':
        text += event.text
        break
      case 'tool_use_start':
        pendingTool = { id: event.id, name: event.name, input: event.input }
        break
      case 'tool_use_end':
        if (pendingTool) {
          try {
            pendingTool.input = JSON.parse(event.output)
          } catch {
            // keep original input
          }
          toolUses.push({ ...pendingTool, isError: event.isError })
          pendingTool = null
        }
        break
      case 'thinking':
      case 'ping':
        break
      case 'done':
        usage = event.usage ?? { inputTokens: 0, outputTokens: 0 }
        break
      case 'error':
        throw event.error
      case 'retry':
        break
    }
  }

  return { text, toolUses, usage }
}

// ─── ask() — Promise-based ────────────────────────────────

/**
 * 一键 ask: 自动执行工具调用，返回最终结果。
 *
 * 内部使用 LLMConnector 直接通信，支持自动工具执行、onToolCall 钩子、
 * maxToolCallDepth 限制和 AbortSignal 取消。
 *
 * @param llm - LLM 连接器
 * @param params - 调用参数
 * @returns AskResult — 包含最终文本、工具调用记录、token 用量和消息历史
 * @public
 */
export async function ask(
  llm: LLMConnector,
  params: {
    systemPrompt?: string
    messages: Message[]
    tools: ToolRegistry
    options?: AskOptions
  },
): Promise<AskResult> {
  const result: AskResult = {
    text: '',
    toolCalls: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    messages: [...params.messages],
  }

  const maxDepth = params.options?.maxToolCallDepth ?? DEFAULT_MAX_TOOL_CALL_DEPTH
  const autoExec = params.options?.autoExecuteTools !== false
  const signal = params.options?.signal
  let iteration = 0

  while (iteration < maxDepth) {
    if (signal?.aborted) {
      throw new Error('ask aborted')
    }

    // 一轮 LLM 调用（仅流式事件，不自动执行工具）
    const turn = await doOneTurn(
      llm,
      params.systemPrompt,
      result.messages,
      params.tools,
      signal,
    )

    result.text += turn.text
    result.usage.inputTokens += turn.usage.inputTokens ?? 0
    result.usage.outputTokens += turn.usage.outputTokens ?? 0

    // 无工具调用 → 完成
    if (turn.toolUses.length === 0) break

    // 执行或记录工具调用
    for (const toolUse of turn.toolUses) {
      // onToolCall 钩子 — 决定是否执行此工具
      if (params.options?.onToolCall) {
        const proceed = await params.options.onToolCall(toolUse.name, toolUse.input)
        if (!proceed) continue
      }

      let toolResult: string
      let isError = false

      if (autoExec) {
        const execResult = await params.tools.execute(toolUse.name, toolUse.input, {
          signal: signal ?? new AbortController().signal,
        })
        toolResult = execResult.content
        isError = execResult.isError ?? false
      } else {
        // autoExecuteTools=false: 不执行，用 API 返回的 output
        toolResult = ''
      }

      result.toolCalls.push({
        id: toolUse.id,
        name: toolUse.name,
        input: toolUse.input,
        result: toolResult,
        isError,
      })

      // 注入 tool result 到消息历史（供下一轮 LLM 使用）
      result.messages.push({
        id: `${Date.now()}-result-${toolUse.id}`,
        role: 'user',
        content: toolResult,
        createdAt: new Date().toISOString(),
      } as Message)
    }

    iteration++
  }

  return result
}

// ─── askStream() — 流式版本 ───────────────────────────────

/**
 * 流式 ask: 保留中间事件，最后产出 AskResult。
 *
 * 在以下点位 yield 事件：
 * - 每轮 LLM 调用时：透传 StreamEvent（text / tool_use_start / tool_use_end 等）
 * - 最终：{ type: 'result', result: AskResult }
 *
 * @param llm - LLM 连接器
 * @param params - 调用参数（与 ask() 相同）
 * @public
 */
export async function* askStream(
  llm: LLMConnector,
  params: {
    systemPrompt?: string
    messages: Message[]
    tools: ToolRegistry
    options?: AskOptions
  },
): AsyncIterable<StreamEvent | { type: 'result'; result: AskResult }> {
  const result: AskResult = {
    text: '',
    toolCalls: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    messages: [...params.messages],
  }

  const maxDepth = params.options?.maxToolCallDepth ?? DEFAULT_MAX_TOOL_CALL_DEPTH
  const autoExec = params.options?.autoExecuteTools !== false
  const signal = params.options?.signal
  let iteration = 0

  while (iteration < maxDepth) {
    if (signal?.aborted) {
      yield { type: 'error', error: new Error('ask aborted') }
      return
    }

    const apiMessages = result.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      }))

    const apiTools = params.tools.toAPISchemas()

    let turnText = ''
    const turnToolUses: Array<{
      id: string
      name: string
      input: Record<string, unknown>
      isError?: boolean
    }> = []
    let pendingTool: { id: string; name: string; input: Record<string, unknown> } | null = null
    let turnUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 }

    // 透传 LLM 流式事件
    for await (const event of llm.send(
      params.systemPrompt,
      apiMessages,
      apiTools,
      { signal },
    )) {
      switch (event.type) {
        case 'text':
          turnText += event.text
          yield event
          break
        case 'tool_use_start':
          pendingTool = { id: event.id, name: event.name, input: event.input }
          yield event
          break
        case 'tool_use_end':
          if (pendingTool) {
            try {
              pendingTool.input = JSON.parse(event.output)
            } catch {
              // keep original input
            }
            turnToolUses.push({ ...pendingTool, isError: event.isError })
            pendingTool = null
          }
          yield event
          break
        case 'thinking':
        case 'ping':
          yield event
          break
        case 'done':
          turnUsage = event.usage ?? { inputTokens: 0, outputTokens: 0 }
          yield event
          break
        case 'error':
          yield event
          return
        case 'retry':
          yield event
          break
      }
    }

    result.text += turnText
    result.usage.inputTokens += turnUsage.inputTokens ?? 0
    result.usage.outputTokens += turnUsage.outputTokens ?? 0

    // 无工具调用 → 完成
    if (turnToolUses.length === 0) break

    // 执行工具调用
    for (const toolUse of turnToolUses) {
      if (params.options?.onToolCall) {
        const proceed = await params.options.onToolCall(toolUse.name, toolUse.input)
        if (!proceed) continue
      }

      let toolResult: string
      let isError = false

      if (autoExec) {
        const execResult = await params.tools.execute(toolUse.name, toolUse.input, {
          signal: signal ?? new AbortController().signal,
        })
        toolResult = execResult.content
        isError = execResult.isError ?? false
      } else {
        toolResult = ''
      }

      result.toolCalls.push({
        id: toolUse.id,
        name: toolUse.name,
        input: toolUse.input,
        result: toolResult,
        isError,
      })

      result.messages.push({
        id: `${Date.now()}-result-${toolUse.id}`,
        role: 'user',
        content: toolResult,
        createdAt: new Date().toISOString(),
      } as Message)
    }

    iteration++
  }

  // 最终产出 AskResult
  yield { type: 'result', result }
}
