/**
 * WebFetchTool — Edge Cases & Coverage Supplement
 *
 * Tests for:
 * - HTTP error status codes (4xx, 5xx)
 * - Network errors / DNS failures
 * - Timeout handling
 * - Binary content handling
 * - HTML content stripping
 * - Various content types (JSON, XML, plain text)
 * - Redirect handling
 * - maxChars truncation edge cases
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { WebFetchTool } from '../../tools/built-in/web_fetch.js'

const makeContext = () => ({ signal: new AbortController().signal })

describe('WebFetchTool — Edge Cases', () => {
  const tool = new WebFetchTool()
  let originalFetch: typeof globalThis.fetch

  beforeAll(() => {
    originalFetch = globalThis.fetch
  })

  afterAll(() => {
    globalThis.fetch = originalFetch
  })

  // ─── HTTP Error Codes ─────────────────────────────────

  it('should handle 404 status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('Not Found', {
        status: 404,
        statusText: 'Not Found',
        headers: { 'Content-Type': 'text/html' },
      }),
    )

    const result = await tool.execute({ url: 'https://example.com/not-found' }, makeContext())
    // 404 with content is still a successful fetch; status is returned in data
    expect(result.isError).toBeFalsy()
    expect(result.data.statusCode).toBe(404)
    expect(result.content).toBeTruthy()
  })

  it('should handle 500 status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('Internal Server Error', {
        status: 500,
        statusText: 'Internal Server Error',
        headers: { 'Content-Type': 'text/html' },
      }),
    )

    const result = await tool.execute({ url: 'https://example.com/error' }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.statusCode).toBe(500)
  })

  // ─── Network/DNS Errors ───────────────────────────────

  it('should handle DNS resolution errors (network failure)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ENOTFOUND: DNS resolution failed'))

    const result = await tool.execute({ url: 'https://nonexistent-domain-xyz-99999.com/' }, makeContext())
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Error fetching URL')
  })

  it('should handle network timeout errors', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'))

    const result = await tool.execute({ url: 'https://example.com/slow' }, makeContext())
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Error fetching URL')
  })

  it('should handle fetch abort signal', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('signal is aborted without reason'))

    const result = await tool.execute({ url: 'https://example.com/' }, makeContext())
    expect(result.isError).toBe(true)
  })

  // ─── Binary Content ───────────────────────────────────

  it('should report binary content type', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(new ArrayBuffer(100), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }),
    )

    const result = await tool.execute({ url: 'https://example.com/image.png' }, makeContext())
    expect(result.isError).toBeFalsy()
    // Binary content should get a description message
    expect(result.data.content).toContain('[Binary content')
    expect(result.data.content).toContain('image/png')
  })

  it('should handle application/octet-stream', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(new ArrayBuffer(50), {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      }),
    )

    const result = await tool.execute({ url: 'https://example.com/file.bin' }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.content).toContain('[Binary content')
    expect(result.data.content).toContain('50 bytes')
  })

  // ─── HTML Content Stripping ───────────────────────────

  it('should strip HTML tags when content starts with <!DOCTYPE', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('<!DOCTYPE html><html><body><h1>Hello World</h1><p>This is a test.</p></body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    )

    const result = await tool.execute({ url: 'https://example.com/' }, makeContext())
    expect(result.isError).toBeFalsy()
    // HTML should be stripped; content should have readable text without tags
    expect(result.data.content).toContain('Hello World')
    expect(result.data.content).toContain('This is a test')
    expect(result.data.content).not.toContain('<h1>')
    expect(result.data.content).not.toContain('<p>')
  })

  it('should strip HTML tags when content starts with <html', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('<html><body>Just HTML</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    )

    const result = await tool.execute({ url: 'https://example.com/' }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.content).toContain('Just HTML')
  })

  // ─── JSON Content Type ────────────────────────────────

  it('should fetch JSON content correctly', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ key: 'value', nested: { a: 1 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await tool.execute({ url: 'https://example.com/data.json' }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.content).toContain('key')
    expect(result.data.content).toContain('value')
  })

  // ─── XML Content Type ─────────────────────────────────

  it('should fetch XML content', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('<root><item id="1">test</item></root>', {
        status: 200,
        headers: { 'Content-Type': 'application/xml' },
      }),
    )

    const result = await tool.execute({ url: 'https://example.com/data.xml' }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.content).toBeTruthy()
  })

  // ─── maxChars Truncation ──────────────────────────────

  it('should truncate content exceeding maxChars', async () => {
    // Create string longer than maxChars
    const longContent = 'A'.repeat(200)
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(longContent, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    )

    const result = await tool.execute({ url: 'https://example.com/long', maxChars: 50 }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.content.length).toBeLessThanOrEqual(80)
    expect(result.data.content).toContain('[Content truncated')
  })

  it('should handle maxChars of 0 gracefully', async () => {
    // maxChars is positive int per schema, but test edge case behavior
    const result = tool.inputSchema.safeParse({ url: 'https://example.com/', maxChars: 0 })
    expect(result.success).toBe(false)
  })

  it('should accept valid maxChars', () => {
    const result = tool.inputSchema.safeParse({ url: 'https://example.com/', maxChars: 100 })
    expect(result.success).toBe(true)
  })

  // ─── Empty Response ───────────────────────────────────

  it('should handle empty response body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    )

    const result = await tool.execute({ url: 'https://example.com/empty' }, makeContext())
    expect(result.isError).toBeFalsy()
    // Should return "(No content)"
    expect(result.content).toBe('(No content)')
  })

  // ─── Schema Validation ─────────────────────────────────

  it('should reject non-string url', () => {
    const result = tool.inputSchema.safeParse({ url: 123 })
    expect(result.success).toBe(false)
  })

  it('should reject missing url', () => {
    const result = tool.inputSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('should be read-only', () => {
    expect(tool.isReadOnly({ url: 'https://example.com' })).toBe(true)
  })

  it('should be concurrency-safe', () => {
    expect(tool.isConcurrencySafe()).toBe(true)
  })
})
