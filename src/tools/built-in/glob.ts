/**
 * ClaudeCode SDK — GlobTool
 *
 * Finds files matching a glob pattern using fast filesystem traversal.
 * Supports ** (recursive), * (wildcard), and ? (single char) patterns.
 */
import { readdir, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { z } from 'zod'
import type { ToolContext, ToolResult } from '../../types/tool.js'
import { BaseTool } from '../base.js'

// ─── Schema ──────────────────────────────────────────────

export const globSchema = z.object({
  pattern: z.string().min(1).describe('The glob pattern to match files against (e.g., "*.ts", "**/*.js")'),
  path: z.string().optional().describe('The directory to search in (defaults to current working directory)'),
})

// ─── Glob Matching Utilities ─────────────────────────────

/**
 * Convert a glob pattern to a RegExp for matching file names.
 * Supports *, **, and ? glob patterns.
 */
function globToRegex(pattern: string): RegExp {
  let regexStr = ''
  let i = 0

  while (i < pattern.length) {
    const ch = pattern[i]

    if (ch === '*' && pattern[i + 1] === '*') {
      // ** matches any number of path segments
      if (pattern[i + 2] === sep || pattern[i + 2] === '/') {
        regexStr += '(?:.+/)?'
        i += 3
      } else {
        regexStr += '.*'
        i += 2
      }
    } else if (ch === '*') {
      // * matches any characters except path separator
      regexStr += '[^/]*'
      i++
    } else if (ch === '?') {
      regexStr += '[^/]'
      i++
    } else if (ch === '.') {
      regexStr += '\\.'
      i++
    } else if (ch === '{') {
      // Simple brace expansion {a,b} → (a|b)
      const closing = pattern.indexOf('}', i)
      if (closing > i) {
        const inner = pattern.slice(i + 1, closing)
        const parts = inner.split(',').map((s) => s.trim())
        regexStr += `(${parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`
        i = closing + 1
      } else {
        regexStr += '\\{'
        i++
      }
    } else {
      // Escape special regex characters
      if (/[+^${}()|[\]\\]/.test(ch!)) {
        regexStr += `\\${ch!}`
      } else {
        regexStr += ch!
      }
      i++
    }
  }

  return new RegExp(`^${regexStr}$`)
}

/**
 * Check if a path string matches a glob pattern.
 */
function matchesGlob(filePath: string, pattern: string): boolean {
  // Handle ** patterns (recursive) at start
  if (pattern.startsWith('**')) {
    const rest = pattern.slice(pattern.startsWith('**/') ? 3 : 2)
    // Check if any suffix of the path matches
    const parts = filePath.split('/')
    for (let i = 0; i < parts.length; i++) {
      const subpath = parts.slice(i).join('/')
      if (subpath === rest || matchesGlob(subpath, rest)) {
        return true
      }
    }
    return false
  }

  // Handle simple patterns without path separators
  if (!pattern.includes('/')) {
    const basename = filePath.split('/').pop() || filePath
    const regex = globToRegex(pattern)
    return regex.test(basename)
  }

  // Handle patterns with path separators
  const regex = globToRegex(pattern)
  return regex.test(filePath)
}

/**
 * Recursively walk a directory, collecting files that match the pattern.
 */
async function walkDirectory(
  dirPath: string,
  pattern: string,
  baseDir: string,
  maxResults = 1000,
  results: string[] = [],
): Promise<string[]> {
  if (results.length >= maxResults) return results

  let entries: string[]
  try {
    entries = await readdir(dirPath)
  } catch {
    return results
  }

  for (const entry of entries) {
    if (results.length >= maxResults) break

    const fullPath = join(dirPath, entry)
    const relativePath = relative(baseDir, fullPath)
    let fileStats
    try {
      fileStats = await stat(fullPath)
    } catch {
      continue
    }

    if (fileStats.isDirectory()) {
      // Skip hidden directories (starting with .)
      if (!entry.startsWith('.') || entry === '.') {
        await walkDirectory(fullPath, pattern, baseDir, maxResults, results)
      }
    } else if (matchesGlob(relativePath, pattern)) {
      results.push(relativePath)
    }
  }

  return results
}

// ─── Tool Implementation ─────────────────────────────────

export interface GlobOutput {
  files: string[]
  numFiles: number
}

export class GlobTool extends BaseTool<typeof globSchema, GlobOutput> {
  name = 'glob'
  description = 'Find files and directories that match a glob pattern. Supports *, **, and ? wildcards.'
  inputSchema = globSchema

  async execute(input: z.infer<typeof globSchema>, _context: ToolContext): Promise<ToolResult<GlobOutput>> {
    const { pattern, path: searchPath = process.cwd() } = input

    let dirStats
    try {
      dirStats = await stat(searchPath)
    } catch {
      return {
        data: { files: [], numFiles: 0 },
        content: `Error: Directory does not exist: ${searchPath}`,
        isError: true,
      }
    }

    if (!dirStats.isDirectory()) {
      return {
        data: { files: [], numFiles: 0 },
        content: `Error: Not a directory: ${searchPath}`,
        isError: true,
      }
    }

    try {
      const files = await walkDirectory(searchPath, pattern, searchPath)
      const sorted = files.sort()

      return {
        data: { files: sorted, numFiles: sorted.length },
        content:
          sorted.length > 0 ? `Found ${sorted.length} file(s):\n${sorted.join('\n')}` : 'No files matched the pattern.',
      }
    } catch (err: unknown) {
      const nodeErr = err as Error
      return {
        data: { files: [], numFiles: 0 },
        content: `Error searching files: ${nodeErr.message}`,
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
