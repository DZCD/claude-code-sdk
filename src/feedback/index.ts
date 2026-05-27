/**
 * Feedback Loop — 用户反馈注入机制
 *
 * 允许用户在 LLM 回复后提供修正，SDK 自动"重试+修正"。
 * 支持 manual（手动注入）和 auto（自动纠错）两种模式。
 *
 * @public
 */
import type { Message } from '../types/message.js'

// ─── Types ────────────────────────────────────────────────

/** 反馈模式 */
export type FeedbackMode = 'disabled' | 'manual' | 'auto'

/**
 * 用户反馈输入。
 * 包含文本修正和工具结果修正两种方式。
 */
export interface FeedbackInput {
  /** 文本修正：作为新的 user message 注入到对话历史 */
  text?: string
  /** 工具结果修正：覆盖特定工具调用的执行结果 */
  toolOverrides?: Array<{
    toolUseId: string
    correctedResult: string
  }>
}

/**
 * 反馈上下文 — 传递给 onFeedback 回调的信息。
 * 包含本轮 LLM 产出、工具调用记录和当前消息历史。
 */
export interface FeedbackContext {
  /** 本轮 LLM 产出的文本 */
  text: string
  /** 本轮执行的工具调用记录 */
  toolCalls: Array<{
    id: string
    name: string
    input: Record<string, unknown>
    result: string
    isError?: boolean
  }>
  /** 当前消息历史（只读快照） */
  messages: readonly Message[]
}

/**
 * 反馈选项。
 * 配置反馈模式、回调函数和超时时间。
 */
export interface FeedbackOptions {
  /** 反馈模式 */
  mode: FeedbackMode
  /**
   * manual 模式：LLM 产出后调用此回调等待用户反馈。
   * 返回 FeedbackInput 注入修正；返回 null/undefined 继续。
   */
  onFeedback?: (context: FeedbackContext) => Promise<FeedbackInput | null | undefined>
  /**
   * 等待反馈的超时时间（ms），默认 30000。
   * 超时后自动继续，避免永久阻塞。
   */
  timeout?: number
}

// ─── Defaults ─────────────────────────────────────────────

const DEFAULT_FEEDBACK_TIMEOUT_MS = 30000

// ─── FeedbackInjector ─────────────────────────────────────

/**
 * FeedbackInjector — 管理反馈注入逻辑。
 *
 * 支持两种模式：
 * - manual: 调用 onFeedback 回调等待外部输入
 * - auto: 自动检测工具错误并注入修正消息
 *
 * @public
 */
export class FeedbackInjector {
  private readonly _options: Required<Pick<FeedbackOptions, 'timeout'>> & Pick<FeedbackOptions, 'mode' | 'onFeedback'>

  /**
   * 创建 FeedbackInjector。
   * @param options - 反馈配置
   */
  constructor(options: FeedbackOptions) {
    this._options = {
      mode: options.mode,
      onFeedback: options.onFeedback,
      timeout: options.timeout ?? DEFAULT_FEEDBACK_TIMEOUT_MS,
    }
  }

  /**
   * 等待用户反馈（支持超时）。
   *
   * 在 manual 模式下调用 onFeedback 回调等待外部输入。
   * 如果 onFeedback 未配置或返回 null/undefined，视作无反馈。
   * 超时后返回 null，避免永久阻塞。
   *
   * @param context - 当前轮次的反馈上下文
   * @returns 反馈输入，或 null（无反馈 / 超时）
   */
  async waitForFeedback(context: FeedbackContext): Promise<FeedbackInput | null> {
    if (this._options.mode !== 'manual' || !this._options.onFeedback) {
      return null
    }

    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), this._options.timeout))

    const feedbackPromise = this._options.onFeedback(context).then((result) => result ?? null)

    return Promise.race([feedbackPromise, timeoutPromise])
  }

  /**
   * 检查 auto 模式下是否需要自动修正。
   *
   * 检测本轮工具调用中是否有 isError 标记。
   * 如果有错误，生成一条自动修正消息注入到对话历史。
   *
   * @param toolCalls - 本轮工具调用记录
   * @returns 反馈输入（含自动修正文本），或 null（无需修正）
   */
  getAutoFeedback(toolCalls: FeedbackContext['toolCalls']): FeedbackInput | null {
    if (this._options.mode !== 'auto') return null
    if (toolCalls.length === 0) return null

    const failedCalls = toolCalls.filter((tc) => tc.isError)
    if (failedCalls.length === 0) return null

    const names = failedCalls.map((tc) => tc.name).join(', ')
    return {
      text: `[Auto-retry] The following tool calls failed and need retry: ${names}. Please retry with corrected parameters.`,
    }
  }

  /**
   * 将反馈注入到消息历史。
   *
   * - `text` 修正：追加一条新的 user message 到末尾
   * - `toolOverrides`：覆盖匹配 _toolUseId 的 tool result message 的内容
   *   未匹配的 toolOverrides 会追加一条说明消息
   *
   * @param messages - 原始消息历史
   * @param input - 反馈输入
   * @returns 注入后的新消息历史数组
   */
  applyFeedback(messages: Message[], input: FeedbackInput): Message[] {
    const result = [...messages]

    // 处理 toolOverrides：查找并覆盖匹配的 tool result 消息
    if (input.toolOverrides && input.toolOverrides.length > 0) {
      for (const override of input.toolOverrides) {
        const idx = result.findIndex(
          // @ts-expect-error _toolUseId is metadata injected by ask
          (m) => m._toolUseId === override.toolUseId,
        )
        if (idx !== -1) {
          result[idx] = {
            ...result[idx],
            content: override.correctedResult,
          } as Message
        }
      }
    }

    // 处理 text 修正：追加一条 user message
    if (input.text) {
      result.push({
        id: `${Date.now()}-feedback-${Math.random().toString(36).slice(2, 8)}`,
        role: 'user',
        content: input.text,
        createdAt: new Date().toISOString(),
      } as Message)
    }

    // 如果有 toolOverrides 但未匹配任何消息，追加说明
    if (input.toolOverrides && input.toolOverrides.length > 0 && !input.text) {
      // 如果已经有 text 修正则不需要额外消息
      const allMatched = input.toolOverrides.every((o) =>
        result.some(
          // @ts-expect-error _toolUseId is metadata
          (m) => m._toolUseId === o.toolUseId,
        ),
      )
      if (!allMatched) {
        result.push({
          id: `${Date.now()}-override-note-${Math.random().toString(36).slice(2, 8)}`,
          role: 'user',
          content: `[Feedback] The following tool results have been overridden: ${input.toolOverrides.map((o) => o.toolUseId).join(', ')}`,
          createdAt: new Date().toISOString(),
        } as Message)
      }
    }

    return result
  }
}
