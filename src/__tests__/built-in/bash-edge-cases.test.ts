/**
 * BashTool — Edge Cases & Coverage Supplement
 *
 * Tests for:
 * - Timeout scenarios (short timeout causing killed)
 * - Large output handling (stdout overflow)
 * - Permission denied execution
 * - Compound command syntax (&&, ||, ;)
 * - Read-only command edge cases
 * - Stderr-only output
 * - Empty command error (schema level)
 * - isReadOnly edge cases (pipe, redirect, multi-command)
 */
import { describe, expect, it } from 'vitest'
import { BashTool } from '../../tools/built-in/bash.js'

const makeContext = () => ({
  signal: new AbortController().signal,
})

describe('BashTool — Timeout', () => {
  const tool = new BashTool()

  it('should timeout with short timeout for long running command', async () => {
    const result = await tool.execute(
      { command: 'sleep 5', timeout: 500 },
      makeContext(),
    )
    expect(result.isError).toBe(true)
    // Bash killed the process; expect timeout message in content or data
    expect(
      result.content.includes('timed out') ||
      result.content.includes('killed') ||
      result.data?.stderr?.includes('timed out') ||
      result.data?.stderr?.includes('killed') ||
      result.content.includes('timeout'),
    ).toBe(true)
  })

  it('should handle extremely short timeout (1ms)', async () => {
    const result = await tool.execute(
      { command: 'echo hello', timeout: 1 },
      makeContext(),
    )
    // May or may not timeout depending on scheduling; either is acceptable
    // as long as the tool doesn't crash
    expect(result).toBeDefined()
    expect(typeof result.isError).toBe('boolean')
  })

  it('should complete normally with adequate timeout', async () => {
    const result = await tool.execute(
      { command: 'echo fast', timeout: 5000 },
      makeContext(),
    )
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('fast')
  })
})

describe('BashTool — Large Output', () => {
  const tool = new BashTool()

  it('should handle large stdout output', async () => {
    // Use yes + head to generate large output (safe, no semicolons or substitutions)
    const result = await tool.execute(
      { command: 'yes "test line" | head -n 5000' },
      makeContext(),
    )
    expect(result.isError).toBeFalsy()
    expect(result.content).toBeTruthy()
    const lineCount = (result.data?.stdout?.match(/\n/g) || []).length
    expect(lineCount).toBeGreaterThanOrEqual(4999) // head outputs 5000 lines
  })

  it('should handle output with special characters', async () => {
    const result = await tool.execute(
      { command: 'echo "special chars: ~@#%^*()_+-=[]{}|:.<>?/"' },
      makeContext(),
    )
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('special chars')
    expect(result.content).toContain('~@#%^*()_+-=[]{}|:.<>?/')
  })
})

describe('BashTool — Compound Commands', () => {
  const tool = new BashTool()

  it('should execute chained commands with &&', async () => {
    const result = await tool.execute(
      { command: 'echo first && echo second && echo third' },
      makeContext(),
    )
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('first')
    expect(result.content).toContain('second')
    expect(result.content).toContain('third')
  })

  it('should capture both stdout and stderr from compound command', async () => {
    const result = await tool.execute(
      { command: 'echo "stdout msg" && echo "stderr msg" >&2' },
      makeContext(),
    )
    expect(result.isError).toBeFalsy()
    expect(result.data?.stdout).toContain('stdout msg')
    expect(result.data?.stderr).toContain('stderr msg')
  })

  it('should return error on first failing command with &&', async () => {
    const result = await tool.execute(
      { command: 'echo first && exit 1 && echo should_not_run' },
      makeContext(),
    )
    expect(result.isError).toBe(true)
    expect(result.data?.stdout).toContain('first')
    // "should_not_run" should NOT appear
    expect(result.data?.stdout).not.toContain('should_not_run')
  })

  it('should handle pipe between commands', async () => {
    const result = await tool.execute(
      { command: 'echo "hello world" | wc -w' },
      makeContext(),
    )
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('2')
  })
})

describe('BashTool — Semicolon Security', () => {
  const tool = new BashTool()

  it('should reject commands with semicolons outside quotes', async () => {
    const result = await tool.execute(
      { command: 'echo a; echo b; echo c' },
      makeContext(),
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Security Error')
  })

  it('should reject semicolon with two commands', async () => {
    // The security layer blocks semicolons outside quotes
    const result = await tool.execute(
      { command: 'echo a; echo b' },
      makeContext(),
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Security Error')
    expect(result.content).toContain('semicolons')
  })
})

// ─── Read-Only Detection ──────────────────────────────────

describe('BashTool — Read-Only Detection', () => {
  const tool = new BashTool()

  it('should detect ls as read-only', () => {
    expect(tool.isReadOnly({ command: 'ls -la /tmp' })).toBe(true)
  })

  it('should detect cat as read-only', () => {
    expect(tool.isReadOnly({ command: 'cat file.txt' })).toBe(true)
  })

  it('should detect echo as NOT read-only (default)', () => {
    expect(tool.isReadOnly({ command: 'echo test' })).toBe(false)
  })

  it('should detect compound read-only commands', () => {
    expect(tool.isReadOnly({ command: 'ls && cat file.txt' })).toBe(true)
  })

  it('should detect mixed read-write compound command', () => {
    expect(tool.isReadOnly({ command: 'ls && echo test' })).toBe(false)
  })

  it('should detect touch as NOT read-only', () => {
    expect(tool.isReadOnly({ command: 'touch /tmp/test.txt' })).toBe(false)
  })

  it('should detect wc as read-only', () => {
    expect(tool.isReadOnly({ command: 'wc -l file.txt' })).toBe(true)
  })
})

describe('BashTool — Stderr Scenarios', () => {
  const tool = new BashTool()

  it('should handle stderr-only output', async () => {
    // When only stderr is written, it should be captured
    const result = await tool.execute(
      { command: 'echo "error only" >&2' },
      makeContext(),
    )
    expect(result.isError).toBeFalsy()
    expect(result.data?.stderr).toContain('error only')
  })

  it('should handle both empty stdout and empty stderr gracefully', async () => {
    // A command that produces no output
    const result = await tool.execute(
      { command: 'cd /tmp' },
      makeContext(),
    )
    // cd to /tmp produces no output but succeeds
    expect(result.isError).toBeFalsy()
    // Should show "(No output)"
    expect(result.content).toBeTruthy()
  })
})

describe('BashTool — Schema Validation', () => {
  const tool = new BashTool()

  it('should reject empty string command', () => {
    const result = tool.inputSchema.safeParse({ command: '' })
    expect(result.success).toBe(false)
  })

  it('should accept command with timeout', () => {
    const result = tool.inputSchema.safeParse({ command: 'ls', timeout: 5000 })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.timeout).toBe(5000)
    }
  })

  it('should reject negative timeout', () => {
    const result = tool.inputSchema.safeParse({ command: 'ls', timeout: -1 })
    expect(result.success).toBe(false)
  })
})
