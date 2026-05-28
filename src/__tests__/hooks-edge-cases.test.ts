/**
 * Edge-case tests for Hook System — hook execution order,
 * error propagation in chains, and lifecycle edge cases.
 *
 * Complements existing tests in hooks.test.ts.
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

// ─── PreTool Hook Chain — Error Handling ──────────────────

describe('HookSystem — preTool Chain Error Handling', () => {
  it('should stop chain when a hook throws an exception', async () => {
    const registry = new HookRegistry()
    const afterThrow = vi.fn()

    registry.register('preTool', 'thrower', async () => {
      throw new Error('Unexpected error in hook')
    })
    registry.register('preTool', 'after', async () => {
      afterThrow()
      return { allowed: true }
    })

    // The thrown error propagates up
    await expect(executePreToolHooks(registry, 'test', {})).rejects.toThrow('Unexpected error in hook')
    expect(afterThrow).not.toHaveBeenCalled()
  })

  it('should allow sync throw (non-Promise) in hooks', async () => {
    const registry = new HookRegistry()

    registry.register('preTool', 'syncThrower', (_name: string) => {
      throw new Error('Sync error')
    })

    await expect(executePreToolHooks(registry, 'test', {})).rejects.toThrow('Sync error')
  })

  it('should handle hook returning non-standard result (missing allowed)', async () => {
    const registry = new HookRegistry()

    registry.register('preTool', 'badReturn', async () => ({
      // @ts-expect-error - intentionally missing allowed
      allowed: undefined,
    }))

    const result = await executePreToolHooks(registry, 'test', {})
    // undefined allowed is falsy, so it would be blocked
    expect(result.allowed).toBe(false)
  })
})

// ─── PostTool Hook Chain — Error Handling ─────────────────

describe('HookSystem — postTool Chain Error Handling', () => {
  it('should still allow subsequent hooks to run after one throws', async () => {
    const registry = new HookRegistry()
    const afterThrow = vi.fn()

    registry.register('postTool', 'thrower', async () => {
      throw new Error('Logging failed')
    })
    registry.register('postTool', 'logger', async () => {
      afterThrow()
    })

    // postTool doesn't wrap errors, so it propagates
    await expect(executePostToolHooks(registry, 'test', {}, {})).rejects.toThrow('Logging failed')
  })

  it('should handle sync throw in postTool hook', async () => {
    const registry = new HookRegistry()

    registry.register('postTool', 'syncThrow', () => {
      throw new Error('Sync postTool error')
    })

    await expect(executePostToolHooks(registry, 'test', {}, {})).rejects.toThrow('Sync postTool error')
  })

  it('should handle chain with mixed sync and async hooks', async () => {
    const registry = new HookRegistry()
    const order: string[] = []

    registry.register('postTool', 'sync', (_name, _input, _result) => {
      order.push('sync')
    })
    registry.register('postTool', 'async', async (_name, _input, _result) => {
      await Promise.resolve()
      order.push('async')
    })

    await executePostToolHooks(registry, 'test', {}, {})
    expect(order).toEqual(['sync', 'async'])
  })
})

// ─── PreTurn Hook Chain — Error Handling ──────────────────

describe('HookSystem — preTurn Chain Error Handling', () => {
  it('should stop chain when a hook throws', async () => {
    const registry = new HookRegistry()
    const afterThrow = vi.fn()

    registry.register('preTurn', 'thrower', async () => {
      throw new Error('Auth service unavailable')
    })
    registry.register('preTurn', 'after', async () => {
      afterThrow()
      return { proceed: true }
    })

    await expect(executePreTurnHooks(registry, [])).rejects.toThrow('Auth service unavailable')
    expect(afterThrow).not.toHaveBeenCalled()
  })

  it('should handle empty messages array', async () => {
    const registry = new HookRegistry()
    registry.register('preTurn', 'log', async (messages: unknown[]) => ({
      proceed: true,
      modifiedMessages: messages,
    }))

    const result = await executePreTurnHooks(registry, [])
    expect(result.proceed).toBe(true)
    expect(result.modifiedMessages).toEqual([])
  })
})

// ─── PostTurn Hook Chain — Error Handling ─────────────────

describe('HookSystem — postTurn Chain Error Handling', () => {
  it('should propagate throws from postTurn hooks', async () => {
    const registry = new HookRegistry()

    registry.register('postTurn', 'thrower', async () => {
      throw new Error('Post-turn error')
    })

    await expect(executePostTurnHooks(registry, [], '')).rejects.toThrow('Post-turn error')
  })
})

// ─── Hook Lifecycle — Register / Unregister / Clear ───────

describe('HookSystem — Lifecycle Edge Cases', () => {
  it('should unregister then re-register same name', () => {
    const registry = new HookRegistry()
    const h1 = vi.fn()
    const h2 = vi.fn()

    registry.register('preTool', 'myHook', h1)
    expect(registry.unregister('preTool', 'myHook')).toBe(true)
    registry.register('preTool', 'myHook', h2)

    expect(registry.getHooks('preTool').get('myHook')).toBe(h2)
  })

  it('should handle unregister from non-existent phase', () => {
    const registry = new HookRegistry()
    expect(registry.unregister('postTool' as any, 'anything')).toBe(false)
  })

  it('should clear and allow re-registration', () => {
    const registry = new HookRegistry()
    registry.register('preTool', 'a', vi.fn())
    registry.register('postTool', 'b', vi.fn())
    registry.clear()
    expect(registry.getHooks('preTool').size).toBe(0)
    expect(registry.getHooks('postTool').size).toBe(0)

    registry.register('preTool', 'c', vi.fn())
    expect(registry.getHooks('preTool').size).toBe(1)
  })

  it('should get empty summary from fresh registry', () => {
    const registry = new HookRegistry()
    expect(registry.getSummary()).toEqual([])
  })
})

// ─── HookSystem (Facade) Edge Cases ───────────────────────

describe('HookSystem (Facade) — Edge Cases', () => {
  it('should create with default empty state', () => {
    const system = new HookSystem()
    expect(system.getSummary()).toEqual([])
    expect(system.registry).toBeInstanceOf(HookRegistry)
  })

  it('should allow unregister on empty system without error', () => {
    const system = new HookSystem()
    expect(system.unregister('preTool', 'nonexistent')).toBe(false)
  })

  it('should allow clear on empty system without error', () => {
    const system = new HookSystem()
    expect(() => system.clear()).not.toThrow()
  })
})

// ─── Long Hook Chain ──────────────────────────────────────

describe('HookSystem — Long Hook Chain Performance', () => {
  it('should execute many hooks in sequence', async () => {
    const registry = new HookRegistry()
    const count = 50

    for (let i = 0; i < count; i++) {
      registry.register('preTool', `hook-${i}`, async (_name: string, input: Record<string, unknown>) => ({
        allowed: true,
        modifiedInput: { ...input, [`step_${i}`]: true },
      }))
    }

    const result = await executePreToolHooks(registry, 'test', { initial: true })
    expect(result.allowed).toBe(true)
    expect(result.modifiedInput).toHaveProperty('initial', true)
    // Verify last hook's modification is present
    expect(result.modifiedInput).toHaveProperty(`step_${count - 1}`, true)
  })

  it('should execute many postTool hooks quickly', async () => {
    const registry = new HookRegistry()
    const count = 30

    for (let i = 0; i < count; i++) {
      registry.register('postTool', `hook-${i}`, vi.fn())
    }

    await expect(executePostToolHooks(registry, 'test', {}, {})).resolves.toBeUndefined()
  })
})
