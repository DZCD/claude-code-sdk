/**
 * ClaudeCode SDK — Hook Registry
 *
 * 钩子注册表核心实现，提供注册、取消注册、查询和执行功能。
 *
 * @public
 */

import type {
  HookHandlerMap,
  HookPhase,
  PostToolHook,
  PostTurnHook,
  PreToolHook,
  PreToolHookResult,
  PreTurnHook,
  PreTurnHookResult,
} from './types.js'

/**
 * 钩子注册表 — 管理所有阶段的生命周期钩子。
 */
export class HookRegistry {
  private readonly _hooks = new Map<HookPhase, Map<string, unknown>>()

  /**
   * 注册一个钩子。
   * @param phase - 钩子阶段
   * @param name - 钩子名称（同一阶段内唯一，同名覆盖）
   * @param handler - 处理函数
   */
  register<P extends HookPhase>(phase: P, name: string, handler: HookHandlerMap[P]): void {
    if (!this._hooks.has(phase)) {
      this._hooks.set(phase, new Map())
    }
    this._hooks.get(phase)!.set(name, handler)
  }

  /**
   * 取消注册一个钩子。
   * @returns true=成功删除, false=钩子不存在
   */
  unregister(phase: HookPhase, name: string): boolean {
    const phaseHooks = this._hooks.get(phase)
    if (!phaseHooks) return false
    return phaseHooks.delete(name)
  }

  /**
   * 获取某阶段的所有钩子。
   */
  getHooks<P extends HookPhase>(phase: P): Map<string, HookHandlerMap[P]> {
    return (this._hooks.get(phase) ?? new Map()) as Map<string, HookHandlerMap[P]>
  }

  /**
   * 清空所有钩子。
   */
  clear(): void {
    this._hooks.clear()
  }

  /**
   * 获取所有已注册钩子的摘要。
   */
  getSummary(): Array<{ phase: HookPhase; name: string }> {
    const summary: Array<{ phase: HookPhase; name: string }> = []
    for (const [phase, handlers] of this._hooks) {
      for (const name of handlers.keys()) {
        summary.push({ phase, name })
      }
    }
    return summary
  }
}

/**
 * 执行 preTool 钩子链。
 * 按注册顺序依次调用，任何钩子返回 allowed=false 时立即停止。
 */
export async function executePreToolHooks(
  registry: HookRegistry,
  toolName: string,
  input: Record<string, unknown>,
): Promise<PreToolHookResult> {
  const handlers = registry.getHooks('preTool')
  let currentInput = input

  for (const [, handler] of handlers) {
    const result = await (handler as PreToolHook)(toolName, currentInput)
    if (!result.allowed) {
      return { allowed: false, error: result.error ?? 'Blocked by hook' }
    }
    if (result.modifiedInput !== undefined) {
      currentInput = result.modifiedInput
    }
  }

  return { allowed: true, modifiedInput: currentInput }
}

/**
 * 执行 postTool 钩子链。
 */
export async function executePostToolHooks(
  registry: HookRegistry,
  toolName: string,
  input: Record<string, unknown>,
  result: unknown,
): Promise<void> {
  const handlers = registry.getHooks('postTool')
  for (const [, handler] of handlers) {
    await (handler as PostToolHook)(toolName, input, result)
  }
}

/**
 * 执行 preTurn 钩子链。
 */
export async function executePreTurnHooks(registry: HookRegistry, messages: unknown[]): Promise<PreTurnHookResult> {
  const handlers = registry.getHooks('preTurn')
  let currentMessages = messages

  for (const [, handler] of handlers) {
    const result = await (handler as PreTurnHook)(currentMessages)
    if (!result.proceed) {
      return { proceed: false }
    }
    if (result.modifiedMessages !== undefined) {
      currentMessages = result.modifiedMessages
    }
  }

  return { proceed: true, modifiedMessages: currentMessages }
}

/**
 * 执行 postTurn 钩子链。
 */
export async function executePostTurnHooks(
  registry: HookRegistry,
  messages: unknown[],
  responseText: string,
): Promise<void> {
  const handlers = registry.getHooks('postTurn')
  for (const [, handler] of handlers) {
    await (handler as PostTurnHook)(messages, responseText)
  }
}
