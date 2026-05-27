/**
 * ClaudeCode SDK — Unified Retry Engine
 *
 * Provides streaming-aware retry logic for LLM API calls.
 * References claude-code-source-code/src/services/api/withRetry.ts
 *
 * Features:
 * - Exponential backoff with jitter
 * - Error classification (retryable vs non-retryable)
 * - Retry-after header support
 * - AbortSignal support
 * - Retry event callback for streaming-aware callers
 */

// ─── Types ──────────────────────────────────────────────────

export interface RetryEvent {
  type: 'retry'
  attempt: number
  delayMs: number
  error: string
  status?: number
}

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number
  /** Base delay in ms (default: 500) */
  baseDelayMs?: number
  /** Maximum delay in ms (default: 32000) */
  maxDelayMs?: number
  /** Abort signal */
  signal?: AbortSignal
  /** Callback for retry events (for streaming yield) */
  onRetry?: (event: RetryEvent) => void
}

export interface ErrorClassification {
  kind: 'rate_limit' | 'overloaded' | 'network' | 'auth' | 'timeout' | 'non_retryable' | 'unknown'
  retryable: boolean
  status?: number
  message: string
}

// ─── Constants ──────────────────────────────────────────────

const DEFAULT_MAX_RETRIES = 3
const DEFAULT_BASE_DELAY_MS = 500
const DEFAULT_MAX_DELAY_MS = 32_000

// ─── Retry Delay ────────────────────────────────────────────

/**
 * Calculate delay before next retry attempt.
 *
 * - If retry-after header is present, use it (multiply seconds by 1000).
 * - Otherwise, exponential backoff: baseDelay * 2^(attempt-1) + random jitter (0-25%).
 * - Result is capped at maxDelayMs.
 */
export function getRetryDelay(
  attempt: number,
  retryAfterHeader?: string | null,
  maxDelayMs: number = DEFAULT_MAX_DELAY_MS,
  baseDelayMs: number = DEFAULT_BASE_DELAY_MS,
): number {
  // Prefer retry-after header if available
  if (retryAfterHeader) {
    const seconds = Number.parseInt(retryAfterHeader, 10)
    if (!Number.isNaN(seconds)) {
      return seconds * 1000
    }
  }

  // Exponential backoff: 500, 1000, 2000, 4000, 8000, ...
  const baseDelay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs)
  // Add 0-25% jitter
  const jitter = Math.random() * 0.25 * baseDelay
  return baseDelay + jitter
}

// ─── Error Classification ───────────────────────────────────

/**
 * Get retry-after value from an error object's headers.
 */
function getRetryAfter(error: unknown): string | null {
  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>
    // Check various header locations
    if (err.headers && typeof err.headers === 'object') {
      const headers = err.headers as Record<string, unknown>
      if (typeof headers['retry-after'] === 'string') return headers['retry-after']
    }
  }
  return null
}

/**
 * Check if an error is a 529 (overloaded) error.
 * The SDK sometimes fails to pass the 529 status properly during streaming,
 * so also check for overloaded_error in the message.
 */
export function is529Error(error: unknown): boolean {
  if (!(error instanceof Error)) return false

  const err = error as Error & { status?: number }

  return err.status === 529 || (err.message?.includes('"type":"overloaded_error"') ?? false)
}

/**
 * Determine whether an error should trigger a retry.
 *
 * Retryable status codes:
 * - 408 (Request Timeout)
 * - 409 (Lock Timeout)
 * - 429 (Rate Limit)
 * - 500+ (Server Error, including 529 Overloaded)
 * - 401 (Auth — can retry after credential refresh)
 * - APIConnectionError (network errors)
 */
export function shouldRetry(error: unknown): boolean {
  if (!(error instanceof Error)) return false

  // Check for overloaded_error in message (streaming 529 proxy)
  if (is529Error(error)) return true

  const err = error as Error & { status?: number }
  const status = err.status

  // Connection errors (no status, network level)
  if (status === undefined) {
    // Common transient network errors
    const msg = err.message ?? ''
    if (
      msg.includes('ECONNREFUSED') ||
      msg.includes('ECONNRESET') ||
      msg.includes('ENOTFOUND') ||
      msg.includes('EPIPE') ||
      msg.includes('ETIMEDOUT') ||
      msg.includes('socket hang up') ||
      msg.includes('network') ||
      msg.includes('Connection error')
    ) {
      return true
    }
    return false
  }

  switch (status) {
    case 408: // Request Timeout
    case 409: // Conflict / Lock Timeout
    case 429: // Rate Limit
      return true
    case 401: // Auth error — can retry after credential refresh
      return true
    case 500:
    case 502:
    case 503:
    case 504:
    case 529:
      return true
    default:
      // Don't retry on 4xx client errors (except those above)
      if (status >= 400 && status < 500) return false
      // Don't retry on 3xx redirects
      if (status >= 300 && status < 400) return false
      return false
  }
}

/**
 * Classify an error into detailed category.
 */
export function isRetryableError(error: unknown): ErrorClassification {
  if (!(error instanceof Error)) {
    return { kind: 'unknown', retryable: false, message: String(error) }
  }

  const err = error as Error & { status?: number }
  const status = err.status
  const msg = err.message ?? ''

  // Rate limit
  if (status === 429) {
    return { kind: 'rate_limit', retryable: true, status, message: msg }
  }

  // Overloaded
  if (is529Error(error)) {
    return {
      kind: 'overloaded',
      retryable: true,
      status: status ?? 529,
      message: msg,
    }
  }

  // Network errors
  if (status === undefined) {
    const networkPatterns = ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EPIPE', 'ETIMEDOUT', 'socket hang up']
    if (networkPatterns.some((p) => msg.includes(p))) {
      return { kind: 'network', retryable: true, message: msg }
    }
  }

  // Auth errors
  if (status === 401) {
    return { kind: 'auth', retryable: true, status, message: msg }
  }

  // Timeout
  if (status === 408) {
    return { kind: 'timeout', retryable: true, status, message: msg }
  }

  // Server errors
  if (status !== undefined && status >= 500) {
    return {
      kind: 'overloaded' as const,
      retryable: true,
      status,
      message: msg,
    }
  }

  return { kind: 'non_retryable', retryable: false, status, message: msg }
}

// ─── withRetry ──────────────────────────────────────────────

/**
 * Execute an operation with automatic retry on transient errors.
 *
 * Uses exponential backoff with jitter.
 * Yields retry events via onRetry callback.
 * Respects AbortSignal for cancellation.
 * Does NOT retry on non-retryable errors (400, 403, 404, etc.).
 *
 * @example
 * ```ts
 * const result = await withRetry(async (attempt) => {
 *   return await client.messages.create({ ... })
 * }, { maxRetries: 3 })
 * ```
 */
export async function withRetry<T>(operation: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  const signal = options.signal
  const onRetry = options.onRetry

  let lastError: unknown

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    // Check abort signal before each attempt
    if (signal?.aborted) {
      throw new Error('Operation aborted')
    }

    try {
      return await operation(attempt)
    } catch (error) {
      lastError = error

      // Check if this error is retryable
      if (!shouldRetry(error)) {
        throw error
      }

      // If we've exhausted retries, throw
      if (attempt > maxRetries) {
        throw error
      }

      // Calculate delay
      const retryAfter = getRetryAfter(error)
      const delayMs = getRetryDelay(attempt, retryAfter, maxDelayMs, baseDelayMs)

      // Emit retry event
      if (onRetry) {
        const err = error as Error & { status?: number }
        onRetry({
          type: 'retry',
          attempt,
          delayMs,
          error: err.message ?? String(error),
          status: err.status,
        })
      }

      // Wait for retry (with abort support)
      try {
        await sleep(delayMs, signal)
      } catch {
        throw new Error('Operation aborted')
      }
    }
  }

  // Should not reach here, but just in case
  throw lastError
}

// ─── Sleep helper ───────────────────────────────────────────

/**
 * Sleep for given ms, optionally respecting abort signal.
 * Throws if aborted.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'))
      return
    }

    const timer = setTimeout(resolve, ms)

    if (signal) {
      const onAbort = () => {
        clearTimeout(timer)
        reject(new Error('aborted'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}
