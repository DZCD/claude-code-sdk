/**
 * ClaudeCode SDK — BashTool Sed Validation
 *
 * Security validation for sed commands.
 * Handles different sed patterns:
 * - Line printing commands: sed -n 'Np'
 * - Read-only expressions: sed -n 's///p'
 * - File redirection (write): sed 'w file'
 * - File reading: sed 'r file'
 * - Combined read/write flags
 */
import type { SafetyResult, PermissionResult } from './types.js'

// ─── Flag Validation Helper ───────────────────────────────

function validateFlagsAgainstAllowlist(
  flags: string[],
  allowedFlags: string[],
): boolean {
  for (const flag of flags) {
    if (flag.startsWith('-') && !flag.startsWith('--') && flag.length > 2) {
      for (let i = 1; i < flag.length; i++) {
        const singleFlag = '-' + flag[i]
        if (!allowedFlags.includes(singleFlag)) return false
      }
    } else {
      if (!allowedFlags.includes(flag)) return false
    }
  }
  return true
}

// ─── Pattern 1: Line Printing ─────────────────────────────

/**
 * Pattern 1: Check if this is a line printing command with -n flag.
 * Allows: sed -n 'N' | sed -n 'N,M' with optional -E, -r, -z flags.
 * Allows semicolon-separated print commands.
 * File arguments are ALLOWED for this pattern.
 */
export function isLinePrintingCommand(
  command: string,
  _expressions: string[],
): boolean {
  const sedMatch = command.match(/^\s*sed\s+/)
  if (!sedMatch) return false

  const withoutSed = command.slice(sedMatch[0].length)
  const allParts = withoutSed.split(/\s+/).filter(Boolean)

  // Extract all flags
  const flags: string[] = allParts.filter(a => a.startsWith('-') && a !== '--')

  // Validate flags - only allow -n, -E, -r, -z and their long forms
  const allowedFlags = [
    '-n', '--quiet', '--silent',
    '-E', '--regexp-extended', '-r',
    '-z', '--zero-terminated', '--posix',
  ]

  if (!validateFlagsAgainstAllowlist(flags, allowedFlags)) return false

  // Check if -n flag is present (required for Pattern 1)
  let hasNFlag = false
  for (const flag of flags) {
    if (flag === '-n' || flag === '--quiet' || flag === '--silent') {
      hasNFlag = true
      break
    }
    if (flag.startsWith('-') && !flag.startsWith('--') && flag.includes('n')) {
      hasNFlag = true
      break
    }
  }

  if (!hasNFlag) return false

  // Must have at least one expression containing 'p' (print)
  const nonFlags = allParts.filter(a => !a.startsWith('-'))
  return nonFlags.some(expr => expr.includes('p'))
}

// ─── Sed Validation Entry ─────────────────────────────────

/**
 * Check if a sed command is allowed by the read-only allowlist.
 * Returns a permission result.
 */
export function sedCommandIsAllowedByAllowlist(command: string): PermissionResult {
  // Pattern 1: Line printing
  if (isLinePrintingCommand(command, [])) {
    return {
      behavior: 'allow',
      message: 'sed line printing command is allowed',
      decisionReason: { type: 'other', reason: 'sed line printing' },
    }
  }

  return {
    behavior: 'passthrough',
    message: 'sed command needs further validation',
  }
}

/**
 * Validate sed command safety.
 */
export function validateSedCommand(command: string): SafetyResult | null {
  if (!command.trim().startsWith('sed')) return null

  // Check for dangerous sed operations
  // w flag writes to files, r flag reads files
  const unquotedContent = command.replace(/'[^']*'/g, '')
    .replace(/"[^"]*"/g, '')

  if (/\bw\s+/.test(unquotedContent) && !/\bn\s/.test(unquotedContent)) {
    // sed 'w file' writes output to file (without -n, this writes all lines)
    // But with -n, '1,2w file' still writes specific lines
    // Only flag as potentially dangerous if using bare w without address range
    if (/\bs\//.test(unquotedContent) && /w\b/.test(unquotedContent)) {
      return null // s///w is just writing the substitution result
    }
    return {
      safe: false,
      message: 'sed command writes to files via w flag',
      reason: 'sed_write',
    }
  }

  if (/[^a-zA-Z]r\s/.test(unquotedContent)) {
    return {
      safe: false,
      message: 'sed command reads files via r flag',
      reason: 'sed_read',
    }
  }

  // Check for -i flag (in-place editing)
  if (/\s+-i\b/.test(command) || command.startsWith('sed -i')) {
    return {
      safe: false,
      message: 'sed command edits files in-place (-i flag)',
      reason: 'sed_in_place',
    }
  }

  return null
}
