/**
 * ClaudeCode SDK — FileEditTool
 *
 * Applies string-based edits to files on the local filesystem.
 * Uses exact string matching (old_string → new_string replacement).
 * Supports appending via empty old_string.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import type { ToolContext, ToolResult } from '../../types/tool.js'
import { BaseTool } from '../base.js'

// ─── Schema ──────────────────────────────────────────────

export const fileEditSchema = z.object({
  file_path: z.string().min(1).describe('The absolute path to the file to edit'),
  old_string: z.string().describe('The text to search for (must match exactly)'),
  new_string: z.string().describe('The text to replace old_string with'),
})

// ─── Tool Implementation ─────────────────────────────────

export interface FileEditOutput {
  type: 'create' | 'update'
  filePath: string
  oldString: string
  newString: string
}

export class FileEditTool extends BaseTool<typeof fileEditSchema, FileEditOutput> {
  name = 'edit'
  description =
    'Edit a file by finding and replacing exact text matches. Can also append content by providing an empty old_string.'
  inputSchema = fileEditSchema

  async execute(input: z.infer<typeof fileEditSchema>, _context: ToolContext): Promise<ToolResult<FileEditOutput>> {
    const { file_path, old_string, new_string } = input

    // Read existing file content
    let existingContent: string
    try {
      existingContent = await readFile(file_path, 'utf-8')
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException
      if (nodeErr.code === 'ENOENT') {
        return {
          data: {
            type: 'create',
            filePath: file_path,
            oldString: old_string,
            newString: new_string,
          },
          content: `Error: File does not exist: ${file_path}`,
          isError: true,
        }
      }
      return {
        data: {
          type: 'update',
          filePath: file_path,
          oldString: old_string,
          newString: new_string,
        },
        content: `Error reading file: ${nodeErr.message}`,
        isError: true,
      }
    }

    // If old_string is empty, append to the end of the file
    if (old_string === '') {
      const newContent = existingContent + new_string
      try {
        await mkdir(dirname(file_path), { recursive: true })
        await writeFile(file_path, newContent, 'utf-8')
      } catch (err: unknown) {
        const nodeErr = err as NodeJS.ErrnoException
        return {
          data: {
            type: 'update',
            filePath: file_path,
            oldString: old_string,
            newString: new_string,
          },
          content: `Error writing file: ${nodeErr.message}`,
          isError: true,
        }
      }

      return {
        data: {
          type: 'update',
          filePath: file_path,
          oldString: old_string,
          newString: new_string,
        },
        content: `Content appended to ${file_path}`,
      }
    }

    // Find and replace old_string with new_string
    const index = existingContent.indexOf(old_string)
    if (index === -1) {
      return {
        data: {
          type: 'update',
          filePath: file_path,
          oldString: old_string,
          newString: new_string,
        },
        content: `Error: The search string was not found in the file "${file_path}". The file has been read — please verify the exact content to match.`,
        isError: true,
      }
    }

    const newContent = existingContent.slice(0, index) + new_string + existingContent.slice(index + old_string.length)

    try {
      await mkdir(dirname(file_path), { recursive: true })
      await writeFile(file_path, newContent, 'utf-8')
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException
      return {
        data: {
          type: 'update',
          filePath: file_path,
          oldString: old_string,
          newString: new_string,
        },
        content: `Error writing file: ${nodeErr.message}`,
        isError: true,
      }
    }

    return {
      data: {
        type: 'update',
        filePath: file_path,
        oldString: old_string,
        newString: new_string,
      },
      content: `The file ${file_path} has been edited successfully.`,
    }
  }
}
