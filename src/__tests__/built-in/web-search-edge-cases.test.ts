/**
 * WebSearchTool — Edge Cases & Coverage Supplement
 *
 * Tests for:
 * - Engine selection logic: auto/fast/deep
 * - Exa search: no API key, API errors, timeout, empty results
 * - DuckDuckGo search: HTML parse edge cases, empty results, errors
 * - Deduplication: duplicate URLs, case-insensitive dedup
 * - Schema validation edge cases
 * - searchWithEngineSelection: fallback behavior
 * - Execute error handling
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  type SearchResult,
  WebSearchTool,
  deduplicateResults,
  duckDuckGoSearch,
  exaSearch,
} from '../../tools/built-in/web_search.js'

const makeContext = () => ({ signal: new AbortController().signal })

/**
 * Generate mock DuckDuckGo HTML for testing
 */
function mockDuckDuckGoHTML(results: Array<{ url: string; title: string; snippet: string }>): string {
  const encodedUrl = (url: string) => `https://duckduckgo.com/l/?uddg=${encodeURIComponent(url)}`
  const items = results
    .map(
      (r) => `
  <div class="result results_links results_links_deep">
    <a rel="nofollow" class="result__a" href="${encodedUrl(r.url)}">${r.title}</a>
    <a class="result__snippet">${r.snippet}</a>
  </div>`,
    )
    .join('\n')
  return `<!DOCTYPE html><html><body><div class="results">${items}</div></body></html>`
}

// ─── Deduplicate Tests ────────────────────────────────────

describe('WebSearchTool — deduplicateResults', () => {
  it('should remove exact duplicate URLs', () => {
    const results: SearchResult[] = [
      { title: 'A', url: 'https://example.com/a', snippet: 'aaa', source: 'exa' },
      { title: 'B', url: 'https://example.com/b', snippet: 'bbb', source: 'exa' },
      { title: 'C', url: 'https://example.com/a', snippet: 'aaa copy', source: 'duckduckgo' },
    ]
    const deduped = deduplicateResults(results)
    expect(deduped).toHaveLength(2)
    expect(deduped[0].title).toBe('A')
    expect(deduped[1].title).toBe('B')
  })

  it('should be case-insensitive when comparing URLs', () => {
    const results: SearchResult[] = [
      { title: 'A', url: 'https://Example.com/Page', snippet: 'a', source: 'exa' },
      { title: 'B', url: 'https://example.com/page', snippet: 'b', source: 'exa' },
    ]
    const deduped = deduplicateResults(results)
    expect(deduped).toHaveLength(1)
  })

  it('should preserve original order', () => {
    const results: SearchResult[] = [
      { title: 'First', url: 'https://example.com/1', snippet: '1', source: 'exa' },
      { title: 'Second', url: 'https://example.com/2', snippet: '2', source: 'exa' },
      { title: 'Third', url: 'https://example.com/1', snippet: '1 dup', source: 'duckduckgo' },
      { title: 'Fourth', url: 'https://example.com/3', snippet: '3', source: 'exa' },
    ]
    const deduped = deduplicateResults(results)
    expect(deduped).toHaveLength(3)
    expect(deduped[0].title).toBe('First')
    expect(deduped[1].title).toBe('Second')
    expect(deduped[2].title).toBe('Fourth')
  })

  it('should handle empty input', () => {
    const deduped = deduplicateResults([])
    expect(deduped).toHaveLength(0)
  })

  it('should handle single result', () => {
    const results: SearchResult[] = [{ title: 'Only', url: 'https://example.com/', snippet: 'only', source: 'exa' }]
    const deduped = deduplicateResults(results)
    expect(deduped).toHaveLength(1)
  })
})

// ─── exaSearch Tests ──────────────────────────────────────

describe('WebSearchTool — exaSearch', () => {
  const originalKey = process.env.EXA_API_KEY

  afterAll(() => {
    if (originalKey) {
      process.env.EXA_API_KEY = originalKey
    } else {
      process.env.EXA_API_KEY = undefined
    }
  })

  it('should return empty when no API key is set', async () => {
    process.env.EXA_API_KEY = undefined
    const results = await exaSearch('test query')
    expect(results).toEqual([])
  })

  it('should handle API errors gracefully', async () => {
    process.env.EXA_API_KEY = 'test-key-123'

    // Mock fetch to return error
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('Unauthorized', {
        status: 401,
        statusText: 'Unauthorized',
      }),
    )

    const results = await exaSearch('test query')
    expect(results).toEqual([])

    globalThis.fetch = originalFetch
  })

  it('should handle network errors in exaSearch', async () => {
    process.env.EXA_API_KEY = 'test-key-123'

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const results = await exaSearch('test query')
    expect(results).toEqual([])

    globalThis.fetch = originalFetch
  })

  it('should handle timeout via AbortError', async () => {
    process.env.EXA_API_KEY = 'test-key-123'

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'))

    const results = await exaSearch('test query')
    expect(results).toEqual([])

    globalThis.fetch = originalFetch
  })

  it('should handle empty results from API', async () => {
    process.env.EXA_API_KEY = 'test-key-123'

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const results = await exaSearch('test query')
    expect(results).toEqual([])

    globalThis.fetch = originalFetch
  })

  it('should handle missing results field in response', async () => {
    process.env.EXA_API_KEY = 'test-key-123'

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const results = await exaSearch('test query')
    expect(results).toEqual([])

    globalThis.fetch = originalFetch
  })
})

// ─── duckDuckGoSearch / Parsing Tests ─────────────────────

describe('WebSearchTool — duckDuckGoSearch', () => {
  const originalFetch = globalThis.fetch

  afterAll(() => {
    globalThis.fetch = originalFetch
  })

  it('should parse HTML search results correctly', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        mockDuckDuckGoHTML([
          { url: 'https://example.com/1', title: 'First Result', snippet: 'First snippet' },
          { url: 'https://example.com/2', title: 'Second Result', snippet: 'Second snippet' },
        ]),
        { status: 200, headers: { 'Content-Type': 'text/html' } },
      ),
    )

    const results = await duckDuckGoSearch('test', 5, 5000)
    expect(results).toHaveLength(2)
    expect(results[0].title).toBe('First Result')
    expect(results[0].url).toBe('https://example.com/1')
    expect(results[0].snippet).toBe('First snippet')
    expect(results[0].source).toBe('duckduckgo')
  })

  it('should respect maxResults limit', async () => {
    const manyResults = Array.from({ length: 10 }, (_, i) => ({
      url: `https://example.com/${i}`,
      title: `Result ${i}`,
      snippet: `Snippet ${i}`,
    }))

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(mockDuckDuckGoHTML(manyResults), {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    )

    const results = await duckDuckGoSearch('test', 3, 5000)
    expect(results).toHaveLength(3)
  })

  it('should handle HTTP errors', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('Error', {
        status: 503,
        statusText: 'Service Unavailable',
      }),
    )

    await expect(duckDuckGoSearch('test', 5, 5000)).rejects.toThrow()
  })

  it('should handle network errors from DDG', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('fetch failed'))

    await expect(duckDuckGoSearch('test', 5, 5000)).rejects.toThrow('fetch failed')
  })

  it('should handle empty HTML with no results', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('<html><body>No results found.</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    )

    const results = await duckDuckGoSearch('test', 5, 5000)
    expect(results).toHaveLength(0)
  })
})

// ─── WebSearchTool Integration ────────────────────────────

describe('WebSearchTool — Execute Edge Cases', () => {
  const tool = new WebSearchTool()
  const originalFetch = globalThis.fetch
  const originalKey = process.env.EXA_API_KEY

  beforeAll(() => {
    process.env.EXA_API_KEY // Ensure no Exa key for DDG testing = undefined // Ensure no Exa key for DDG testing
  })

  afterAll(() => {
    globalThis.fetch = originalFetch
    if (originalKey) {
      process.env.EXA_API_KEY = originalKey
    }
  })

  it('should perform deep search (Exa) and fallback when no key', async () => {
    // Without Exa key, deep search returns empty results
    const result = await tool.execute({ query: 'test query', type: 'deep' }, makeContext())
    expect(result.isError).toBeFalsy()
    // When no Exa key and deep type, we get empty results
    expect(result.data.results).toHaveLength(0)
    expect(result.content).toContain('No search results found')
  })

  it('should perform fast search (DuckDuckGo only)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        mockDuckDuckGoHTML([
          { url: 'https://example.com/r1', title: 'Result 1', snippet: 'Snippet 1' },
          { url: 'https://example.com/r2', title: 'Result 2', snippet: 'Snippet 2' },
        ]),
        { status: 200, headers: { 'Content-Type': 'text/html' } },
      ),
    )

    const result = await tool.execute({ query: 'test query', type: 'fast' }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.results.length).toBeGreaterThan(0)
    expect(result.data.results[0].source).toBe('duckduckgo')
  })

  it('should handle DuckDuckGo failures in auto mode', async () => {
    // No Exa key, so auto mode falls through to DuckDuckGo
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('DDG unavailable'))

    const result = await tool.execute({ query: 'test query', type: 'auto' }, makeContext())
    // When DDG also fails, we get empty results
    expect(result.isError).toBeFalsy()
    expect(result.data.results).toHaveLength(0)
  })

  it('should respect maxResults parameter', async () => {
    const manyResults = Array.from({ length: 10 }, (_, i) => ({
      url: `https://example.com/m${i}`,
      title: `Many Result ${i}`,
      snippet: `Snippet ${i}`,
    }))

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(mockDuckDuckGoHTML(manyResults), {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    )

    const result = await tool.execute({ query: 'test', maxResults: 3, type: 'fast' }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.results.length).toBeLessThanOrEqual(3)
  })

  it('should accept livecrawl parameter', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(mockDuckDuckGoHTML([{ url: 'https://example.com/1', title: 'Live', snippet: 'Crawl test' }]), {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    )

    const result = await tool.execute({ query: 'test', livecrawl: 'preferred', type: 'fast' }, makeContext())
    expect(result.isError).toBeFalsy()
  })

  it('should handle execute-level errors gracefully', async () => {
    // Mock the engine selection to throw
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Unexpected critical error'))

    const result = await tool.execute({ query: 'test', type: 'fast' }, makeContext())
    // DuckDuckGo errors bubble up and are caught in execute, returned as error
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Error')
  })

  // ─── Schema Validation ─────────────────────────────────

  it('should reject query shorter than 2 characters', () => {
    const result = tool.inputSchema.safeParse({ query: 'a' })
    expect(result.success).toBe(false)
  })

  it('should accept valid search options', () => {
    const result = tool.inputSchema.safeParse({
      query: 'TypeScript',
      type: 'deep',
      maxResults: 10,
      timeout: 20000,
    })
    expect(result.success).toBe(true)
  })

  it('should reject maxResults over 50', () => {
    const result = tool.inputSchema.safeParse({ query: 'test', maxResults: 100 })
    expect(result.success).toBe(false)
  })

  it('should have defaults for optional fields', () => {
    const parsed = tool.inputSchema.safeParse({ query: 'test' })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.type).toBe('auto')
      expect(parsed.data.maxResults).toBe(8)
      expect(parsed.data.timeout).toBe(15000)
    }
  })

  it('should be read-only and concurrency-safe', () => {
    expect(tool.isReadOnly({ query: 'test' })).toBe(true)
    expect(tool.isConcurrencySafe()).toBe(true)
  })

  it('should have correct metadata', () => {
    expect(tool.name).toBe('web_search')
    expect(tool.description).toBeTruthy()
    expect(tool.inputSchema).toBeDefined()
  })

  // ─── Exa search exposed method ────────────────────────

  it('should expose exaSearch and deduplicateResults methods', () => {
    expect(typeof tool.exaSearch).toBe('function')
    expect(typeof tool.deduplicateResults).toBe('function')
  })
})

// ─── Engine Selection ─────────────────────────────────────

describe('WebSearchTool — exaSearch with API key (mocked)', () => {
  const originalKey = process.env.EXA_API_KEY
  const originalFetch = globalThis.fetch

  beforeAll(() => {
    process.env.EXA_API_KEY = 'mocked-exa-key'
  })

  afterAll(() => {
    globalThis.fetch = originalFetch
    if (originalKey) {
      process.env.EXA_API_KEY = originalKey
    } else {
      process.env.EXA_API_KEY = undefined
    }
  })

  it('should return results from exaSearch when API has results', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            { title: 'Exa Result 1', url: 'https://exa.ai/1', text: 'Exa desc 1', publishedDate: '2024-01-01' },
            { title: 'Exa Result 2', url: 'https://exa.ai/2', text: 'Exa desc 2' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const results = await exaSearch('test query')
    expect(results).toHaveLength(2)
    expect(results[0].title).toBe('Exa Result 1')
    expect(results[0].source).toBe('exa')
    expect(results[0].publishedDate).toBe('2024-01-01')
  })

  it('should use summary over text when available', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [{ title: 'Has Summary', url: 'https://exa.ai/s', summary: 'Summary text', text: 'Full text body' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const results = await exaSearch('test query')
    expect(results[0].snippet).toBe('Summary text')
  })

  it('should use text when no summary is available', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [{ title: 'No Summary', url: 'https://exa.ai/n', text: 'Just text body' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const results = await exaSearch('test query')
    expect(results[0].snippet).toBe('Just text body')
  })

  it('should use fallback titles when missing', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [{ url: 'https://exa.ai/no-title', text: 'some text' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const results = await exaSearch('test query')
    expect(results[0].title).toBe('(No title)')
  })

  // Auto mode with Exa key - should use Exa first
  it('should use Exa in auto mode when key is present', async () => {
    const tool = new WebSearchTool()
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [{ title: 'Exa Auto', url: 'https://exa.ai/auto', text: 'Auto result' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const result = await tool.execute({ query: 'test', type: 'auto' }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.results.length).toBeGreaterThan(0)
  })

  // Auto mode with Exa key but Exa fails - should fallback to DuckDuckGo
  it('should fall back to DuckDuckGo when Exa fails in auto mode', async () => {
    const tool = new WebSearchTool()
    // First call (Exa) fails, second call (DDG) succeeds
    let callCount = 0
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        throw new Error('Exa API error')
      }
      return new Response(
        mockDuckDuckGoHTML([{ url: 'https://ddg-fallback.com', title: 'DDG Fallback', snippet: 'Fallback result' }]),
        { status: 200, headers: { 'Content-Type': 'text/html' } },
      )
    })

    const result = await tool.execute({ query: 'test', type: 'auto' }, makeContext())
    expect(result.isError).toBeFalsy()
    // Should get DDG results
    expect(result.data.results.length).toBeGreaterThan(0)
  })

  // Deep mode with Exa key
  it('should perform deep search via Exa when key is present', async () => {
    const tool = new WebSearchTool()
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [{ title: 'Deep Result', url: 'https://exa.ai/deep', text: 'Deep search result' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const result = await tool.execute({ query: 'deep search', type: 'deep' }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.results.length).toBeGreaterThan(0)
  })
})
