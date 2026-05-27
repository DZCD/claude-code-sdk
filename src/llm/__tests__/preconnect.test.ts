/**
 * Tests for preconnect (connection management)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Store original env
const originalEnv = { ...process.env }

describe('preconnect', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // Reset env
    process.env = { ...originalEnv }
    // Clear proxy env vars
    process.env.HTTPS_PROXY = undefined
    process.env.https_proxy = undefined
    process.env.HTTP_PROXY = undefined
    process.env.http_proxy = undefined
    process.env.ANTHROPIC_UNIX_SOCKET = undefined
    process.env.CLAUDE_CODE_CLIENT_CERT = undefined
    process.env.CLAUDE_CODE_CLIENT_KEY = undefined
  })

  it('should do nothing when baseUrl is undefined', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { preconnect } = await import('../preconnect.js')
    preconnect(undefined)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('should do nothing when baseUrl is empty', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { preconnect } = await import('../preconnect.js')
    preconnect('')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('should fire fetch HEAD request to warm connection', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response())
    const { preconnect } = await import('../preconnect.js')
    preconnect('https://api.anthropic.com')
    expect(fetchSpy).toHaveBeenCalledWith('https://api.anthropic.com', {
      method: 'HEAD',
      signal: expect.any(AbortSignal),
    })
  })

  it('should NOT preconnect when HTTPS_PROXY is set', async () => {
    process.env.HTTPS_PROXY = 'http://proxy:8080'
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { preconnect } = await import('../preconnect.js')
    preconnect('https://api.anthropic.com')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('should NOT preconnect when HTTP_PROXY is set', async () => {
    process.env.HTTP_PROXY = 'http://proxy:8080'
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { preconnect } = await import('../preconnect.js')
    preconnect('https://api.anthropic.com')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('should NOT preconnect when unix socket is configured', async () => {
    process.env.ANTHROPIC_UNIX_SOCKET = '/tmp/anthropic.sock'
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { preconnect } = await import('../preconnect.js')
    preconnect('https://api.anthropic.com')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('should NOT preconnect when client cert is configured', async () => {
    process.env.CLAUDE_CODE_CLIENT_CERT = '/path/to/cert.pem'
    process.env.CLAUDE_CODE_CLIENT_KEY = '/path/to/key.pem'
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { preconnect } = await import('../preconnect.js')
    preconnect('https://api.anthropic.com')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('should silently swallow fetch errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'))
    const { preconnect } = await import('../preconnect.js')
    // Should not throw
    preconnect('https://api.anthropic.com')
    // Give microtask time to run
    await new Promise((r) => setTimeout(r, 10))
  })
})
