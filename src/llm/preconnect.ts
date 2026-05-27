/**
 * ClaudeCode SDK — Connection Preconnect
 *
 * Provides connection warming for LLM Providers.
 * References claude-code-source-code/src/utils/apiPreconnect.ts
 *
 * Uses a fire-and-forget HEAD request to overlap TCP+TLS handshake
 * with startup time. The warmed connection is reused for the real API call.
 *
 * Skipped when:
 * - Proxy/mTLS/unix socket configured (would warm wrong endpoint)
 * - Bedrock/Vertex/Foundry (different endpoints, different auth)
 */

/**
 * Preconnect to an API endpoint to warm the TCP+TLS connection pool.
 *
 * @param baseUrl - The base URL to preconnect to
 * @returns void (fire-and-forget)
 */
export function preconnect(baseUrl: string | undefined): void {
  if (!baseUrl) return

  // Skip preconnect for non-standard transports (proxy, mTLS, unix socket)
  if (isNonStandardTransport()) return

  // Fire-and-forget HEAD request to warm the connection pool.
  // 5s timeout so slow network doesn't hang. Abort is fine since the
  // real request will handshake fresh if needed.
  void fetch(baseUrl, {
    method: 'HEAD',
    signal: AbortSignal.timeout(5_000),
  }).catch(() => {
    // Silently ignore — preconnect is best-effort
  })
}

/**
 * Check if non-standard transport is configured.
 * When proxy, mTLS, or unix socket is active, preconnect would
 * warm the wrong connection pool.
 */
function isNonStandardTransport(): boolean {
  return !!(
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ANTHROPIC_UNIX_SOCKET ||
    process.env.CLAUDE_CODE_CLIENT_CERT ||
    process.env.CLAUDE_CODE_CLIENT_KEY
  )
}
