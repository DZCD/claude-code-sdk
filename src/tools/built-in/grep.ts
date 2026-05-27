/**
 * ClaudeCode SDK — GrepTool
 *
 * Searches file contents using regular expressions.
 * Supports case-insensitive search, glob filtering, and targeted path searching.
 */
import { readFile, stat } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod'
import { BaseTool } from '../base.js'
import type { ToolContext, ToolResult } from '../../types/tool.js'

// ─── Schema ──────────────────────────────────────────────

export const grepSchema = z.object({
  pattern: z.string().min(1).describe('The regular expression pattern to search for in file contents'),
  path: z.string().optional().describe('File or directory to search in. Defaults to current working directory.'),
  glob: z.string().optional().describe('Glob pattern to filter files (e.g., "*.js", "*.{ts,tsx}")'),
  '-i': z.boolean().optional().describe('Case insensitive search (like rg -i)'),
})

// ─── Types ───────────────────────────────────────────────

export interface GrepMatch {
  file: string
  line: number
  lineContent: string
}

export interface GrepOutput {
  results: GrepMatch[]
  numMatches: number
}

// ─── Simple Glob Matching for File Filtering ─────────────

function fileMatchesGlob(fileName: string, glob: string): boolean {
  // Convert simple glob to regex
  let regexStr = ''
  let i = 0
  while (i < glob.length) {
    const ch = glob[i]
    if (ch === '*') {
      regexStr += '.*'
      i++
    } else if (ch === '?') {
      regexStr += '.'
      i++
    } else if (ch === '.') {
      regexStr += '\\.'
      i++
    } else if (ch === '{') {
      const closing = glob.indexOf('}', i)
      if (closing > i) {
        const inner = glob.slice(i + 1, closing)
        const parts = inner.split(',').map(s => s.trim())
        regexStr += '(' + parts.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')'
        i = closing + 1
      } else {
        regexStr += '\\{'
        i++
      }
    } else {
      regexStr += ch!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      i++
    }
  }
  return new RegExp(`^${regexStr}$`).test(fileName)
}

// ─── Recursive File Search ───────────────────────────────

async function collectFiles(dirPath: string, globFilter?: string): Promise<string[]> {
  const { readdir, stat: fsStat } = await import('fs/promises')
  const files: string[] = []

  async function walk(dir: string) {
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry)
      let stats
      try {
        stats = await fsStat(fullPath)
      } catch {
        continue
      }

      if (stats.isDirectory()) {
        if (!entry.startsWith('.')) {
          await walk(fullPath)
        }
      } else if (stats.isFile()) {
        if (!globFilter || fileMatchesGlob(entry, globFilter)) {
          files.push(fullPath)
        }
      }
    }
  }

  await walk(dirPath)
  return files
}

// ─── Tool Implementation ─────────────────────────────────

export class GrepTool extends BaseTool<typeof grepSchema, GrepOutput> {
  name = 'grep'
  description = 'Search file contents using regular expressions. Supports case-insensitive search and file type filtering.'
  inputSchema = grepSchema

  async execute(
    input: z.infer<typeof grepSchema>,
    _context: ToolContext,
  ): Promise<ToolResult<GrepOutput>> {
    const { pattern, path: searchPath = process.cwd(), glob, '-i': caseInsensitive } = input

    // Validate the regex
    let regex: RegExp
    try {
      regex = new RegExp(pattern, caseInsensitive ? 'gmi' : 'gm')
    } catch (err: unknown) {
      const regexErr = err as Error
      return {
        data: { results: [], numMatches: 0 },
        content: `Error: Invalid regular expression: ${regexErr.message}`,
        isError: true,
      }
    }

    // Check if search path is a file or directory
    let pathStats
    try {
      pathStats = await stat(searchPath)
    } catch {
      return {
        data: { results: [], numMatches: 0 },
        content: `Error: Path does not exist: ${searchPath}`,
        isError: true,
      }
    }

    try {
      const results: GrepMatch[] = []

      if (pathStats.isFile()) {
        // Search a single file
        const content = await readFile(searchPath, 'utf-8')
        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          regex.lastIndex = 0
          const trimmedLine = lines[i]!.replace(/\r$/, '')
          if (regex.test(trimmedLine)) {
            results.push({
              file: searchPath,
              line: i + 1,
              lineContent: trimmedLine,
            })
          }
        }
      } else if (pathStats.isDirectory()) {
        // Search directory recursively
        const files = await collectFiles(searchPath, glob)
        for (const file of files) {
          try {
            const content = await readFile(file, 'utf-8')
            const lines = content.split('\n')
            for (let i = 0; i < lines.length; i++) {
              regex.lastIndex = 0
              const trimmedLine = lines[i]!.replace(/\r$/, '')
              if (regex.test(trimmedLine)) {
                results.push({
                  file,
                  line: i + 1,
                  lineContent: trimmedLine,
                })
                // Limit results to prevent memory issues
                if (results.length >= 1000) break
              }
            }
          } catch {
            // Skip files that can't be read
          }
          if (results.length >= 1000) break
        }
      }

      const contentPreview = results.slice(0, 20).map(r =>
        `${r.file}:${r.line}:${r.lineContent}`
      ).join('\n')

      return {
        data: { results, numMatches: results.length },
        content: results.length > 0
          ? `Found ${results.length} match(es):\n${contentPreview}${results.length > 20 ? `\n... and ${results.length - 20} more` : ''}`
          : 'No matches found.',
      }
    } catch (err: unknown) {
      const nodeErr = err as Error
      return {
        data: { results: [], numMatches: 0 },
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
