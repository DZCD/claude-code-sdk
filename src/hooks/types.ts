/**
 * ClaudeCode SDK — Hook System Types
 *
 * 定义钩子系统的事件阶段、处理函数签名和结果类型。
 *
 * @public
 */

/** 钩子阶段 */
export type HookPhase = 'preTool' | 'postTool' | 'preTurn' | 'postTurn'

/** 工具执行前钩子签名 */
export type PreToolHook = (
  toolName: string,
  input: Record<string, unknown>,
) => PreToolHookResult | Promise<PreToolHookResult>

export interface PreToolHookResult {
  /** true=继续执行, false=阻止执行 */
  allowed: boolean
  /** 当 allowed=false 时的错误消息 */
  error?: string
  /** 可选的修改后输入 */
  modifiedInput?: Record<string, unknown>
}

/** 工具执行后钩子签名 */
export type PostToolHook = (toolName: string, input: Record<string, unknown>, result: unknown) => void | Promise<void>

/** LLM 请求前钩子签名 */
export type PreTurnHook = (messages: unknown[]) => PreTurnHookResult | Promise<PreTurnHookResult>

export interface PreTurnHookResult {
  /** true=继续请求, false=跳过 */
  proceed: boolean
  /** 可选的修改后消息列表 */
  modifiedMessages?: unknown[]
}

/** LLM 响应后钩子签名 */
export type PostTurnHook = (messages: unknown[], responseText: string) => void | Promise<void>

/** 钩子阶段到处理函数签名的映射 */
export interface HookHandlerMap {
  preTool: PreToolHook
  postTool: PostToolHook
  preTurn: PreTurnHook
  postTurn: PostTurnHook
}
