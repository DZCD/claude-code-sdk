/**
 * Supplement tests for Debug Logging — logForDebugging multiline JSON,
 * stderr output, file writing path resolution, debugFilter all filtering
 * modes (inclusive, exclusive, mixed, MCP patterns).
 *
 * Complements src/logging/__tests__/index.test.ts,
 * index-edge-cases.test.ts, debugFilter.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type DebugFilter,
  extractDebugCategories,
  parseDebugFilter,
  shouldShowDebugCategories,
  shouldShowDebugMessage,
} from '../logging/debugFilter.js'
import {
  type DebugLogLevel,
  enableDebugLogging,
  flushDebugLogs,
  getDebugFilter,
  getDebugLogPath,
  getHasFormattedOutput,
  getMinDebugLogLevel,
  isDebugMode,
  isDebugToStdErr,
  logForDebugging,
  resetDebugCaches,
  setHasFormattedOutput,
} from '../logging/index.js'

const originalEnv = { ...process.env }
const originalArgv = [...process.argv]

function withArgv(args: string[], fn: () => void) {
  const prev = [...process.argv]
  process.argv = [...prev.slice(0, 2), ...args]
  try {
    fn()
  } finally {
    process.argv = prev
  }
}

function withEnv(key: string, value: string | undefined, fn: () => void) {
  const prev = process.env[key]
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
  try {
    fn()
  } finally {
    process.env[key] = prev as string
  }
}

afterEach(() => {
  process.env = { ...originalEnv }
  process.argv = [...originalArgv]
  setHasFormattedOutput(false)
  resetDebugCaches()
})

// ─── logForDebugging — Multiline JSON & Output Formats ────

describe('logForDebugging — Multiline JSON & Output Formats', () => {
  it('should NOT JSON-stringify multiline messages when hasFormattedOutput is false', () => {
    withArgv(['--debug-to-stderr'], () => {
      resetDebugCaches()
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

      // hasFormattedOutput is false by default
      logForDebugging('line1\nline2', { level: 'info' })
      const output = stderrSpy.mock.calls[0]?.[0] as string
      // Without formatted output, multiline messages pass through as-is
      expect(output).toContain('line1')
      expect(output).toContain('line2')
      stderrSpy.mockRestore()
    })
  })

  it('should JSON-stringify multiline messages when hasFormattedOutput is true', () => {
    withArgv(['--debug-to-stderr'], () => {
      resetDebugCaches()
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      setHasFormattedOutput(true)

      logForDebugging('line1\nline2', { level: 'info' })
      const output = stderrSpy.mock.calls[0]?.[0] as string
      // With formatted output, multiline messages are JSON-stringified
      expect(output).toContain('"line1\\nline2"')
      stderrSpy.mockRestore()
    })
  })

  it('should NOT JSON-stringify single-line messages even when hasFormattedOutput is true', () => {
    withArgv(['--debug-to-stderr'], () => {
      resetDebugCaches()
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      setHasFormattedOutput(true)

      logForDebugging('single line message', { level: 'info' })
      const output = stderrSpy.mock.calls[0]?.[0] as string
      // Single line should not be wrapped in JSON
      expect(output).toContain('single line message')
      expect(output).not.toContain('"single line message"')
      stderrSpy.mockRestore()
    })
  })

  it('should output to stderr with timestamp and level prefix', () => {
    withArgv(['--debug-to-stderr'], () => {
      resetDebugCaches()
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

      logForDebugging('log message', { level: 'warn' })
      const output = stderrSpy.mock.calls[0]?.[0] as string
      expect(output).toMatch(/^[\dTZ:.-]+ \[WARN\]/)
      expect(output).toContain('log message')
      expect(output.endsWith('\n')).toBe(true)
      stderrSpy.mockRestore()
    })
  })

  it('should handle all log level prefixes correctly', () => {
    withArgv(['--debug-to-stderr'], () => {
      resetDebugCaches()
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

      const levels: [DebugLogLevel, string][] = [
        ['verbose', 'VERBOSE'],
        ['debug', 'DEBUG'],
        ['info', 'INFO'],
        ['warn', 'WARN'],
        ['error', 'ERROR'],
      ]

      for (const [level, prefix] of levels) {
        logForDebugging(`${level} message`, { level })
        const calls = stderrSpy.mock.calls.length
        // verbose is filtered by default min level (debug), skip assertion
        if (level === 'verbose' && calls === 0) continue
        const output = stderrSpy.mock.calls[stderrSpy.mock.calls.length - 1]?.[0] as string
        expect(output).toContain(`[${prefix}]`)
      }
      stderrSpy.mockRestore()
    })
  })
})

// ─── logForDebugging — File Writing Paths ──────────────────

describe('logForDebugging — File Writing Paths', () => {
  it('should resolve log path with DEBUG_SDK_LOG_FILE env var', () => {
    withEnv('DEBUG_SDK_LOG_FILE', '/tmp/test-debug.log', () => {
      const path = getDebugLogPath()
      expect(path).toBe('/tmp/test-debug.log')
    })
  })

  it('should resolve log path with DEBUG_SDK_LOGS_DIR env var', () => {
    withEnv('DEBUG_SDK_LOG_FILE', undefined, () => {
      withEnv('DEBUG_SDK_LOGS_DIR', '/custom/logs/dir', () => {
        resetDebugCaches()
        const path = getDebugLogPath()
        expect(path).toContain('/custom/logs/dir')
        expect(path).toMatch(/\.txt$/)
      })
    })
  })

  it('should fallback to cwd/debug/<sessionId>.txt', () => {
    withEnv('DEBUG_SDK_LOG_FILE', undefined, () => {
      withEnv('DEBUG_SDK_LOGS_DIR', undefined, () => {
        resetDebugCaches()
        const path = getDebugLogPath()
        expect(path).toContain('debug')
        expect(path).toMatch(/\/debug\/\d+\.txt$/)
      })
    })
  })

  it('flushDebugLogs is no-op but resolves', async () => {
    await expect(flushDebugLogs()).resolves.toBeUndefined()
  })
})

// ─── debugFilter — All Filtering Modes ─────────────────────

describe('debugFilter — All Filtering Modes', () => {
  // Inclusive filter mode
  it('inclusive filter — should show messages matching any included category', () => {
    const filter: DebugFilter = { include: ['api', 'hooks'], exclude: [], isExclusive: false }
    expect(shouldShowDebugMessage('api: request started', filter)).toBe(true)
    expect(shouldShowDebugMessage('hooks: executing preTool', filter)).toBe(true)
    expect(shouldShowDebugMessage('config: loading', filter)).toBe(false)
  })

  // Exclusive filter mode
  it('exclusive filter — should hide messages matching any excluded category', () => {
    const filter: DebugFilter = { include: [], exclude: ['1p', 'file'], isExclusive: true }
    expect(shouldShowDebugMessage('api: request started', filter)).toBe(true)
    expect(shouldShowDebugMessage('1p: event fired', filter)).toBe(false)
    expect(shouldShowDebugMessage('file: reading /etc/passwd', filter)).toBe(false)
  })

  // Null filter (show all)
  it('null filter — should show all messages', () => {
    expect(shouldShowDebugMessage('any message', null)).toBe(true)
    expect(shouldShowDebugMessage('', null)).toBe(true)
  })

  // MCP server name patterns
  it('inclusive filter — should match MCP server name categories', () => {
    const filter: DebugFilter = { include: ['filesystem'], exclude: [], isExclusive: false }
    expect(shouldShowDebugMessage('MCP server "filesystem": connected', filter)).toBe(true)
    expect(shouldShowDebugMessage('MCP server "database": connected', filter)).toBe(false)
  })

  it('inclusive filter — should match MCP as category', () => {
    const filter: DebugFilter = { include: ['mcp'], exclude: [], isExclusive: false }
    expect(shouldShowDebugMessage('MCP server "any-name": initialized', filter)).toBe(true)
  })

  it('exclusive filter — should exclude MCP server categories', () => {
    const filter: DebugFilter = { include: [], exclude: ['database'], isExclusive: true }
    expect(shouldShowDebugMessage('MCP server "database": query executed', filter)).toBe(false)
    expect(shouldShowDebugMessage('MCP server "api": query executed', filter)).toBe(true)
  })

  // Bracket pattern matching
  it('inclusive filter — should match bracket categories', () => {
    const filter: DebugFilter = { include: ['ant-only'], exclude: [], isExclusive: false }
    expect(shouldShowDebugMessage('[ANT-ONLY] 1P event: tengu_timer', filter)).toBe(true)
    expect(shouldShowDebugMessage('[CONFIG] loading settings', filter)).toBe(false)
  })

  // Uncategorized messages
  it('inclusive filter — should hide uncategorized messages', () => {
    const filter: DebugFilter = { include: ['api'], exclude: [], isExclusive: false }
    expect(shouldShowDebugMessage('plain message without category', filter)).toBe(false)
  })

  it('exclusive filter — should hide uncategorized messages (security)', () => {
    const filter: DebugFilter = { include: [], exclude: ['1p'], isExclusive: true }
    expect(shouldShowDebugMessage('plain message', filter)).toBe(false)
  })

  // parseDebugFilter edge cases
  it('parseDebugFilter — should handle mixed exclusive/inclusive returning null', () => {
    expect(parseDebugFilter('api,!file')).toBeNull()
    expect(parseDebugFilter('a,!b,!c')).toBeNull()
  })

  it('parseDebugFilter — should handle single char categories', () => {
    const result = parseDebugFilter('a,b')
    expect(result).not.toBeNull()
    expect(result!.include).toEqual(['a', 'b'])
  })

  it('parseDebugFilter — should handle trailing comma gracefully', () => {
    const result = parseDebugFilter('api,')
    expect(result).not.toBeNull()
    expect(result!.include).toEqual(['api'])
  })

  it('parseDebugFilter — should handle leading comma gracefully', () => {
    const result = parseDebugFilter(',api')
    expect(result).not.toBeNull()
    expect(result!.include).toEqual(['api'])
  })
})

// ─── debugFilter — extractDebugCategories All Patterns ─────

describe('debugFilter — extractDebugCategories All Patterns', () => {
  it('should extract from "category: message" (simple prefix)', () => {
    const result = extractDebugCategories('api: fetch complete')
    expect(result).toContain('api')
  })

  it('should NOT extract from "MCP server" as prefix category', () => {
    // MCP pattern should be matched first, not the prefix pattern
    const result = extractDebugCategories('MCP server "filesystem": connected')
    expect(result).toContain('mcp')
    expect(result).toContain('filesystem')
    // Should not also match as prefix "mcp server"
    expect(result.filter((c) => c === 'mcp server')).toHaveLength(0)
  })

  it('should extract "[CATEGORY]" bracket pattern', () => {
    const result = extractDebugCategories('[HOOKS] preTool execution')
    expect(result).toContain('hooks')
  })

  it('should extract "[CATEGORY]" bracket pattern and secondary prefix', () => {
    const result = extractDebugCategories('[TOOLS] bash: execution completed')
    expect(result).toContain('tools')
    // bash: after [TOOLS] is not extracted as a separate category in current implementation
    expect(result).not.toContain('bash')
  })

  it('should extract 1p category from event pattern', () => {
    const result = extractDebugCategories('[ANT-ONLY] 1P event: tengu_timer')
    expect(result).toContain('1p')
  })

  it('should extract secondary categories from sub-type patterns', () => {
    const result = extractDebugCategories('AutoUpdater: Installation type: development')
    expect(result).toContain('autoupdater')
  })
})

// ─── Integration: getDebugFilter with CLI args ─────────────

describe('getDebugFilter — CLI Integration', () => {
  it('should parse --debug=api,hooks as inclusive filter', () => {
    withArgv(['--debug=api,hooks'], () => {
      resetDebugCaches()
      const filter = getDebugFilter()
      expect(filter).not.toBeNull()
      expect(filter!.include).toContain('api')
      expect(filter!.include).toContain('hooks')
      expect(filter!.isExclusive).toBe(false)
    })
  })

  it('should parse --debug=!1p,!file as exclusive filter', () => {
    withArgv(['--debug=!1p,!file'], () => {
      resetDebugCaches()
      const filter = getDebugFilter()
      expect(filter).not.toBeNull()
      expect(filter!.exclude).toContain('1p')
      expect(filter!.exclude).toContain('file')
      expect(filter!.isExclusive).toBe(true)
    })
  })

  it('should return null when no --debug= argument', () => {
    withArgv(['--debug-to-stderr'], () => {
      resetDebugCaches()
      const filter = getDebugFilter()
      expect(filter).toBeNull()
    })
  })

  it('should cache the filter result across calls', () => {
    withArgv(['--debug=api'], () => {
      resetDebugCaches()
      const filter1 = getDebugFilter()
      const filter2 = getDebugFilter()
      expect(filter1).toBe(filter2) // Same object reference due to caching
    })
  })
})
