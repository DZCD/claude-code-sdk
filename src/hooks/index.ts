/**
 * ClaudeCode SDK — Hook Module Index
 *
 * 事件钩子系统，支持在工具调用前后和 LLM 请求前后插入自定义逻辑。
 *
 * @public
 */

import { HookRegistry } from './registry.js'
export {
  HookRegistry,
  executePreToolHooks,
  executePostToolHooks,
  executePreTurnHooks,
  executePostTurnHooks,
} from './registry.js'
export type {
  HookPhase,
  PreToolHook,
  PostToolHook,
  PreTurnHook,
  PostTurnHook,
  PreToolHookResult,
  PreTurnHookResult,
  HookHandlerMap,
} from './types.js'

/**
 * HookSystem — 钩子系统门面类。
 *
 * 提供更简洁的统一 API 来管理钩子注册表。
 *
 * @example
 * ```typescript
 * const hooks = new HookSystem()
 * hooks.register('preTool', 'audit', async (name, input) => {
 *   console.log(`Tool ${name} called with`, input)
 *   return { allowed: true }
 * })
 * ```
 */
export class HookSystem {
  /** 底层钩子注册表 */
  readonly registry: HookRegistry

  constructor() {
    this.registry = new HookRegistry()
  }

  /** 注册一个钩子 */
  register<P extends HookPhase>(phase: P, name: string, handler: HookHandlerMap[P]): void {
    this.registry.register(phase, name, handler)
  }

  /** 取消注册一个钩子 */
  unregister(phase: HookPhase, name: string): boolean {
    return this.registry.unregister(phase, name)
  }

  /** 清空所有钩子 */
  clear(): void {
    this.registry.clear()
  }

  /** 获取所有已注册钩子的摘要 */
  getSummary(): Array<{ phase: HookPhase; name: string }> {
    return this.registry.getSummary()
  }
}
