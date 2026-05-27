/**
 * ClaudeCode SDK — BashTool
 *
 * Executes shell commands via child_process.exec with timeout support.
 * Distinguishes read-only commands (ls, cat, git status, etc.) from
 * write/modify commands.
 */
import { exec } from 'child_process'
import { promisify } from 'util'
import { z } from 'zod'
import { BaseTool } from '../base.js'
import type { ToolContext, ToolResult } from '../../types/tool.js'

const execAsync = promisify(exec)

// ─── Read-Only Commands ──────────────────────────────────

const READ_ONLY_COMMANDS = new Set([
  'ls', 'cat', 'head', 'tail', 'wc', 'stat', 'file',
  'which', 'whereis', 'type',
  'pwd', 'date', 'env', 'printenv', 'uname', 'hostname', 'id',
  'whoami', 'groups', 'getconf', 'locale',
])

// ─── Schema ──────────────────────────────────────────────

export const bashSchema = z.object({
  command: z.string().min(1).describe('The bash command to execute'),
  timeout: z.number().positive().optional().describe('Timeout in milliseconds (default: 30000)'),
})

/**
 * Check if a command is read-only by examining the first token of each subcommand.
 * Handles compound commands (e.g. `ls && echo done`) by checking ALL parts.
 */
function isReadOnlyCommand(command: string): boolean {
  // Split by common operators and check each command
  const parts = command.split(/[;&|]+/).map(s => s.trim()).filter(Boolean)

  // Handle && and || within parts
  const allParts: string[] = []
  for (const part of parts) {
    const subparts = part.split(/\s+(&&|\|\|)\s+/).filter((_, i) => i % 2 === 0)
    allParts.push(...subparts.map(s => s.trim()).filter(Boolean))
  }

  const commandsToCheck = allParts.length > 0 ? allParts : parts
  if (commandsToCheck.length === 0) return false

  for (const part of commandsToCheck) {
    const firstToken = part.split(/\s+/)[0]
    if (!firstToken) continue

    if (!READ_ONLY_COMMANDS.has(firstToken)) {
      return false
    }
  }

  return true
}

// ─── Tool Implementation ─────────────────────────────────

export class BashTool extends BaseTool<typeof bashSchema, { stdout: string; stderr: string; exitCode: number }> {
  name = 'bash'
  description = 'Execute a bash command on the local system. Use this tool to run shell commands, scripts, and CLI tools.'
  inputSchema = bashSchema

  async execute(
    input: z.infer<typeof bashSchema>,
    _context: ToolContext,
  ): Promise<ToolResult<{ stdout: string; stderr: string; exitCode: number }>> {
    const { command, timeout = 30000 } = input

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        shell: '/bin/bash',
      })

      const output = stdout || stderr || '(No output)'

      return {
        data: { stdout: stdout || '', stderr: stderr || '', exitCode: 0 },
        content: output.trimEnd() || '(No output)',
        isError: false,
      }
    } catch (err: unknown) {
      const error = err as Error & { code?: number; stderr?: string; stdout?: string; killed?: boolean; signal?: string }
      const exitCode = error.code ?? 1
      const stderrText = error.stderr || ''
      const stdoutText = error.stdout || ''

      if (error.killed || error.signal) {
        return {
          data: { stdout: stdoutText, stderr: `Command timed out after ${timeout}ms\n${stderrText}`, exitCode },
          content: `Error: Command timed out after ${timeout}ms\n${stderrText || stdoutText || '(No output)'}`,
          isError: true,
        }
      }

      return {
        data: { stdout: stdoutText, stderr: stderrText || error.message, exitCode },
        content: `Exit code ${exitCode}\n\n${stderrText || stdoutText || error.message}`,
        isError: true,
      }
    }
  }

  override isReadOnly(input: z.infer<typeof bashSchema>): boolean {
    return isReadOnlyCommand(input.command)
  }
}
