/**
 * ClaudeCode SDK — Local Command Output Type
 *
 * Captures the result of a locally executed command (stdout, stderr, exit code).
 * Integrates with CLI/tool message pipelines and can be converted to
 * system messages with 'local_command_output' subtype.
 *
 * Based on Claude Code's SDKLocalCommandOutputMessageSchema
 * (src/entrypoints/sdk/coreSchemas.ts).
 */

import { createSystemMessage } from './message.js'

// ─── Sentinel ─────────────────────────────────────────

/**
 * Magic sentinel used to mark system messages that wrap command output.
 * Consumers can detect this prefix to know the message came from command output.
 */
export const COMMAND_OUTPUT_SENTINEL = '@@command_output@@'

// ─── Types ────────────────────────────────────────────

export interface LocalCommandOutput {
  /** Standard output from the command */
  stdout: string
  /** Standard error from the command */
  stderr: string
  /** Process exit code (0 = success) */
  exitCode: number
}

/** Status derived from exit code */
export type CommandStatus = 'success' | 'error'

// ─── Type Guards ──────────────────────────────────────

/** Check if an object is a valid LocalCommandOutput */
export function isCommandOutput(obj: unknown): obj is LocalCommandOutput {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
  const o = obj as Record<string, unknown>
  return (
    typeof o.stdout === 'string' &&
    typeof o.stderr === 'string' &&
    typeof o.exitCode === 'number' &&
    Number.isInteger(o.exitCode)
  )
}

// ─── Factory Functions ────────────────────────────────

/**
 * Create a LocalCommandOutput.
 */
export function createCommandOutput(
  stdout?: string | null,
  stderr?: string | null,
  exitCode?: number | null,
): LocalCommandOutput {
  return {
    stdout: stdout ?? '',
    stderr: stderr ?? '',
    exitCode: exitCode ?? 0,
  }
}

// ─── Conversion Functions ─────────────────────────────

/**
 * Combine stdout + stderr into a single text representation.
 */
export function commandOutputToText(output: LocalCommandOutput): string {
  const parts: string[] = []
  if (output.stdout) parts.push(output.stdout.trimEnd())
  if (output.stderr) parts.push(`[stderr]\n${output.stderr.trimEnd()}`)
  if (output.exitCode !== 0 && !output.stdout && !output.stderr) {
    parts.push(`Exit code: ${output.exitCode}`)
  }
  return parts.join('\n')
}

/**
 * Convert a LocalCommandOutput to a system message.
 *
 * Produces a system message with COMMAND_OUTPUT_SENTINEL prefix
 * for downstream consumers to identify.
 */
export function commandOutputToSystemMessage(output: LocalCommandOutput) {
  const text = commandOutputToText(output)
  return createSystemMessage(`${COMMAND_OUTPUT_SENTINEL}${text}`)
}

/**
 * Merge multiple command outputs into one.
 * Concatenates stdout/stderr and takes the last non-zero exit code.
 */
export function mergeCommandOutputs(outputs: LocalCommandOutput[]): LocalCommandOutput {
  if (outputs.length === 0) {
    return { stdout: '', stderr: '', exitCode: 0 }
  }
  const stdout = outputs
    .map((o) => o.stdout)
    .filter(Boolean)
    .join('\n')
  const stderr = outputs
    .map((o) => o.stderr)
    .filter(Boolean)
    .join('\n')
  // Take the last non-zero exit code, or 0 if all succeeded
  let exitCode = 0
  for (const o of outputs) {
    if (o.exitCode !== 0) exitCode = o.exitCode
  }
  return { stdout, stderr, exitCode }
}

/**
 * Determine command status from exit code.
 */
export function exitCodeToStatus(exitCode: number): CommandStatus {
  return exitCode === 0 ? 'success' : 'error'
}

/**
 * Format a LocalCommandOutput for display/logging.
 */
export function formatCommandOutput(output: LocalCommandOutput): string {
  const lines: string[] = []
  if (output.stdout) {
    lines.push(`[stdout]\n${output.stdout.trimEnd()}`)
  }
  if (output.stderr) {
    lines.push(`[stderr]\n${output.stderr.trimEnd()}`)
  }
  if (output.exitCode !== 0) {
    lines.push(`exit code: ${output.exitCode}`)
  }
  return lines.join('\n')
}
