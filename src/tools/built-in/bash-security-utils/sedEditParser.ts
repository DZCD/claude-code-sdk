/**
 * ClaudeCode SDK — BashTool Sed Edit Parser
 *
 * Parser for sed edit commands (-i flag substitutions).
 * Extracts file paths and substitution patterns to enable
 * file-edit-style rendering and validation.
 *
 * Adapted from the Claude Code reference implementation
 * with SDK-specific simplifications.
 */
import type { SedEditInfo } from './types.js'

/**
 * Check if a command is a sed in-place edit command.
 * Returns true only for simple sed -i 's/pattern/replacement/flags' file commands.
 */
export function isSedInPlaceEdit(command: string): boolean {
  return parseSedEditCommand(command) !== null
}

/**
 * Parse tokens from a sed command after 'sed'.
 * Simple tokenization that handles quotes.
 */
function simpleTokenize(cmd: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false
  let escaped = false

  for (const char of cmd) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === '\\') {
      current += char
      escaped = true
      continue
    }

    if (char === "'" && !inDouble) {
      inSingle = !inSingle
      current += char
      continue
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble
      current += char
      continue
    }

    if (/\s/.test(char) && !inSingle && !inDouble) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (current) tokens.push(current)
  return tokens
}

/**
 * Parse a sed edit command and extract the edit information.
 * Returns null if the command is not a valid sed in-place edit.
 */
export function parseSedEditCommand(command: string): SedEditInfo | null {
  const trimmed = command.trim()

  // Must start with sed
  const sedMatch = trimmed.match(/^\s*sed\s+/)
  if (!sedMatch) return null

  const withoutSed = trimmed.slice(sedMatch[0].length)
  const tokens = simpleTokenize(withoutSed)

  // Parse flags and arguments
  let hasInPlaceFlag = false
  let extendedRegex = false
  let expression: string | null = null
  let filePath: string | null = null

  let i = 0
  while (i < tokens.length) {
    const arg = tokens[i]!

    // Handle -i flag (with or without backup suffix)
    if (arg === '-i' || arg === '--in-place') {
      hasInPlaceFlag = true
      i++
      if (i < tokens.length) {
        const nextArg = tokens[i]
        if (
          typeof nextArg === 'string' &&
          !nextArg.startsWith('-') &&
          (nextArg === '' || nextArg.startsWith('.'))
        ) {
          i++ // Skip the backup suffix
        }
      }
      continue
    }
    if (arg.startsWith('-i')) {
      hasInPlaceFlag = true
      i++
      continue
    }

    // Handle extended regex flags
    if (arg === '-E' || arg === '-r' || arg === '--regexp-extended') {
      extendedRegex = true
      i++
      continue
    }

    // Handle -e flag with expression
    if (arg === '-e' || arg === '--expression') {
      if (i + 1 < tokens.length) {
        if (expression !== null) return null // Only support single expression
        expression = tokens[i + 1]!
        i += 2
        continue
      }
      return null
    }
    if (arg.startsWith('--expression=')) {
      if (expression !== null) return null
      expression = arg.slice('--expression='.length)
      i++
      continue
    }

    // Skip other flags
    if (arg.startsWith('-')) {
      return null // Unknown flag - not safe to parse
    }

    // Non-flag argument
    if (expression === null) {
      // Strip surrounding quotes
      const clean = arg.replace(/^['"]|['"]$/g, '')
      expression = clean
    } else if (filePath === null) {
      filePath = arg
    } else {
      return null // More than one file - not supported
    }

    i++
  }

  // Must have -i flag, expression, and file path
  if (!hasInPlaceFlag || !expression || !filePath) {
    return null
  }

  // Parse the substitution expression: s/pattern/replacement/flags
  const substMatch = expression.match(/^s\//)
  if (!substMatch) {
    return null
  }

  const rest = expression.slice(2) // Skip 's/'

  // Find pattern and replacement by tracking escaped characters
  let pattern = ''
  let replacement = ''
  let flags = ''
  let state: 'pattern' | 'replacement' | 'flags' = 'pattern'
  let j = 0

  while (j < rest.length) {
    const char = rest[j]!

    if (char === '\\' && j + 1 < rest.length) {
      if (state === 'pattern') pattern += char + rest[j + 1]
      else if (state === 'replacement') replacement += char + rest[j + 1]
      else flags += char + rest[j + 1]
      j += 2
      continue
    }

    if (char === '/') {
      if (state === 'pattern') state = 'replacement'
      else if (state === 'replacement') state = 'flags'
      else return null // Extra delimiter in flags
      j++
      continue
    }

    if (state === 'pattern') pattern += char
    else if (state === 'replacement') replacement += char
    else flags += char
    j++
  }

  // Must have found all three parts
  if (state !== 'flags') return null

  // Validate flags - only allow safe substitution flags
  const validFlags = /^[gpimIM1-9]*$/
  if (!validFlags.test(flags)) return null

  return {
    filePath,
    pattern,
    replacement,
    flags,
    extendedRegex,
  }
}

/**
 * Apply a sed substitution to file content.
 * Returns the new content after applying the substitution.
 */
export function applySedSubstitution(
  content: string,
  sedInfo: SedEditInfo,
): string {
  // Convert sed pattern to JavaScript regex
  let regexFlags = ''

  if (sedInfo.flags.includes('g')) regexFlags += 'g'
  if (sedInfo.flags.includes('i') || sedInfo.flags.includes('I')) regexFlags += 'i'
  if (sedInfo.flags.includes('m') || sedInfo.flags.includes('M')) regexFlags += 'm'

  // Convert sed pattern to JavaScript regex pattern
  let jsPattern = sedInfo.pattern
    .replace(/\\\//g, '/') // Unescape \/ to /

  // In BRE mode (no -E flag), metacharacters have opposite escaping
  if (!sedInfo.extendedRegex) {
    jsPattern = jsPattern
      .replace(/\\\\/g, '\x00BS\x00') // Protect literal backslashes
      .replace(/\\\+/g, '\x00PL\x00')
      .replace(/\\\?/g, '\x00QU\x00')
      .replace(/\\\|/g, '\x00PI\x00')
      .replace(/\\\(/g, '\x00LP\x00')
      .replace(/\\\)/g, '\x00RP\x00')
      .replace(/\+/g, '\\+')
      .replace(/\?/g, '\\?')
      .replace(/\|/g, '\\|')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/\x00BS\x00/g, '\\\\')
      .replace(/\x00PL\x00/g, '+')
      .replace(/\x00QU\x00/g, '?')
      .replace(/\x00PI\x00/g, '|')
      .replace(/\x00LP\x00/g, '(')
      .replace(/\x00RP\x00/g, ')')
  }

  // Convert sed replacement to JS replacement
  const ESCAPED_AMP_PLACEHOLDER = '\x00EAMP\x00'
  const jsReplacement = sedInfo.replacement
    .replace(/\\\//g, '/')
    .replace(/\\&/g, ESCAPED_AMP_PLACEHOLDER)
    .replace(/&/g, '$$&')
    .replace(new RegExp(ESCAPED_AMP_PLACEHOLDER, 'g'), '&')

  try {
    const regex = new RegExp(jsPattern, regexFlags)
    return content.replace(regex, jsReplacement)
  } catch {
    return content
  }
}
