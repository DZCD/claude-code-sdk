/**
 * ClaudeCode SDK — FileWriteTool
 *
 * Writes content to a file on the local filesystem. Creates the file
 * if it doesn't exist, or overwrites it if it does.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import type { ToolContext, ToolResult } from '../../types/tool.js'
import { BaseTool } from '../base.js'

// ─── Schema ──────────────────────────────────────────────

export const fileWriteSchema = z.object({
  file_path: z.string().min(1).describe('The absolute path to the file to write'),
  content: z.string().describe('The content to write to the file'),
})

// ─── Tool Implementation ─────────────────────────────────

export interface FileWriteOutput {
  type: 'create' | 'update'
  filePath: string
  content: string
}

export class FileWriteTool extends BaseTool<typeof fileWriteSchema, FileWriteOutput> {
  name = 'write'
  description =
    'Write content to a file on the local filesystem. Creates the file if it does not exist, or overwrites it if it does.'
  inputSchema = fileWriteSchema

  async execute(input: z.infer<typeof fileWriteSchema>, _context: ToolContext): Promise<ToolResult<FileWriteOutput>> {
    const { file_path, content } = input

    // Check if file exists to determine create vs update
    let existed = false
    try {
      await readFile(file_path, 'utf-8')
      existed = true
    } catch {
      existed = false
    }

    // Ensure parent directory exists
    try {
      await mkdir(dirname(file_path), { recursive: true })
    } catch {
      // Directory may already exist
    }

    try {
      await writeFile(file_path, content, 'utf-8')
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException
      return {
        data: {
          type: existed ? 'update' : 'create',
          filePath: file_path,
          content: '',
        },
        content: `Error writing file: ${nodeErr.message}`,
        isError: true,
      }
    }

    const type = existed ? 'update' : 'create'

    return {
      data: { type, filePath: file_path, content },
      content:
        type === 'create'
          ? `File created successfully at: ${file_path}`
          : `The file ${file_path} has been updated successfully.`,
    }
  }
}
