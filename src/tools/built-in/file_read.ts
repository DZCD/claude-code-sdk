/**
 * ClaudeCode SDK — FileReadTool
 *
 * Reads file content from the local filesystem with support for
 * offset/limit (line range) reading.
 */
import { readFile, stat } from 'node:fs/promises'
import { z } from 'zod'
import type { ToolContext, ToolResult } from '../../types/tool.js'
import { BaseTool } from '../base.js'

// ─── Schema ──────────────────────────────────────────────

export const fileReadSchema = z.object({
  file_path: z.string().min(1).describe('The absolute path to the file to read'),
  offset: z.number().int().nonnegative().optional().describe('The 1-based line number to start reading from'),
  limit: z.number().int().positive().optional().describe('The number of lines to read'),
})

// ─── Tool Implementation ─────────────────────────────────

export interface FileReadOutput {
  content: string
  numLines: number
  startLine: number
  totalLines: number
}

export class FileReadTool extends BaseTool<typeof fileReadSchema, FileReadOutput> {
  name = 'read'
  description =
    'Read the contents of a file from the local filesystem. Supports line-offset based partial reads for large files.'
  inputSchema = fileReadSchema

  async execute(input: z.infer<typeof fileReadSchema>, _context: ToolContext): Promise<ToolResult<FileReadOutput>> {
    const { file_path, offset, limit } = input

    let fileStats
    try {
      fileStats = await stat(file_path)
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException
      if (nodeErr.code === 'ENOENT') {
        return {
          data: { content: '', numLines: 0, startLine: 0, totalLines: 0 },
          content: `Error: File does not exist: ${file_path}`,
          isError: true,
        }
      }
      return {
        data: { content: '', numLines: 0, startLine: 0, totalLines: 0 },
        content: `Error reading file: ${nodeErr.message}`,
        isError: true,
      }
    }

    if (!fileStats.isFile()) {
      return {
        data: { content: '', numLines: 0, startLine: 0, totalLines: 0 },
        content: `Error: Not a file: ${file_path}`,
        isError: true,
      }
    }

    let fullContent: string
    try {
      fullContent = await readFile(file_path, 'utf-8')
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException
      return {
        data: { content: '', numLines: 0, startLine: 0, totalLines: 0 },
        content: `Error reading file: ${nodeErr.message}`,
        isError: true,
      }
    }

    const allLines = fullContent.split('\n')
    // If the file ends with a newline, the last element will be empty;
    // we don't count that as a line.
    const totalLines = fullContent === '' ? 0 : fullContent.endsWith('\n') ? allLines.length - 1 : allLines.length

    const startLine = offset ?? 1
    const lineLimit = limit ?? totalLines

    // Convert 1-based offset to 0-based index
    const startIndex = Math.max(0, startLine - 1)
    const selectedLines = allLines.slice(startIndex, startIndex + lineLimit)
    const content = selectedLines.join('\n')

    return {
      data: {
        content,
        numLines: selectedLines.length,
        startLine,
        totalLines: totalLines,
      },
      content: content || '(File is empty)',
    }
  }

  override isReadOnly(): boolean {
    return true
  }

  override isConcurrencySafe(): boolean {
    return true
  }
}
