import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { type DebugFilter, parseDebugFilter, shouldShowDebugMessage } from './debugFilter.js'

export type DebugLogLevel = 'verbose' | 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<DebugLogLevel, number> = {
  verbose: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
}

// Module-level cache for min debug log level
let cachedMinLevel: { value: DebugLogLevel } | null = null

/**
 * Minimum log level to include in debug output. Defaults to 'debug', which
 * filters out 'verbose' messages.
 */
export function getMinDebugLogLevel(): DebugLogLevel {
  if (cachedMinLevel) {
    return cachedMinLevel.value
  }
  const raw = process.env.DEBUG_SDK_LOG_LEVEL?.toLowerCase().trim()
  if (raw && Object.hasOwn(LEVEL_ORDER, raw)) {
    cachedMinLevel = { value: raw as DebugLogLevel }
    return raw as DebugLogLevel
  }
  cachedMinLevel = { value: 'debug' }
  return 'debug'
}

// Runtime debug flag (can be enabled programmatically)
let runtimeDebugEnabled = false

// Module-level cache for debug mode
let cachedDebugMode: { value: boolean } | null = null

/**
 * Check if debug mode is active via env var or command-line flag
 */
export function isDebugMode(): boolean {
  if (cachedDebugMode !== null) {
    return cachedDebugMode.value
  }
  const result = computeIsDebugMode()
  cachedDebugMode = { value: result }
  return result
}

function computeIsDebugMode(): boolean {
  if (runtimeDebugEnabled) {
    return true
  }
  if (isEnvTruthy(process.env.DEBUG_SDK)) {
    return true
  }
  if (process.argv.includes('--debug') || process.argv.includes('-d')) {
    return true
  }
  if (isDebugToStdErr()) {
    return true
  }
  // Also check for --debug=pattern syntax
  if (process.argv.some((arg) => arg.startsWith('--debug='))) {
    return true
  }
  return false
}

/**
 * Enables debug logging mid-session.
 * Returns true if logging was already active.
 */
export function enableDebugLogging(): boolean {
  const wasActive = isDebugMode()
  runtimeDebugEnabled = true
  cachedDebugMode = null // Reset cache so next call recomputes
  return wasActive
}

// Module-level cache for debug filter
let cachedFilter: DebugFilter | null | undefined = undefined
let cachedFilterArgsChecked = false

/**
 * Extract and parse debug filter from command line arguments
 */
export function getDebugFilter(): DebugFilter | null {
  if (cachedFilterArgsChecked) {
    return cachedFilter ?? null
  }
  cachedFilterArgsChecked = true

  const debugArg = process.argv.find((arg) => arg.startsWith('--debug='))
  if (!debugArg) {
    cachedFilter = null
    return null
  }

  const filterPattern = debugArg.substring('--debug='.length)
  const result = parseDebugFilter(filterPattern)
  cachedFilter = result ?? null
  return cachedFilter
}

// Module-level cache for debug-to-stderr
let cachedIsDebugToStdErr: { value: boolean } | null = null

/**
 * Check if --debug-to-stderr flag is present
 */
export function isDebugToStdErr(): boolean {
  if (cachedIsDebugToStdErr !== null) {
    return cachedIsDebugToStdErr.value
  }
  const result = process.argv.includes('--debug-to-stderr') || process.argv.includes('-d2e')
  cachedIsDebugToStdErr = { value: result }
  return result
}

// Module-level hasFormattedOutput state
let hasFormattedOutput = false

export function setHasFormattedOutput(value: boolean): void {
  hasFormattedOutput = value
}

export function getHasFormattedOutput(): boolean {
  return hasFormattedOutput
}

// Module-level session ID for log file path
let sessionId: string | null = null

function getSessionId(): string {
  if (!sessionId) {
    sessionId = String(Date.now())
  }
  return sessionId
}

/**
 * Get the debug log file path
 */
export function getDebugLogPath(): string {
  const logFile = process.env.DEBUG_SDK_LOG_FILE
  if (logFile) {
    return logFile
  }
  const logsDir = process.env.DEBUG_SDK_LOGS_DIR
  if (logsDir) {
    return join(logsDir, 'debug', `${getSessionId()}.txt`)
  }
  // Default: write to cwd/debug/<sessionId>.txt
  return join(process.cwd(), 'debug', `${getSessionId()}.txt`)
}

/**
 * Internal: check if a debug message should be logged based on filter, env, etc.
 */
function shouldLogDebugMessage(message: string): boolean {
  if (process.env.NODE_ENV === 'test' && !isDebugToStdErr()) {
    return false
  }

  // In SDK mode, debug logging requires debug mode to be active
  if (!isDebugMode()) {
    return false
  }

  if (
    typeof process === 'undefined' ||
    typeof process.versions === 'undefined' ||
    typeof process.versions.node === 'undefined'
  ) {
    return false
  }

  const filter = getDebugFilter()
  return shouldShowDebugMessage(message, filter)
}

/**
 * Core logging function with level filtering and output routing.
 *
 * @param message - The debug message to log
 * @param options - Options including log level (default: 'debug')
 */
export function logForDebugging(message: string, { level }: { level: DebugLogLevel } = { level: 'debug' }): void {
  // Level filtering: skip if message level is below minimum
  if (LEVEL_ORDER[level] < LEVEL_ORDER[getMinDebugLogLevel()]) {
    return
  }

  // Filter check: skip if filter doesn't allow this message
  if (!shouldLogDebugMessage(message)) {
    return
  }

  // Multiline messages break the jsonl output format, so make any multiline messages JSON.
  if (hasFormattedOutput && message.includes('\n')) {
    message = JSON.stringify(message)
  }

  const timestamp = new Date().toISOString()
  const output = `${timestamp} [${level.toUpperCase()}] ${message.trim()}\n`

  if (isDebugToStdErr()) {
    process.stderr.write(output)
    return
  }

  // Write to file
  const logPath = getDebugLogPath()
  const dir = join(logPath, '..')
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // Directory already exists
  }
  try {
    appendFileSync(logPath, output)
  } catch {
    // Silently fail if file write fails
  }
}

/**
 * Flush any buffered debug logs (no-op in SDK version since we use sync writes)
 */
export async function flushDebugLogs(): Promise<void> {
  // No-op: SDK uses synchronous appendFileSync, no buffered writer
}

/**
 * Reset all internal caches. Used for testing to clear module-level
 * caching between test runs.
 * @internal
 */
export function resetDebugCaches(): void {
  cachedMinLevel = null
  cachedDebugMode = null
  cachedIsDebugToStdErr = null
  cachedFilter = undefined
  cachedFilterArgsChecked = false
  runtimeDebugEnabled = false
  hasFormattedOutput = false
  sessionId = null
}

/**
 * Check if an environment variable is truthy
 */
function isEnvTruthy(value: string | undefined): boolean {
  if (value === undefined || value === '') {
    return false
  }
  const normalized = value.toLowerCase().trim()
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on'
}
