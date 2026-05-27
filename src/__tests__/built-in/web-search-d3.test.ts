/**
 * D3: WebSearch 增强 — TDD Tests
 *
 * Tests for enhanced WebSearchTool features:
 * - Multi-engine support (Exa + DuckDuckGo)
 * - Search depth control (auto/fast/deep)
 * - Deduplication
 * - Timeout control
 * - Enhanced result structure
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { WebSearchTool } from '../../tools/built-in/web_search.js'
import type { ToolContext } from '../../types/tool.js'

// ─── Test Helpers ──────────────────────────────────────────

function makeContext(): ToolContext {
  return { signal: new AbortController().signal }
}

// ─── Schema Validation Tests ──────────────────────────────

describe('WebSearchTool — Schema (D3 Enhancements)', () => {
  const tool = new WebSearchTool()

  it('should accept enhanced type parameter', () => {
    const result = tool.inputSchema.safeParse({
      query: 'TypeScript',
      type: 'auto',
    })
    expect(result.success).toBe(true)
  })

  it('should accept fast search type', () => {
    const result = tool.inputSchema.safeParse({
      query: 'TypeScript',
      type: 'fast',
    })
    expect(result.success).toBe(true)
  })

  it('should accept deep search type', () => {
    const result = tool.inputSchema.safeParse({
      query: 'TypeScript',
      type: 'deep',
    })
    expect(result.success).toBe(true)
  })

  it('should reject invalid search type', () => {
    const result = tool.inputSchema.safeParse({
      query: 'TypeScript',
      type: 'invalid',
    })
    expect(result.success).toBe(false)
  })

  it('should accept livecrawl parameter', () => {
    const result = tool.inputSchema.safeParse({
      query: 'TypeScript',
      livecrawl: 'fallback',
    })
    expect(result.success).toBe(true)
  })

  it('should accept preferred livecrawl', () => {
    const result = tool.inputSchema.safeParse({
      query: 'TypeScript',
      livecrawl: 'preferred',
    })
    expect(result.success).toBe(true)
  })

  it('should reject invalid livecrawl value', () => {
    const result = tool.inputSchema.safeParse({
      query: 'TypeScript',
      livecrawl: 'always',
    })
    expect(result.success).toBe(false)
  })

  it('should accept custom timeout', () => {
    const result = tool.inputSchema.safeParse({
      query: 'TypeScript',
      timeout: 30000,
    })
    expect(result.success).toBe(true)
  })

  it('should reject non-positive timeout', () => {
    const result = tool.inputSchema.safeParse({
      query: 'TypeScript',
      timeout: 0,
    })
    expect(result.success).toBe(false)
  })

  it('should accept up to 50 maxResults', () => {
    const result = tool.inputSchema.safeParse({
      query: 'TypeScript',
      maxResults: 50,
    })
    expect(result.success).toBe(true)
  })

  it('should reject overly large maxResults', () => {
    const result = tool.inputSchema.safeParse({
      query: 'TypeScript',
      maxResults: 100,
    })
    expect(result.success).toBe(false)
  })

  it('should default type to auto', () => {
    const result = tool.inputSchema.safeParse({ query: 'test' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe('auto')
    }
  })

  it('should default timeout to 15000', () => {
    const result = tool.inputSchema.safeParse({ query: 'test' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.timeout).toBe(15000)
    }
  })
})

// ─── Deduplication Tests ──────────────────────────────────

describe('WebSearchTool — Deduplication', () => {
  const tool = new WebSearchTool()

  it('should deduplicate results by URL', () => {
    const results = [
      {
        title: 'A',
        url: 'https://example.com/a',
        snippet: 'desc a',
        source: 'exa' as const,
      },
      {
        title: 'A dup',
        url: 'https://example.com/a',
        snippet: 'desc a dup',
        source: 'exa' as const,
      },
      {
        title: 'B',
        url: 'https://example.com/b',
        snippet: 'desc b',
        source: 'exa' as const,
      },
    ]
    const deduped = tool.deduplicateResults(results)
    expect(deduped.length).toBe(2)
    expect(deduped[0].title).toBe('A') // first occurrence kept
    expect(deduped[1].url).toBe('https://example.com/b')
  })

  it('should handle case-insensitive URL dedup', () => {
    const results = [
      {
        title: 'A',
        url: 'https://Example.com/A',
        snippet: '',
        source: 'exa' as const,
      },
      {
        title: 'B',
        url: 'https://example.com/a',
        snippet: '',
        source: 'exa' as const,
      },
    ]
    const deduped = tool.deduplicateResults(results)
    expect(deduped.length).toBe(1)
  })

  it('should handle empty results', () => {
    const deduped = tool.deduplicateResults([])
    expect(deduped.length).toBe(0)
  })

  it('should preserve order after dedup', () => {
    const results = [
      {
        title: 'First',
        url: 'https://example.com/1',
        snippet: '',
        source: 'exa' as const,
      },
      {
        title: 'Second',
        url: 'https://example.com/2',
        snippet: '',
        source: 'exa' as const,
      },
      {
        title: 'Dup of First',
        url: 'https://example.com/1',
        snippet: '',
        source: 'exa' as const,
      },
      {
        title: 'Third',
        url: 'https://example.com/3',
        snippet: '',
        source: 'exa' as const,
      },
    ]
    const deduped = tool.deduplicateResults(results)
    expect(deduped.length).toBe(3)
    expect(deduped[0].title).toBe('First')
    expect(deduped[1].title).toBe('Second')
    expect(deduped[2].title).toBe('Third')
  })
})

// ─── Exa Search Tests ────────────────────────────────────

describe('WebSearchTool — Exa Engine', () => {
  const tool = new WebSearchTool()

  it('should have exaSearch method', () => {
    expect(typeof tool.exaSearch).toBe('function')
  })

  it('should return empty results when EXA_API_KEY is not set', async () => {
    // Clear env
    const prevKey = process.env.EXA_API_KEY
    process.env.EXA_API_KEY = undefined

    const results = await tool.exaSearch('test query', { maxResults: 3 })
    expect(results).toEqual([])

    // Restore
    if (prevKey) process.env.EXA_API_KEY = prevKey
  })
})

// ─── DuckDuckGo Search Enhancement Tests ──────────────────

describe('WebSearchTool — DuckDuckGo Engine (Enhanced)', () => {
  const tool = new WebSearchTool()

  it('should search and return results with source field', async () => {
    const result = await tool.execute({ query: 'TypeScript programming', type: 'fast', maxResults: 3 }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.query).toBe('TypeScript programming')
    expect(result.data.results.length).toBeGreaterThan(0)
    if (result.data.results.length > 0) {
      expect(result.data.results[0].title).toBeTruthy()
      expect(result.data.results[0].url).toBeTruthy()
      expect(result.data.results[0].source).toBe('duckduckgo')
    }
  }, 30000)

  it('should respect maxResults with enhanced schema', async () => {
    const result = await tool.execute({ query: 'node.js', maxResults: 2, type: 'fast' }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.results.length).toBeLessThanOrEqual(2)
  }, 30000)

  it('should default to auto type', async () => {
    const result = await tool.execute({ query: 'deno runtime', maxResults: 2 }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.results.length).toBeGreaterThan(0)
  }, 30000)
})

// ─── Metadata Tests ───────────────────────────────────────

describe('WebSearchTool — D3 Metadata', () => {
  const tool = new WebSearchTool()

  it('should have correct name', () => {
    expect(tool.name).toBe('web_search')
  })

  it('should be read-only', () => {
    expect(tool.isReadOnly({ query: 'test' })).toBe(true)
  })

  it('should be concurrency-safe', () => {
    expect(tool.isConcurrencySafe()).toBe(true)
  })
})
