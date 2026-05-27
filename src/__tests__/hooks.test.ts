/**
 * Phase 3C — D1: Hook System 测试
 *
 * 测试覆盖：
 * - 注册/取消注册 (register/unregister)
 * - 4 种钩子类型 (preTool, postTool, preTurn, postTurn)
 * - 执行引擎 (executePreToolHooks, executePostToolHooks, etc.)
 * - 链式执行
 * - 输入/消息修改
 * - 阻止执行
 * - 异常情况
 */
import { describe, expect, it, vi } from 'vitest'
import { HookSystem } from '../hooks/index.js'
import {
  HookRegistry,
  executePostToolHooks,
  executePostTurnHooks,
  executePreToolHooks,
  executePreTurnHooks,
} from '../hooks/registry.js'

describe('HookSystem — 注册表', () => {
  it('应注册 preTool 钩子并通过 getHooks 获取', () => {
    const registry = new HookRegistry()
    const handler = vi.fn()
    registry.register('preTool', 'testHook', handler)
    const hooks = registry.getHooks('preTool')
    expect(hooks.has('testHook')).toBe(true)
    expect(hooks.get('testHook')).toBe(handler)
  })

  it('应注册 postTool 钩子', () => {
    const registry = new HookRegistry()
    const handler = vi.fn()
    registry.register('postTool', 'logHook', handler)
    expect(registry.getHooks('postTool').has('logHook')).toBe(true)
  })

  it('应注册 preTurn 钩子', () => {
    const registry = new HookRegistry()
    const handler = vi.fn()
    registry.register('preTurn', 'authHook', handler)
    expect(registry.getHooks('preTurn').has('authHook')).toBe(true)
  })

  it('应注册 postTurn 钩子', () => {
    const registry = new HookRegistry()
    const handler = vi.fn()
    registry.register('postTurn', 'logHook', handler)
    expect(registry.getHooks('postTurn').has('logHook')).toBe(true)
  })

  it('取消注册已存在的钩子应返回 true', () => {
    const registry = new HookRegistry()
    registry.register('preTool', 'test', vi.fn())
    expect(registry.unregister('preTool', 'test')).toBe(true)
    expect(registry.getHooks('preTool').has('test')).toBe(false)
  })

  it('取消注册不存在的钩子应返回 false', () => {
    const registry = new HookRegistry()
    expect(registry.unregister('preTool', 'nonexistent')).toBe(false)
  })

  it('清空所有钩子', () => {
    const registry = new HookRegistry()
    registry.register('preTool', 'a', vi.fn())
    registry.register('postTool', 'b', vi.fn())
    registry.clear()
    expect(registry.getHooks('preTool').size).toBe(0)
    expect(registry.getHooks('postTool').size).toBe(0)
  })

  it('getSummary 返回所有已注册钩子的摘要', () => {
    const registry = new HookRegistry()
    registry.register('preTool', 'hook1', vi.fn())
    registry.register('preTool', 'hook2', vi.fn())
    registry.register('postTurn', 'hook3', vi.fn())
    const summary = registry.getSummary()
    expect(summary).toContainEqual({ phase: 'preTool', name: 'hook1' })
    expect(summary).toContainEqual({ phase: 'preTool', name: 'hook2' })
    expect(summary).toContainEqual({ phase: 'postTurn', name: 'hook3' })
    expect(summary).toHaveLength(3)
  })

  it('注册同名钩子应覆盖旧钩子', () => {
    const registry = new HookRegistry()
    const handler1 = vi.fn()
    const handler2 = vi.fn()
    registry.register('preTool', 'myHook', handler1)
    registry.register('preTool', 'myHook', handler2)
    expect(registry.getHooks('preTool').get('myHook')).toBe(handler2)
  })
})

describe('HookSystem — preTool 执行引擎', () => {
  it('无钩子时返回 allowed=true 且 input 不变', async () => {
    const registry = new HookRegistry()
    const input = { cmd: 'ls' }
    const result = await executePreToolHooks(registry, 'bash', input)
    expect(result.allowed).toBe(true)
    expect(result.modifiedInput).toEqual(input)
  })

  it('钩子可阻止工具执行', async () => {
    const registry = new HookRegistry()
    registry.register('preTool', 'blocker', async (_toolName: string) => ({
      allowed: false,
      error: 'Blocked by security policy',
    }))
    const result = await executePreToolHooks(registry, 'rm', { path: '/' })
    expect(result.allowed).toBe(false)
    expect(result.error).toBe('Blocked by security policy')
  })

  it('钩子可修改输入', async () => {
    const registry = new HookRegistry()
    registry.register('preTool', 'modifier', async (_toolName: string, input: Record<string, unknown>) => ({
      allowed: true,
      modifiedInput: { ...input, sanitized: true },
    }))
    const result = await executePreToolHooks(registry, 'bash', {
      cmd: 'rm -rf /',
    })
    expect(result.allowed).toBe(true)
    expect(result.modifiedInput).toEqual({ cmd: 'rm -rf /', sanitized: true })
  })

  it('多个 preTool 钩子按注册顺序链式执行', async () => {
    const registry = new HookRegistry()
    const order: number[] = []

    registry.register('preTool', 'first', async () => {
      order.push(1)
      return { allowed: true }
    })
    registry.register('preTool', 'second', async () => {
      order.push(2)
      return { allowed: true }
    })
    registry.register('preTool', 'third', async () => {
      order.push(3)
      return { allowed: true }
    })

    await executePreToolHooks(registry, 'test', {})
    expect(order).toEqual([1, 2, 3])
  })

  it('链式修改输入: 前一个钩子的输出传递给下一个钩子', async () => {
    const registry = new HookRegistry()

    registry.register('preTool', 'addFlag', async (_name: string, input: Record<string, unknown>) => ({
      allowed: true,
      modifiedInput: { ...input, flag: true },
    }))
    registry.register('preTool', 'addMode', async (_name: string, input: Record<string, unknown>) => ({
      allowed: true,
      modifiedInput: { ...input, mode: 'safe' },
    }))

    const result = await executePreToolHooks(registry, 'test', { cmd: 'ls' })
    expect(result.modifiedInput).toEqual({
      cmd: 'ls',
      flag: true,
      mode: 'safe',
    })
  })

  it('任何钩子返回 allowed=false 时立即停止链式执行', async () => {
    const registry = new HookRegistry()
    const afterBlockCalled = vi.fn()

    registry.register('preTool', 'blocker', async () => ({
      allowed: false,
      error: 'Blocked',
    }))
    registry.register('preTool', 'after', async () => {
      afterBlockCalled()
      return { allowed: true }
    })

    await executePreToolHooks(registry, 'test', {})
    expect(afterBlockCalled).not.toHaveBeenCalled()
  })
})

describe('HookSystem — postTool 执行引擎', () => {
  it('postTool 钩子被调用并收到正确参数', async () => {
    const registry = new HookRegistry()
    const handler = vi.fn()
    registry.register('postTool', 'logger', handler)
    const input = { cmd: 'ls' }
    const result = { content: 'file1.txt' }
    await executePostToolHooks(registry, 'bash', input, result)
    expect(handler).toHaveBeenCalledWith('bash', input, result)
  })

  it('多个 postTool 钩子依次执行', async () => {
    const registry = new HookRegistry()
    const order: number[] = []
    registry.register('postTool', 'a', async () => {
      order.push(1)
    })
    registry.register('postTool', 'b', async () => {
      order.push(2)
    })
    await executePostToolHooks(registry, 'test', {}, {})
    expect(order).toEqual([1, 2])
  })

  it('无 postTool 钩子时不报错', async () => {
    const registry = new HookRegistry()
    await expect(executePostToolHooks(registry, 'test', {}, {})).resolves.toBeUndefined()
  })
})

describe('HookSystem — preTurn 执行引擎', () => {
  it('无钩子时返回 proceed=true 且 messages 不变', async () => {
    const registry = new HookRegistry()
    const messages = [{ role: 'user', content: 'hello' }]
    const result = await executePreTurnHooks(registry, messages)
    expect(result.proceed).toBe(true)
    expect(result.modifiedMessages).toEqual(messages)
  })

  it('钩子可阻止 LLM 请求', async () => {
    const registry = new HookRegistry()
    registry.register('preTurn', 'rateLimiter', async () => ({
      proceed: false,
    }))
    const result = await executePreTurnHooks(registry, [{ role: 'user', content: 'hello' }])
    expect(result.proceed).toBe(false)
  })

  it('钩子可修改消息列表', async () => {
    const registry = new HookRegistry()
    registry.register('preTurn', 'contextInjector', async (messages: unknown[]) => ({
      proceed: true,
      modifiedMessages: [...messages, { role: 'system', content: 'extra context' }],
    }))
    const original = [{ role: 'user', content: 'hello' }]
    const result = await executePreTurnHooks(registry, original)
    expect(result.modifiedMessages).toHaveLength(2)
    expect(result.modifiedMessages?.[1]).toEqual({
      role: 'system',
      content: 'extra context',
    })
  })
})

describe('HookSystem — postTurn 执行引擎', () => {
  it('postTurn 钩子被调用并收到正确参数', async () => {
    const registry = new HookRegistry()
    const handler = vi.fn()
    registry.register('postTurn', 'logger', handler)
    const messages = [{ role: 'user', content: 'hi' }]
    await executePostTurnHooks(registry, messages, 'Hello!')
    expect(handler).toHaveBeenCalledWith(messages, 'Hello!')
  })

  it('无 postTurn 钩子时不报错', async () => {
    const registry = new HookRegistry()
    await expect(executePostTurnHooks(registry, [], '')).resolves.toBeUndefined()
  })
})

describe('HookSystem — 门面类', () => {
  it('HookSystem 封装 register/unregister/clear/getSummary', () => {
    const system = new HookSystem()
    const handler = vi.fn()
    system.register('preTool', 'myHook', handler)
    expect(system.getSummary()).toContainEqual({
      phase: 'preTool',
      name: 'myHook',
    })
    system.unregister('preTool', 'myHook')
    expect(system.getSummary()).toHaveLength(0)
  })

  it('clear 清空所有钩子', () => {
    const system = new HookSystem()
    system.register('preTool', 'a', vi.fn())
    system.register('postTool', 'b', vi.fn())
    system.clear()
    expect(system.getSummary()).toHaveLength(0)
  })

  it('可通过 system.registry 访问底层 HookRegistry', () => {
    const system = new HookSystem()
    expect(system.registry).toBeDefined()
    expect(typeof system.registry.register).toBe('function')
  })
})

describe('HookSystem — 异步钩子', () => {
  it('preTool 钩子支持 async/await', async () => {
    const registry = new HookRegistry()
    registry.register('preTool', 'async', async (_name: string) => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return { allowed: false, error: 'async blocked' }
    })
    const result = await executePreToolHooks(registry, 'test', {})
    expect(result.allowed).toBe(false)
    expect(result.error).toBe('async blocked')
  })
})

describe('HookSystem — 边界情况', () => {
  it('空注册表 unregister 返回 false', () => {
    const registry = new HookRegistry()
    expect(registry.unregister('preTool', 'nonexistent')).toBe(false)
  })

  it('获取未注册阶段的钩子返回空 Map', () => {
    const registry = new HookRegistry()
    expect(registry.getHooks('preTool').size).toBe(0)
    expect(registry.getHooks('postTool').size).toBe(0)
    expect(registry.getHooks('preTurn').size).toBe(0)
    expect(registry.getHooks('postTurn').size).toBe(0)
  })

  it('clear 不会报错即使注册表已空', () => {
    const registry = new HookRegistry()
    expect(() => registry.clear()).not.toThrow()
  })
})
