/**
 * ClaudeCode SDK — WebSearchTool (D3 Enhanced)
 *
 * Multi-engine web search with Exa (primary) and DuckDuckGo (fallback).
 * Supports search depth control (auto/fast/deep), livecrawl,
 * deduplication, and configurable timeout.
 */
import { z } from 'zod'
import type { ToolContext, ToolResult } from '../../types/tool.js'
import { BaseTool } from '../base.js'

// ─── Schema ──────────────────────────────────────────────

export const webSearchSchema = z.object({
  query: z.string().min(2).describe('The search query'),
  type: z
    .enum(['auto', 'fast', 'deep'])
    .optional()
    .default('auto')
    .describe('Search type: auto (try Exa, fallback DuckDuckGo), fast (DuckDuckGo only), deep (Exa only)'),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .default(8)
    .describe('Maximum number of search results to return (default: 8, max: 50)'),
  livecrawl: z
    .enum(['fallback', 'preferred'])
    .optional()
    .describe('Live crawling mode: fallback (cache first), preferred (always fresh)'),
  timeout: z.number().int().positive().optional().default(15000).describe('Timeout in milliseconds (default: 15000)'),
})

// ─── Types ───────────────────────────────────────────────

export interface SearchResult {
  title: string
  url: string
  snippet: string
  /** Source engine identifier */
  source: 'exa' | 'duckduckgo'
  /** Optional published date from Exa results */
  publishedDate?: string
}

export interface WebSearchOutput {
  query: string
  results: SearchResult[]
}

// ─── Exa Search Engine ───────────────────────────────────

const EXA_API_URL = 'https://api.exa.ai/search'

/**
 * Search using the Exa AI search API.
 * Requires EXA_API_KEY environment variable.
 * Returns structured results with title, URL, snippet, and optional published date.
 */
export async function exaSearch(
  query: string,
  options: {
    maxResults?: number
    type?: 'auto' | 'fast' | 'deep'
    livecrawl?: 'fallback' | 'preferred'
    timeout?: number
  } = {},
): Promise<SearchResult[]> {
  const apiKey = process.env.EXA_API_KEY
  if (!apiKey) {
    return []
  }

  const maxResults = options.maxResults ?? 8
  const timeout = options.timeout ?? 15000
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    // Map our search types to Exa types
    const exaType = options.type === 'deep' ? 'neural' : 'keyword'

    const response = await fetch(EXA_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        query,
        type: exaType,
        numResults: maxResults,
        contents: {
          text: true,
          summary: true,
        },
        useAutoprompt: exaType === 'neural',
        livecrawl: options.livecrawl ?? 'fallback',
      }),
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      console.warn(`[ExaSearch] API error: ${response.status} ${response.statusText}`)
      return []
    }

    const data = (await response.json()) as {
      results?: Array<{
        title?: string
        url?: string
        text?: string
        summary?: string
        publishedDate?: string
      }>
    }

    if (!data.results || data.results.length === 0) {
      return []
    }

    return data.results.map((r) => ({
      title: r.title ?? '(No title)',
      url: r.url ?? '',
      snippet: r.summary ?? r.text ?? '',
      source: 'exa' as const,
      publishedDate: r.publishedDate,
    }))
  } catch (err: unknown) {
    clearTimeout(timeoutId)
    // AbortError is expected on timeout
    const error = err as Error
    if (error.name === 'AbortError') {
      console.warn('[ExaSearch] Request timed out')
    } else {
      console.warn(`[ExaSearch] Request failed: ${error.message}`)
    }
    return []
  }
}

// ─── DuckDuckGo Search Engine ────────────────────────────

/**
 * Search using DuckDuckGo's lite HTML endpoint.
 * Returns parsed search results with title, URL, and snippet.
 */
export async function duckDuckGoSearch(query: string, maxResults: number, timeout: number): Promise<SearchResult[]> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const url = new URL('https://html.duckduckgo.com/html/')
    url.searchParams.set('q', query)

    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ClaudeCodeSDK/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`Search request failed with status ${response.status}`)
    }

    const html = await response.text()
    return parseDuckDuckGoResults(html, maxResults)
  } catch (err: unknown) {
    clearTimeout(timeoutId)
    throw err
  }
}

/**
 * Parse DuckDuckGo HTML search results.
 * Extracts title, URL, and snippet from search result entries.
 */
function parseDuckDuckGoResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = []

  // DuckDuckGo HTML results use <a rel="nofollow" class="result__a"> for links
  const resultRegex = /<a\s+rel="nofollow"\s+class="result__a"\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  const snippetRegex = /<a\s+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g

  let match
  const urlMatches: string[] = []
  const titleMatches: string[] = []

  while ((match = resultRegex.exec(html)) !== null && urlMatches.length < maxResults) {
    let url = match[1]!.trim()
    // DuckDuckGo wraps URLs in redirect
    const redirectMatch = url.match(/uddg=([^&]+)/)
    if (redirectMatch) {
      url = decodeURIComponent(redirectMatch[1]!)
    }
    const title = match[2]!.replace(/<[^>]+>/g, '').trim()
    urlMatches.push(url)
    titleMatches.push(title)
  }

  const snippetMatches: string[] = []
  while ((match = snippetRegex.exec(html)) !== null && snippetMatches.length < maxResults) {
    const snippet = match[1]!.replace(/<[^>]+>/g, '').trim()
    snippetMatches.push(snippet)
  }

  for (let i = 0; i < Math.min(urlMatches.length, maxResults); i++) {
    results.push({
      title: titleMatches[i] || '(No title)',
      url: urlMatches[i] || '',
      snippet: snippetMatches[i] || '',
      source: 'duckduckgo',
    })
  }

  return results
}

// ─── Deduplication ───────────────────────────────────────

/**
 * Deduplicate search results by URL.
 * Keeps the first occurrence of each URL (case-insensitive).
 * Preserves original order.
 */
export function deduplicateResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>()
  const deduped: SearchResult[] = []

  for (const r of results) {
    const key = r.url.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      deduped.push(r)
    }
  }

  return deduped
}

// ─── Engine Selection ─────────────────────────────────────

/**
 * Select the appropriate search engine based on type and availability.
 */
async function searchWithEngineSelection(
  query: string,
  maxResults: number,
  type: 'auto' | 'fast' | 'deep',
  livecrawl: 'fallback' | 'preferred' | undefined,
  timeout: number,
): Promise<SearchResult[]> {
  const hasExaKey = !!process.env.EXA_API_KEY

  switch (type) {
    case 'fast':
      // Fast: DuckDuckGo only (no API key needed)
      return duckDuckGoSearch(query, maxResults, timeout)

    case 'deep':
      // Deep: Exa only (requires API key)
      if (!hasExaKey) {
        // Exa not available, return empty - deep search explicitly requires Exa
        return []
      }
      return exaSearch(query, { maxResults, type: 'deep', livecrawl, timeout })
    default:
      // Auto: try Exa first, fallback to DuckDuckGo
      if (hasExaKey) {
        try {
          const exaResults = await exaSearch(query, {
            maxResults,
            type: 'auto',
            livecrawl,
            timeout,
          })
          if (exaResults.length > 0) {
            return deduplicateResults(exaResults)
          }
        } catch {
          // Exa failed, fall through to DuckDuckGo
        }
      }

      // Fallback to DuckDuckGo
      try {
        const ddgResults = await duckDuckGoSearch(query, maxResults, timeout)
        return deduplicateResults(ddgResults)
      } catch {
        return []
      }
  }
}

// ─── Tool Implementation ─────────────────────────────────

export class WebSearchTool extends BaseTool<typeof webSearchSchema, WebSearchOutput> {
  name = 'web_search'
  description =
    'Search the web using multi-engine (Exa primary, DuckDuckGo fallback). Supports auto/fast/deep search types, live crawling, and deduplication.'
  inputSchema = webSearchSchema

  /**
   * Public method: Search via Exa API.
   * Exposed for testing and direct use.
   */
  exaSearch = exaSearch

  /**
   * Public method: Deduplicate results by URL.
   * Exposed for testing and direct use.
   */
  deduplicateResults = deduplicateResults

  async execute(input: z.infer<typeof webSearchSchema>, _context: ToolContext): Promise<ToolResult<WebSearchOutput>> {
    const { query, type = 'auto', maxResults = 8, livecrawl, timeout = 15000 } = input

    try {
      const results = await searchWithEngineSelection(query, maxResults, type, livecrawl, timeout)

      const content =
        results.length > 0
          ? `Search results for "${query}":\n\n${results
              .map(
                (r, i) =>
                  `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}${r.publishedDate ? `\n   Published: ${r.publishedDate}` : ''}`,
              )
              .join('\n\n')}`
          : `No search results found for "${query}".`

      return {
        data: { query, results },
        content,
      }
    } catch (err: unknown) {
      const error = err as Error
      return {
        data: { query, results: [] },
        content: `Error performing search: ${error.message}`,
        isError: true,
      }
    }
  }

  override isReadOnly(): boolean {
    return true
  }

  override isConcurrencySafe(): boolean {
    return true
  }
}
