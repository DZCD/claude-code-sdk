/**
 * ClaudeCode SDK — WebFetchTool
 *
 * Fetches and extracts readable text content from URLs.
 * Uses the native fetch API with timeout support.
 */
import { z } from 'zod'
import type { ToolContext, ToolResult } from '../../types/tool.js'
import { BaseTool } from '../base.js'

// ─── Schema ──────────────────────────────────────────────

export const webFetchSchema = z.object({
  url: z.string().url().describe('The URL to fetch content from'),
  maxChars: z.number().int().positive().optional().describe('Maximum number of characters to return (default: 50000)'),
})

// ─── Tool Implementation ─────────────────────────────────

export interface WebFetchOutput {
  url: string
  content: string
  statusCode: number
}

/**
 * Simple HTML-to-text extraction.
 * Strips HTML tags, scripts, and styles to extract readable content.
 */
function htmlToText(html: string): string {
  // Remove scripts
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
  // Remove styles
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
  // Remove comments
  text = text.replace(/<!--[\s\S]*?-->/g, '')
  // Replace block-level tags with newlines
  text = text.replace(
    /<\/?(?:div|p|h[1-6]|li|tr|th|td|blockquote|pre|br|hr|section|article|nav|header|footer)[^>]*>/gi,
    '\n',
  )
  // Remove remaining tags
  text = text.replace(/<[^>]+>/g, '')
  // Decode common HTML entities
  text = text.replace(/&amp;/g, '&')
  text = text.replace(/&lt;/g, '<')
  text = text.replace(/&gt;/g, '>')
  text = text.replace(/&quot;/g, '"')
  text = text.replace(/&#39;/g, "'")
  text = text.replace(/&nbsp;/g, ' ')
  // Normalize whitespace
  text = text.replace(/&[a-z]+;/g, ' ')
  text = text.replace(/[ \t]+/g, ' ')
  text = text.replace(/\n{3,}/g, '\n\n')
  // Collapse multiple blank lines
  text = text.replace(/^\s+|\s+$/gm, '').trim()

  return text
}

export class WebFetchTool extends BaseTool<typeof webFetchSchema, WebFetchOutput> {
  name = 'web_fetch'
  description = 'Fetch and extract readable text content from a URL. Returns the page content as plain text.'
  inputSchema = webFetchSchema

  async execute(input: z.infer<typeof webFetchSchema>, _context: ToolContext): Promise<ToolResult<WebFetchOutput>> {
    const { url, maxChars = 50000 } = input

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'ClaudeCodeSDK/1.0',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
      })

      clearTimeout(timeoutId)

      const contentType = response.headers.get('content-type') || ''
      const isHtml =
        contentType.includes('text/html') ||
        contentType.includes('application/xhtml') ||
        contentType.includes('text/plain') ||
        contentType.includes('application/json')
      const isText = contentType.startsWith('text/') || contentType.includes('json') || contentType.includes('xml')

      let text: string

      if (isHtml || isText) {
        text = await response.text()
      } else {
        // For binary content, just report the content type and size
        const buffer = await response.arrayBuffer()
        text = `[Binary content: ${contentType}, ${buffer.byteLength} bytes]`
      }

      // Strip HTML if the content looks like HTML
      if (text.trim().startsWith('<!') || text.trim().startsWith('<html') || contentType.includes('text/html')) {
        text = htmlToText(text)
      }

      // Apply maxChars limit
      if (text.length > maxChars) {
        const truncMsg = `\n\n[Content truncated at ${maxChars} characters]`
        text = text.slice(0, maxChars - truncMsg.length) + truncMsg
      }

      return {
        data: {
          url,
          content: text,
          statusCode: response.status,
        },
        content: text || '(No content)',
      }
    } catch (err: unknown) {
      clearTimeout(timeoutId)
      const error = err as Error
      return {
        data: { url, content: '', statusCode: 0 },
        content: `Error fetching URL: ${error.message}`,
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
