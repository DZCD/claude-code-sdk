/**
 * Supplement tests for Hook system — preTool blocking, postTool triggers,
 * preTurn message modification, postTurn callbacks, chained execution,
 * and four-phase lifecycle integration.
 *
 * Complements hooks.test.ts, hooks-edge-cases.test.ts.
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

// ─── preTool — Blocking & Input Modification ────────────────

describe('HookSystem — preTool Blocking Scenarios', () => {
  it('should block tool execution with custom error message', async () => {
    const registry = new HookRegistry()
    registry.register('preTool', 'security', async (_name: string) => ({
      allowed: false,
      error: 'Custom security policy violation',
    }))

    const result = await executePreToolHooks(registry, 'dangerous-tool', { cmd: 'rm -rf /' })
    expect(result.allowed).toBe(false)
    expect(result.error).toBe('Custom security policy violation')
  })

  it('should allow execution with explicit allowed:true and no modifications', async () => {
    const registry = new HookRegistry()
    registry.register('preTool', 'passThrough', async () => ({ allowed: true }))

    const input = { cmd: 'ls' }
    const result = await executePreToolHooks(registry, 'safe-tool', input)
    expect(result.allowed).toBe(true)
    // When no modifiedInput is returned, original input is preserved
    expect(result.modifiedInput).toEqual(input)
  })

  it('should block and return error when modifiedInput changes do not affect the block', async () => {
    const registry = new HookRegistry()
    registry.register('preTool', 'modifyAndBlock', async () => ({
      allowed: false,
      error: 'Blocked with modification',
      modifiedInput: { cmd: 'safe' },
    }))

    const result = await executePreToolHooks(registry, 'test', { cmd: 'unsafe' })
    expect(result.allowed).toBe(false)
    // When blocked, modifiedInput from the blocking hook is not included
    expect(result.error).toBe('Blocked with modification')
  })
})

// ─── postTool — Triggering with Correct Signatures ─────────

describe('HookSystem — postTool Trigger Scenarios', () => {
  it('should call postTool hook with correct empty input and result', async () => {
    const registry = new HookRegistry()
    const handler = vi.fn()
    registry.register('postTool', 'logger', handler)

    await executePostToolHooks(registry, 'empty-tool', {}, null)
    expect(handler).toHaveBeenCalledWith('empty-tool', {}, null)
  })

  it('should call multiple postTool hooks in registration order with same args', async () => {
    const registry = new HookRegistry()
    const calls: string[] = []

    registry.register('postTool', 'first', async (name: string) => { calls.push(`first:${name}`) })
    registry.register('postTool', 'second', async (name: string) => { calls.push(`second:${name}`) })
    registry.register('postTool', 'third', async (name: string) => { calls.push(`third:${name}`) })

    await executePostToolHooks(registry, 'multi-tool', { key: 'val' }, { data: 'result' })
    expect(calls).toEqual(['first:multi-tool', 'second:multi-tool', 'third:multi-tool'])
  })

  it('should pass complex nested result to postTool hooks', async () => {
    const registry = new HookRegistry()
    const handler = vi.fn()
    registry.register('postTool', 'capture', handler)

    const complexResult = {
      content: [{ type: 'text', text: 'Hello' }],
      isError: false,
      metadata: { duration: 123, cached: true },
    }

    await executePostToolHooks(registry, 'complex-tool', { input: 'data' }, complexResult)
    expect(handler).toHaveBeenCalledWith('complex-tool', { input: 'data' }, complexResult)
  })
})

// ─── preTurn — Message Modification & Proceed ──────────────

describe('HookSystem — preTurn Message Modification', () => {
  it('should inject system message via preTurn hook', async () => {
    const registry = new HookRegistry()
    registry.register('preTurn', 'systemInjector', async (messages: unknown[]) => ({
      proceed: true,
      modifiedMessages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        ...messages,
      ],
    }))

    const original = [{ role: 'user', content: 'Hello' }]
    const result = await executePreTurnHooks(registry, original)
    expect(result.proceed).toBe(true)
    expect(result.modifiedMessages).toHaveLength(2)
    expect((result.modifiedMessages as any[])[0].role).toBe('system')
    expect((result.modifiedMessages as any[])[1].role).toBe('user')
  })

  it('should filter out messages via preTurn hook (return fewer messages)', async () => {
    const registry = new HookRegistry()
    registry.register('preTurn', 'filter', async (messages: unknown[]) => ({
      proceed: true,
      modifiedMessages: (messages as any[]).filter((m: any) => m.role !== 'system'),
    }))

    const original = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ]
    const result = await executePreTurnHooks(registry, original)
    expect(result.proceed).toBe(true)
    expect(result.modifiedMessages).toHaveLength(2)
  })

  it('should chain preTurn modifications across multiple hooks', async () => {
    const registry = new HookRegistry()
    registry.register('preTurn', 'hook1', async (messages: unknown[]) => ({
      proceed: true,
      modifiedMessages: [...(messages as any[]), { role: 'system', content: 'First injection' }],
    }))
    registry.register('preTurn', 'hook2', async (messages: unknown[]) => ({
      proceed: true,
      modifiedMessages: [...(messages as any[]), { role: 'system', content: 'Second injection' }],
    }))

    const original = [{ role: 'user', content: 'Hello' }]
    const result = await executePreTurnHooks(registry, original)
    expect(result.modifiedMessages).toHaveLength(3)
    const roles = (result.modifiedMessages as any[]).map((m: any) => m.role)
    expect(roles.filter((r: string) => r === 'system')).toHaveLength(2)
  })

  it('should stop preTurn chain when a hook returns proceed:false', async () => {
    const registry = new HookRegistry()
    const afterBlock = vi.fn()

    registry.register('preTurn', 'blocker', async () => ({ proceed: false }))
    registry.register('preTurn', 'after', async () => {
      afterBlock()
      return { proceed: true }
    })

    const result = await executePreTurnHooks(registry, [{ role: 'user', content: 'test' }])
    expect(result.proceed).toBe(false)
    expect(afterBlock).not.toHaveBeenCalled()
  })
})

// ─── postTurn — Callback Verification ──────────────────────

describe('HookSystem — postTurn Callback Verification', () => {
  it('should pass empty messages and response to postTurn hook', async () => {
    const registry = new HookRegistry()
    const handler = vi.fn()
    registry.register('postTurn', 'logger', handler)

    await executePostTurnHooks(registry, [], '')
    expect(handler).toHaveBeenCalledWith([], '')
  })

  it('should pass system messages and multi-line response to postTurn hook', async () => {
    const registry = new HookRegistry()
    const handler = vi.fn()
    registry.register('postTurn', 'capture', handler)

    const messages = [
      { role: 'system', content: 'System' },
      { role: 'user', content: 'User' },
      { role: 'assistant', content: 'Assistant' },
    ]
    const responseText = 'Line 1\nLine 2\nLine 3'

    await executePostTurnHooks(registry, messages, responseText)
    expect(handler).toHaveBeenCalledWith(messages, responseText)
  })

  it('should execute multiple postTurn hooks sequentially', async () => {
    const registry = new HookRegistry()
    const order: number[] = []

    registry.register('postTurn', 'a', async () => { order.push(1) })
    registry.register('postTurn', 'b', async () => { order.push(2) })
    registry.register('postTurn', 'c', async () => { order.push(3) })

    await executePostTurnHooks(registry, [], 'response')
    expect(order).toEqual([1, 2, 3])
  })
})

// ─── Four-Phase Lifecycle Integration ──────────────────────

describe('HookSystem — Four-Phase Lifecycle Integration', () => {
  it('should register and execute all four phases in a simulated lifecycle', async () => {
    const registry = new HookRegistry()
    const executionLog: string[] = []

    // Register all four phases
    registry.register('preTool', 'audit', async (name: string) => {
      executionLog.push(`preTool:${name}`)
      return { allowed: true }
    })
    registry.register('postTool', 'log', async (name: string) => {
      executionLog.push(`postTool:${name}`)
    })
    registry.register('preTurn', 'inject', async () => {
      executionLog.push('preTurn')
      return { proceed: true }
    })
    registry.register('postTurn', 'save', async () => {
      executionLog.push('postTurn')
    })

    // Simulate a lifecycle: preTurn -> LLM call -> postTurn -> preTool -> tool use -> postTool
    await executePreTurnHooks(registry, [{ role: 'user', content: 'hi' }])
    await executePostTurnHooks(registry, [], 'response')
    await executePreToolHooks(registry, 'test-tool', { cmd: 'test' })
    await executePostToolHooks(registry, 'test-tool', { cmd: 'test' }, { ok: true })

    expect(executionLog).toEqual([
      'preTurn',
      'postTurn',
      'preTool:test-tool',
      'postTool:test-tool',
    ])

    // Verify summary
    const summary = registry.getSummary()
    expect(summary).toHaveLength(4)
    expect(summary.map(s => s.name)).toContain('audit')
    expect(summary.map(s => s.name)).toContain('log')
    expect(summary.map(s => s.name)).toContain('inject')
    expect(summary.map(s => s.name)).toContain('save')
  })

  it('should allow hooks to be registered after previous execution', async () => {
    const registry = new HookRegistry()
    // Execute with empty registry
    await executePreToolHooks(registry, 'test', {})
    expect(registry.getSummary()).toHaveLength(0)

    // Now register and execute again
    registry.register('preTool', 'late', async () => ({ allowed: true }))
    const result = await executePreToolHooks(registry, 'test', { arg: 1 })
    expect(result.allowed).toBe(true)
    expect(result.modifiedInput).toEqual({ arg: 1 })
  })
})
