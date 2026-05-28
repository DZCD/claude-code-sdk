/**
 * Edge-case tests for Debug Logging module — level filtering,
 * large volume logging, and cache reset behavior.
 *
 * Complements existing tests in src/logging/__tests__/index.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type DebugLogLevel,
  enableDebugLogging,
  getDebugFilter,
  getDebugLogPath,
  getMinDebugLogLevel,
  isDebugMode,
  logForDebugging,
  resetDebugCaches,
} from '../index.js'

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

describe('Logging — Debug Level Filtering', () => {
  afterEach(() => {
    process.env = { ...originalEnv }
    process.argv = [...originalArgv]
    resetDebugCaches()
  })

  it('should filter out verbose messages when min level is info', () => {
    withEnv('DEBUG_SDK_LOG_LEVEL', 'info', () => {
      resetDebugCaches()
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      withArgv(['--debug-to-stderr'], () => {
        resetDebugCaches()
        logForDebugging('verbose msg', { level: 'verbose' })
        expect(stderrSpy).not.toHaveBeenCalled()
        logForDebugging('info msg', { level: 'info' })
        expect(stderrSpy).toHaveBeenCalledTimes(1)
      })
      stderrSpy.mockRestore()
    })
  })

  it('should filter out debug messages when min level is warn', () => {
    withEnv('DEBUG_SDK_LOG_LEVEL', 'warn', () => {
      resetDebugCaches()
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      withArgv(['--debug-to-stderr'], () => {
        resetDebugCaches()
        logForDebugging('debug msg', { level: 'debug' })
        expect(stderrSpy).not.toHaveBeenCalled()
        logForDebugging('warn msg', { level: 'warn' })
        expect(stderrSpy).toHaveBeenCalledTimes(1)
      })
      stderrSpy.mockRestore()
    })
  })

  it('should allow all levels when min level is verbose', () => {
    withEnv('DEBUG_SDK_LOG_LEVEL', 'verbose', () => {
      resetDebugCaches()
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      withArgv(['--debug-to-stderr'], () => {
        resetDebugCaches()
        logForDebugging('verbose msg', { level: 'verbose' })
        logForDebugging('debug msg', { level: 'debug' })
        logForDebugging('info msg', { level: 'info' })
        logForDebugging('warn msg', { level: 'warn' })
        logForDebugging('error msg', { level: 'error' })
        expect(stderrSpy).toHaveBeenCalledTimes(5)
      })
      stderrSpy.mockRestore()
    })
  })

  it('should use debug filter from --debug=pattern argument', () => {
    withArgv(['--debug=api'], () => {
      resetDebugCaches()
      const filter = getDebugFilter()
      expect(filter).not.toBeNull()
      expect(filter!.include).toContain('api')
    })
  })

  it('should return null debug filter when no --debug= argument', () => {
    withArgv(['--debug-to-stderr'], () => {
      resetDebugCaches()
      const filter = getDebugFilter()
      expect(filter).toBeNull()
    })
  })
})

describe('Logging — Cache / Reset Behavior', () => {
  afterEach(() => {
    process.env = { ...originalEnv }
    process.argv = [...originalArgv]
    resetDebugCaches()
  })

  it('should reset caches and recompute on next call', () => {
    // Set up a state
    withEnv('DEBUG_SDK', 'true', () => {
      expect(isDebugMode()).toBe(true)

      // Reset
      resetDebugCaches()

      // After reset, should still read from env
      expect(isDebugMode()).toBe(true)
    })
  })

  it('should recompute min level after cache reset', () => {
    withEnv('DEBUG_SDK_LOG_LEVEL', 'error', () => {
      resetDebugCaches()
      expect(getMinDebugLogLevel()).toBe('error')

      resetDebugCaches()
      withEnv('DEBUG_SDK_LOG_LEVEL', undefined, () => {
        resetDebugCaches()
        // When env is undefined (cleared), defaults to 'debug'
        // BUT: process.env.DEBUG_SDK_LOG_LEVEL was set to 'error' in outer scope
        // In the withEnv inner scope, it's undefined, so...
        // Actually let me think about this. The outer withEnv sets to 'error', calls the inner function
        // In the inner scope, we use withEnv to clear it, which sets it to undefined within that scope
        // The resetDebugCaches should cause it to re-read from env
        expect(getMinDebugLogLevel()).toBe('debug')
      })
    })
  })
})

describe('Logging — Large Volume Performance', () => {
  afterEach(() => {
    process.env = { ...originalEnv }
    process.argv = [...originalArgv]
    resetDebugCaches()
  })

  it('should handle 1000 log entries without error', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    withArgv(['--debug-to-stderr'], () => {
      resetDebugCaches()
      expect(() => {
        for (let i = 0; i < 1000; i++) {
          logForDebugging(`performance test message ${i}`, { level: 'info' })
        }
      }).not.toThrow()
      // Should have written 1000 lines
      expect(stderrSpy).toHaveBeenCalledTimes(1000)
    })
    stderrSpy.mockRestore()
  })

  it('should handle very long messages', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    withArgv(['--debug-to-stderr'], () => {
      resetDebugCaches()
      const longMsg = 'x'.repeat(10000)
      expect(() => {
        logForDebugging(longMsg, { level: 'info' })
      }).not.toThrow()
    })
    stderrSpy.mockRestore()
  })

  it('should handle mixed log levels rapidly', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    withArgv(['--debug-to-stderr'], () => {
      resetDebugCaches()
      const levels: DebugLogLevel[] = ['verbose', 'debug', 'info', 'warn', 'error']
      expect(() => {
        for (let i = 0; i < 500; i++) {
          logForDebugging(`msg ${i}`, { level: levels[i % levels.length] })
        }
      }).not.toThrow()
    })
    stderrSpy.mockRestore()
  })
})

describe('Logging — getDebugLogPath Edge Cases', () => {
  afterEach(() => {
    process.env = { ...originalEnv }
    resetDebugCaches()
  })

  it('should use DEBUG_SDK_LOGS_DIR when DEBUG_SDK_LOG_FILE is not set', () => {
    withEnv('DEBUG_SDK_LOG_FILE', undefined, () => {
      withEnv('DEBUG_SDK_LOGS_DIR', '/custom/logs', () => {
        resetDebugCaches()
        const path = getDebugLogPath()
        expect(path).toContain('/custom/logs')
        expect(path).toMatch(/\.txt$/)
      })
    })
  })

  it('should fallback to default path when no env vars set', () => {
    withEnv('DEBUG_SDK_LOG_FILE', undefined, () => {
      withEnv('DEBUG_SDK_LOGS_DIR', undefined, () => {
        resetDebugCaches()
        const path = getDebugLogPath()
        expect(path).toContain('debug')
        expect(path).toMatch(/\.txt$/)
      })
    })
  })
})

describe('Logging — enableDebugLogging', () => {
  afterEach(() => {
    process.env = { ...originalEnv }
    process.argv = [...originalArgv]
    resetDebugCaches()
  })

  it('should return true when debug was already active', () => {
    withEnv('DEBUG_SDK', 'true', () => {
      resetDebugCaches()
      const wasActive = enableDebugLogging()
      expect(wasActive).toBe(true)
    })
  })

  it('should return false when debug was not active and then activate it', () => {
    process.env.DEBUG_SDK = undefined
    process.argv = [...originalArgv.slice(0, 2)]
    resetDebugCaches()
    const wasActive = enableDebugLogging()
    expect(wasActive).toBe(false)
    expect(isDebugMode()).toBe(true)
  })
})
