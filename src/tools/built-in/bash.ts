/**
 * ClaudeCode SDK — BashTool
 *
 * Executes shell commands via child_process.exec with timeout support.
 * Integrated with the BashTool security layer for command safety checking,
 * path validation, permission mode handling, and read-only detection.
 *
 * The security subsystem provides:
 * - bashSecurity: Dangerous pattern detection (substitution, injection, etc.)
 * - bashPermissions: Rule-based allow/deny permission checking
 * - pathValidation: Path extraction and dangerous path detection
 * - readOnlyValidation: Enhanced read-only command validation
 * - sedValidation: Sed command safety validation
 * - modeValidation: Mode-specific permission behavior
 */
import { exec } from 'child_process'
import { promisify } from 'util'
import { z } from 'zod'
import { BaseTool } from '../base.js'
import type { ToolContext, ToolResult } from '../../types/tool.js'
import { bashCommandIsSafe } from './bash-security-utils/bashSecurity.js'
import { checkBashPermission } from './bash-security-utils/bashPermissions.js'
import { checkPermissionMode } from './bash-security-utils/modeValidation.js'
import { checkReadOnlyConstraints } from './bash-security-utils/readOnlyValidation.js'
import type { PermissionContext } from './bash-security-utils/types.js'

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

  /**
   * Run pre-execution security checks on the command.
   * Returns an error result if the command is unsafe, or null if safe.
   */
  private runSecurityChecks(
    command: string,
    context: ToolContext,
  ): ToolResult<{ stdout: string; stderr: string; exitCode: number }> | null {
    // 1. Command safety check
    const safetyResult = bashCommandIsSafe(command)
    if (!safetyResult.safe) {
      return {
        data: { stdout: '', stderr: safetyResult.message || 'Command rejected by security check', exitCode: 1 },
        content: `Security Error: ${safetyResult.message}\n\nCommand was blocked by security validation.`,
        isError: true,
      }
    }

    // 2. Read-only constraint check (UNC paths, etc.)
    const readOnlyResult = checkReadOnlyConstraints(command)
    if (!readOnlyResult.safe) {
      return {
        data: { stdout: '', stderr: readOnlyResult.message || 'Command rejected by read-only validation', exitCode: 1 },
        content: `Security Error: ${readOnlyResult.message}`,
        isError: true,
      }
    }

    // 3. Permission mode check (bypass/acceptEdits)
    if (context.permissionContext) {
      const modeResult = checkPermissionMode(command, context.permissionContext as PermissionContext)
      if (modeResult.behavior === 'deny') {
        return {
          data: { stdout: '', stderr: modeResult.message, exitCode: 1 },
          content: `Permission Denied: ${modeResult.message}`,
          isError: true,
        }
      }
    }

    return null
  }

  async execute(
    input: z.infer<typeof bashSchema>,
    context: ToolContext,
  ): Promise<ToolResult<{ stdout: string; stderr: string; exitCode: number }>> {
    const { command, timeout = 30000 } = input

    // Run security pre-checks
    const securityError = this.runSecurityChecks(command, context)
    if (securityError) return securityError

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
