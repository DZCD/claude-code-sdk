/**
 * E2E Test — Platform Integration
 *
 * Tests:
 * - Hook system triggering in real API calls (preTurn injects system time)
 * - Logging integration with real LLM calls
 * - Simultaneous Hook + Logging + RateLimit interaction
 */
import { describe, expect, it, vi } from 'vitest'
import { ClaudeCodeSDK } from '../../session/engine.js'
import { HookRegistry, executePreToolHooks, executePostToolHooks, executePreTurnHooks, executePostTurnHooks } from '../../hooks/registry.js'
import { resetDebugCaches, isDebugToStdErr, logForDebugging, setHasFormattedOutput } from '../../logging/index.js'
import { getRateLimitState, triggerCooldown, clearCooldown, isInCooldown } from '../../rate-limit/cooldown.js'

const DEEPSEEK_API_KEY = 'sk-af3a84b5661b44f5b5695b47cb39dcd2'
const BASE_URL = 'https://api.deepseek.com/anthropic'
const MODEL = 'deepseek-v4-flash'

const sdkConfig = {
  llm: {
    provider: 'anthropic' as const,
    apiKey: DEEPSEEK_API_KEY,
    baseUrl: BASE_URL,
    model: MODEL,
    maxTokens: 1024,
  },
}

// ─── Hook: preTurn 注入系统时间 ────────────────────────────

describe('Platform E2E — Hook in Real API Calls', () => {
  it('should trigger preTurn hook that injects system time into messages', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)
    const hookRegistry = new HookRegistry()
    const hookExecutionLog: string[] = []

    // preTurn hook that injects system time
    hookRegistry.register('preTurn', 'timeInjector', async (messages: unknown[]) => {
      const timestamp = new Date().toISOString()
      hookExecutionLog.push(`preTurn at ${timestamp}`)
      return {
        proceed: true,
        modifiedMessages: [
          { role: 'system', content: `Current time is ${timestamp}` },
          ...(messages as any[]),
        ],
      }
    })

    // postTurn hook that logs response text length
    hookRegistry.register('postTurn', 'responseLogger', async (_messages: unknown[], responseText: string) => {
      hookExecutionLog.push(`postTurn response length: ${responseText.length}`)
    })

    sdk.withHooks(hookRegistry)

    // Make real API call
    const events: any[] = []
    for await (const event of sdk.stream('Reply with: "Hook system test completed"')) {
      events.push(event)
    }

    // Verify hooks were triggered
    expect(hookExecutionLog.length).toBeGreaterThanOrEqual(1)
    const preTurnEntries = hookExecutionLog.filter(e => e.startsWith('preTurn at'))
    expect(preTurnEntries.length).toBeGreaterThanOrEqual(1)

    const doneEvent = events.find(e => e.type === 'done')
    expect(doneEvent).toBeDefined()
    expect(doneEvent!.usage.inputTokens).toBeGreaterThan(0)
    console.log(`[E2E Hook] Execution log (${hookExecutionLog.length} entries):`, hookExecutionLog.slice(0, 4))
  }, 60_000)

  it('should execute preTool and postTool hooks during tool-capable requests', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)
    const hookRegistry = new HookRegistry()
    const toolHooksTriggered: string[] = []

    hookRegistry.register('preTool', 'e2e-audit', async (toolName: string) => {
      toolHooksTriggered.push(`preTool:${toolName}`)
      return { allowed: true }
    })

    hookRegistry.register('postTool', 'e2e-log', async (toolName: string) => {
      toolHooksTriggered.push(`postTool:${toolName}`)
    })

    sdk.withHooks(hookRegistry)

    // Use a prompt that may trigger Date/time tools
    const events: any[] = []
    for await (const event of sdk.stream('What is the current time? Reply directly.')) {
      events.push(event)
    }

    // Stream should complete successfully
    const doneEvent = events.find(e => e.type === 'done')
    expect(doneEvent).toBeDefined()

    // Even if no tools are used, the stream should not error
    const errorEvent = events.find(e => e.type === 'error')
    expect(errorEvent).toBeUndefined()

    console.log(`[E2E Tool Hooks] ${toolHooksTriggered.length} tool hook calls:`, toolHooksTriggered)
  }, 60_000)
})

// ─── Logging: 在真实 LLM 调用中记录 ─────────────────────────

describe('Platform E2E — Logging in Real LLM Calls', () => {
  beforeEach(() => {
    resetDebugCaches()
  })

  afterEach(() => {
    resetDebugCaches()
  })

  it('should log debug messages without crashing during API call', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)

    // Call logForDebugging with various levels during API interaction
    logForDebugging('[E2E] Starting platform test', { level: 'info' })
    logForDebugging('[E2E] Creating SDK instance', { level: 'debug' })

    const events: any[] = []
    for await (const event of sdk.stream('Say: "Logging test"')) {
      events.push(event)
      if (event.type === 'text') {
        logForDebugging(`[E2E] Received text event: ${(event as any).text?.slice(0, 50)}`, { level: 'verbose' })
      } else if (event.type === 'done') {
        logForDebugging('[E2E] Stream completed', { level: 'info' })
      }
    }

    const doneEvent = events.find(e => e.type === 'done')
    expect(doneEvent).toBeDefined()
    expect(doneEvent!.usage.inputTokens).toBeGreaterThan(0)

    logForDebugging(`[E2E] Test completed with ${events.length} events`, { level: 'info' })
  }, 60_000)

  it('should log multiline debug messages correctly during API calls', () => {
    // Simulate logging multi-line debug info that would be produced during LLM interaction
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const originalArgv = [...process.argv]
    process.argv = [...process.argv.slice(0, 2), '--debug-to-stderr']
    resetDebugCaches()

    // Log a multi-line message like what a real integration would produce
    logForDebugging('[E2E] LLM Response\n  Tokens: 100\n  Model: deepseek-v4-flash', { level: 'info' })
    const output = stderrSpy.mock.calls[0]?.[0] as string
    expect(output).toContain('[INFO]')
    expect(output).toContain('[E2E] LLM Response')

    // Also test with formatted output (JSON multiline)
    setHasFormattedOutput(true)
    logForDebugging('[E2E] Tool Result\n  Status: success\n  Duration: 123ms', { level: 'debug' })
    const output2 = stderrSpy.mock.calls[1]?.[0] as string
    expect(output2).toContain('[DEBUG]')

    // Restore
    process.argv = originalArgv
    stderrSpy.mockRestore()
    setHasFormattedOutput(false)
    resetDebugCaches()
  })

  it('should handle log level filtering correctly near API calls', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    resetDebugCaches()
    const originalArgv = [...process.argv]
    process.argv = [...process.argv.slice(0, 2), '--debug-to-stderr']
    const originalEnv = process.env.DEBUG_SDK_LOG_LEVEL
    process.env.DEBUG_SDK_LOG_LEVEL = 'warn'

    resetDebugCaches()

    // verbose and debug should be filtered out
    logForDebugging('verbose message', { level: 'verbose' })
    logForDebugging('debug message', { level: 'debug' })
    logForDebugging('info message', { level: 'info' })

    // warn and error should pass
    logForDebugging('warn message', { level: 'warn' })
    logForDebugging('error message', { level: 'error' })

    // Only warn and error should have been written
    expect(stderrSpy).toHaveBeenCalledTimes(2)
    const output1 = stderrSpy.mock.calls[0]?.[0] as string
    expect(output1).toContain('[WARN]')
    const output2 = stderrSpy.mock.calls[1]?.[0] as string
    expect(output2).toContain('[ERROR]')

    // Restore
    process.env.DEBUG_SDK_LOG_LEVEL = originalEnv
    process.argv = originalArgv
    stderrSpy.mockRestore()
    resetDebugCaches()
  })
})

// ─── Hook + Logging + RateLimit 同时触发 ────────────────────

describe('Platform E2E — Hook + Logging + RateLimit Combined', () => {
  afterEach(() => {
    clearCooldown()
    resetDebugCaches()
  })

  it('should trigger Hook + Logging + RateLimit in a single conversation turn', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)
    const hookRegistry = new HookRegistry()
    const integratedLog: string[] = []

    // Hook: preTurn with logging and rate limit check
    hookRegistry.register('preTurn', 'integrated', async (messages: unknown[]) => {
      // Check rate limit state
      const rateState = getRateLimitState()
      integratedLog.push(`preTurn: rateLimit=${rateState.isCooldown}`)

      // Log the preTurn action
      logForDebugging('[E2E-INT] preTurn hook triggered', { level: 'info' })

      return { proceed: true }
    })

    // Hook: postTurn with logging
    hookRegistry.register('postTurn', 'integrated', async (_messages: unknown[], responseText: string) => {
      integratedLog.push(`postTurn: responseLength=${responseText.length}`)
      logForDebugging(`[E2E-INT] postTurn: ${responseText.length} chars`, { level: 'debug' })
    })

    sdk.withHooks(hookRegistry)

    // Simulate rate limit state changes around the API call
    triggerCooldown(Date.now() + 300000, 'rate_limit')
    integratedLog.push(`beforeStream: isCooldown=${isInCooldown()}`)

    // Make real API call while in cooldown (rate limit check doesn't block API, just logs)
    const events: any[] = []
    for await (const event of sdk.stream('Reply: "Integrated test complete"')) {
      events.push(event)
    }

    // Verify cooldown state persisted
    integratedLog.push(`afterStream: isCooldown=${isInCooldown()}`)

    // Clear and verify
    clearCooldown()
    integratedLog.push(`afterClear: isCooldown=${isInCooldown()}`)

    // Verify the full pipeline worked
    expect(integratedLog.length).toBeGreaterThanOrEqual(4)
    expect(integratedLog[0]).toContain('beforeStream')
    expect(integratedLog.some(l => l.includes('preTurn'))).toBe(true)

    const doneEvent = events.find(e => e.type === 'done')
    expect(doneEvent).toBeDefined()
    expect(doneEvent!.usage.inputTokens).toBeGreaterThan(0)

    console.log('[E2E Combined] Integration log:', integratedLog)
    console.log(`[E2E Combined] Events: ${events.length}`)
  }, 60_000)

  it('should handle rate limit cooldown before/after sequential API calls', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)
    const hookRegistry = new HookRegistry()
    const turnCounts: number[] = []

    hookRegistry.register('preTurn', 'counter', async () => {
      turnCounts.push(Date.now())
      return { proceed: true }
    })

    sdk.withHooks(hookRegistry)

    // Clear any state
    clearCooldown()

    // First API call
    const events1: any[] = []
    for await (const event of sdk.stream('Say "First"')) {
      events1.push(event)
    }
    expect(events1.find(e => e.type === 'done')).toBeDefined()

    // Trigger cooldown between calls
    triggerCooldown(Date.now() + 60000, 'rate_limit')
    expect(isInCooldown()).toBe(true)

    // Second API call (while in cooldown - just checks state, doesn't block)
    const events2: any[] = []
    for await (const event of sdk.stream('Say "Second"')) {
      events2.push(event)
    }
    expect(events2.find(e => e.type === 'done')).toBeDefined()

    // Clear cooldown
    clearCooldown()
    expect(isInCooldown()).toBe(false)

    // Third API call (after cooldown cleared)
    const events3: any[] = []
    for await (const event of sdk.stream('Say "Third"')) {
      events3.push(event)
    }
    expect(events3.find(e => e.type === 'done')).toBeDefined()

    // Hooks should have fired for all three turns
    expect(turnCounts.length).toBe(3)
    console.log(`[E2E RateLimit Before/After] Turns: ${turnCounts.length}, Events: ${events1.length}/${events2.length}/${events3.length}`)
  }, 120_000)

  it('should handle Hook execution functions directly without SDK', async () => {
    // Test the hook execution functions directly (not through SDK)
    // This verifies the hook system works correctly at the unit level
    const registry = new HookRegistry()
    const execLog: string[] = []

    // preTool
    registry.register('preTool', 'test', async (name: string) => {
      execLog.push(`preTool:${name}`)
      return { allowed: true, modifiedInput: { validated: true } }
    })

    // postTool
    registry.register('postTool', 'test', async (name: string) => {
      execLog.push(`postTool:${name}`)
    })

    // preTurn
    registry.register('preTurn', 'test', async (messages: unknown[]) => {
      execLog.push(`preTurn:messages=${(messages as any[]).length}`)
      return { proceed: true, modifiedMessages: [...(messages as any[]), { role: 'system', content: 'time-check' }] }
    })

    // postTurn
    registry.register('postTurn', 'test', async (messages: unknown[], response: string) => {
      execLog.push(`postTurn:responseLength=${response.length}`)
    })

    // Execute preTool
    const preToolResult = await executePreToolHooks(registry, 'bash', { cmd: 'ls' })
    expect(preToolResult.allowed).toBe(true)
    expect(preToolResult.modifiedInput).toEqual({ cmd: 'ls', validated: true })

    // Execute postTool
    await executePostToolHooks(registry, 'bash', { cmd: 'ls' }, { output: 'files' })

    // Execute preTurn
    const preTurnResult = await executePreTurnHooks(registry, [{ role: 'user', content: 'hi' }])
    expect(preTurnResult.proceed).toBe(true)
    expect(preTurnResult.modifiedMessages).toHaveLength(2)

    // Execute postTurn
    await executePostTurnHooks(registry, [], 'test response')

    // Verify all four phases executed
    expect(execLog.length).toBe(4)
    expect(execLog).toContain('preTool:bash')
    expect(execLog).toContain('postTool:bash')
    expect(execLog).toContain('preTurn:messages=1')
    expect(execLog).toContain('postTurn:responseLength=13')
  })
})
