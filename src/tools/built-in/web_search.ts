/**
 * ClaudeCode SDK — WebSearchTool
 *
 * Searches the web using DuckDuckGo's HTML search endpoint.
 * No API key required — parses the HTML results page directly.
 * Returns structured search results (title, url, snippet).
 */
import { z } from 'zod'
import { BaseTool } from '../base.js'
import type { ToolContext, ToolResult } from '../../types/tool.js'

// ─── Schema ──────────────────────────────────────────────

export const webSearchSchema = z.object({
  query: z.string().min(2).describe('The search query'),
  maxResults: z.number().int().min(1).max(20).optional().describe('Maximum number of search results to return (default: 8, max: 20)'),
})

// ─── Types ───────────────────────────────────────────────

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

export interface WebSearchOutput {
  query: string
  results: SearchResult[]
}

// ─── DuckDuckGo HTML Parser ──────────────────────────────

/**
 * Search using DuckDuckGo's lite HTML endpoint.
 * Returns parsed search results with title, URL, and snippet.
 */
async function searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResult[]> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 15000)

  try {
    const url = new URL('https://html.duckduckgo.com/html/')
    url.searchParams.set('q', query)

    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ClaudeCodeSDK/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
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

  // Split on result entries
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
    })
  }

  return results
}

// ─── Tool Implementation ─────────────────────────────────

export class WebSearchTool extends BaseTool<typeof webSearchSchema, WebSearchOutput> {
  name = 'web_search'
  description = 'Search the web using DuckDuckGo. Returns structured search results with titles, URLs, and snippets.'
  inputSchema = webSearchSchema

  async execute(
    input: z.infer<typeof webSearchSchema>,
    _context: ToolContext,
  ): Promise<ToolResult<WebSearchOutput>> {
    const { query, maxResults = 8 } = input

    try {
      const results = await searchDuckDuckGo(query, maxResults)

      const content = results.length > 0
        ? `Search results for "${query}":\n\n${results.map((r, i) =>
          `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`
        ).join('\n\n')}`
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
