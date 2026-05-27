/**
 * ClaudeCode SDK — BashTool Security
 *
 * Command security checking, dangerous pattern detection,
 * and safety validation for bash commands.
 *
 * Adapted from the Claude Code reference implementation
 * with SDK-specific simplifications (no React/Bun dependencies).
 */
import { BASH_SECURITY_CHECK_IDS } from './types.js'
import type { SafetyResult, ValidationContext, QuoteExtraction } from './types.js'

// ─── Dangerous Patterns ──────────────────────────────────

const HEREDOC_IN_SUBSTITUTION = /\$\(.*<</

const COMMAND_SUBSTITUTION_PATTERNS = [
  { pattern: /<\(/, message: 'process substitution <()' },
  { pattern: />\(/, message: 'process substitution >()' },
  { pattern: /=\(/, message: 'Zsh process substitution =()' },
  {
    pattern: /(?:^|[\s;&|])=[a-zA-Z_]/,
    message: 'Zsh equals expansion (=cmd)',
  },
  { pattern: /\$\(/, message: '$() command substitution' },
  { pattern: /\$\{/, message: '${} parameter substitution' },
  { pattern: /\$\[/, message: '$[] legacy arithmetic expansion' },
  { pattern: /~\[/, message: 'Zsh-style parameter expansion' },
  { pattern: /\(e:/, message: 'Zsh-style glob qualifiers' },
  { pattern: /\(\+/, message: 'Zsh glob qualifier with command execution' },
  {
    pattern: /\}\s*always\s*\{/,
    message: 'Zsh always block (try/always construct)',
  },
  { pattern: /<#/, message: 'PowerShell comment syntax' },
]

const ZSH_DANGEROUS_COMMANDS = new Set([
  'zmodload',
  'emulate',
  'sysopen',
  'sysread',
  'syswrite',
  'sysseek',
  'zpty',
  'ztcp',
  'zsocket',
  'mapfile',
  'zf_rm',
  'zf_mv',
  'zf_ln',
  'zf_chmod',
  'zf_chown',
  'zf_mkdir',
  'zf_rmdir',
  'zf_chgrp',
])

const DANGEROUS_VARIABLES = new Set([
  'IFS', 'PS1', 'PS2', 'PS3', 'PS4',
  'PROMPT_COMMAND', 'BASH_ENV', 'ENV',
  'SHELLOPTS', 'BASHOPTS',
  'LD_PRELOAD', 'LD_LIBRARY_PATH',
  'PYTHONSTARTUP', 'PYTHONPATH',
])

const DANGEROUS_GIT_FLAGS = [
  '--author', '--committer', '--date',
  '--format', '--pretty', '--template',
  '--cleanup', '--message', '-m',
]

// ─── Quote Extraction ────────────────────────────────────

/**
 * Extract quoted content from a command string.
 * Returns three versions: withDoubleQuotes (strips single quotes only),
 * fullyUnquoted (strips both), and unquotedKeepQuoteChars (preserves quote chars).
 */
export function extractQuotedContent(command: string, _isJq = false): QuoteExtraction {
  let withDoubleQuotes = ''
  let fullyUnquoted = ''
  let unquotedKeepQuoteChars = ''
  let inSingleQuote = false
  let inDoubleQuote = false
  let escaped = false

  for (let i = 0; i < command.length; i++) {
    const char = command[i]!

    if (escaped) {
      escaped = false
      if (!inSingleQuote) withDoubleQuotes += char
      if (!inSingleQuote && !inDoubleQuote) {
        fullyUnquoted += char
        unquotedKeepQuoteChars += char
      }
      continue
    }

    if (char === '\\' && !inSingleQuote) {
      escaped = true
      if (!inSingleQuote) withDoubleQuotes += char
      if (!inSingleQuote && !inDoubleQuote) {
        fullyUnquoted += char
        unquotedKeepQuoteChars += char
      }
      continue
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      unquotedKeepQuoteChars += char
      continue
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      unquotedKeepQuoteChars += char
      continue
    }

    if (!inSingleQuote) withDoubleQuotes += char
    if (!inSingleQuote && !inDoubleQuote) {
      fullyUnquoted += char
      unquotedKeepQuoteChars += char
    }
  }

  return { withDoubleQuotes, fullyUnquoted, unquotedKeepQuoteChars }
}

// ─── Safe Redirections ───────────────────────────────────

/**
 * Strip safe redirections (2>&1, >/dev/null, </dev/null) from content.
 * Used to avoid false positives when checking for write operations.
 */
export function stripSafeRedirections(content: string): string {
  return content
    .replace(/\s+2\s*>&\s*1(?=\s|$)/g, '')
    .replace(/\s+[012]?\s*>\s*\/dev\/null(?=\s|$)/g, '')
    .replace(/\s*<\s*\/dev\/null(?=\s|$)/g, '')
}

// ─── Unescaped Character Detection ────────────────────────

/**
 * Check if content contains an unescaped occurrence of a single character.
 * Handles bash escape sequences where backslash escapes the following character.
 * Only handles single characters, not strings.
 */
export function containsUnescapedChar(content: string, char: string): boolean {
  let escaped = false
  for (let i = 0; i < content.length; i++) {
    if (escaped) {
      escaped = false
      continue
    }
    if (content[i] === '\\') {
      escaped = true
      continue
    }
    if (content[i] === char) {
      return true
    }
  }
  return false
}

// ─── Build Validation Context ────────────────────────────

/**
 * Build a validation context from a raw command string.
 * Extracts base command, quoted content, and various unquoted representations.
 */
export function buildValidationContext(command: string): ValidationContext {
  const trimmed = command.trim()
  const [baseCommand] = trimmed.split(/\s+/)
  const { withDoubleQuotes, fullyUnquoted, unquotedKeepQuoteChars } = extractQuotedContent(trimmed)
  const fullyUnquotedPreStrip = fullyUnquoted

  return {
    originalCommand: trimmed,
    baseCommand: baseCommand || '',
    unquotedContent: withDoubleQuotes,
    fullyUnquotedContent: stripSafeRedirections(fullyUnquoted),
    fullyUnquotedPreStrip,
    unquotedKeepQuoteChars,
  }
}

// ─── Individual Validators ────────────────────────────────

/**
 * Check if a command is incomplete (ends with an operator like |, &&, ||).
 */
export function validateIncompleteCommands(command: string): SafetyResult | null {
  const trimmed = command.trim()
  if (!trimmed) return null

  const incompletePatterns = [
    /\|\s*$/,
    /&&\s*$/,
    /\|\|\s*$/,
    /;\s*$/,
    /&\s*$/,
  ]

  for (const pattern of incompletePatterns) {
    if (pattern.test(trimmed)) {
      return {
        safe: false,
        message: 'Command appears to be incomplete (ends with an operator)',
        reason: 'incomplete_command',
      }
    }
  }

  return null
}

/**
 * Detect dangerous patterns like command substitution, process substitution.
 */
export function validateDangerousPatterns(command: string): SafetyResult {
  const context = buildValidationContext(command)

  // Check the fully unquoted content for patterns
  for (const { pattern, message } of COMMAND_SUBSTITUTION_PATTERNS) {
    if (pattern.test(context.fullyUnquotedContent)) {
      return {
        safe: false,
        message: `Command contains dangerous pattern: ${message}`,
        reason: 'dangerous_pattern',
      }
    }
  }

  return { safe: true }
}

/**
 * Detect jq @csv/@tsv and other system functions.
 */
export function validateJqSystemFunction(command: string): SafetyResult | null {
  // Only check jq commands
  if (!command.trim().startsWith('jq')) return null

  const jqSystemFunctions = /@(csv|tsv|text|json|html|uri|sh)/
  if (jqSystemFunctions.test(command)) {
    return {
      safe: false,
      message: 'jq command uses system-level output function that may execute code',
      reason: 'jq_system_function',
    }
  }

  return null
}

/**
 * Detect jq --arg and --rawfile arguments that read files.
 */
export function validateJqFileArguments(command: string): SafetyResult | null {
  if (!command.trim().startsWith('jq')) return null

  const jqFileArgs = /--(argfile|rawfile|slurpfile|rawfile)/
  if (jqFileArgs.test(command)) {
    return {
      safe: false,
      message: 'jq command reads files via --argfile/--rawfile which may expose sensitive data',
      reason: 'jq_file_arguments',
    }
  }

  return null
}

/**
 * Detect obfuscated flags that combine multiple short flags.
 */
export function validateObfuscatedFlags(command: string): SafetyResult | null {
  const flagPattern = /\s+-[a-zA-Z]{3,}\s/
  if (flagPattern.test(command)) {
    // Only flag as dangerous if combined flags look suspicious
    const combinedFlags = command.match(/\s+-[a-zA-Z]{4,}\s/g)
    if (combinedFlags) {
      return {
        safe: false,
        message: 'Command contains suspicious combined flags that may obfuscate intent',
        reason: 'obfuscated_flags',
      }
    }
  }
  return null
}

/**
 * Detect shell metacharacters like ;, & (background), and process substitution.
 */
export function validateShellMetacharacters(command: string): SafetyResult | null {
  const unquoted = extractQuotedContent(command).fullyUnquoted

  // Check for semicolons (must not be in quotes)
  if (containsUnescapedChar(unquoted, ';')) {
    return {
      safe: false,
      message: 'Command contains semicolons which may indicate multiple commands',
      reason: 'shell_metacharacters',
    }
  }

  // Check for background operators
  if (/(?<![\w&])&\s*(?:#|$)/.test(unquoted)) {
    return {
      safe: false,
      message: 'Command contains background operator (&)',
      reason: 'shell_metacharacters',
    }
  }

  return null
}

/**
 * Detect dangerous variable assignments.
 */
export function validateDangerousVariables(command: string): SafetyResult | null {
  const unquoted = extractQuotedContent(command).fullyUnquoted
  const varAssignPattern = /^([A-Z_][A-Z0-9_]*)=/

  for (const token of unquoted.split(/\s+/)) {
    const match = token.match(varAssignPattern)
    if (match && DANGEROUS_VARIABLES.has(match[1]!)) {
      return {
        safe: false,
        message: `Command modifies dangerous variable: ${match[1]}`,
        reason: 'dangerous_variable',
      }
    }
  }

  return null
}

/**
 * Detect newlines in commands (potential injection).
 */
export function validateNewlines(command: string): SafetyResult | null {
  if (command.includes('\n')) {
    return {
      safe: false,
      message: 'Command contains newlines which may indicate multi-line injection',
      reason: 'newlines_in_command',
    }
  }
  return null
}

/**
 * Detect control characters in commands.
 */
export function validateControlCharacters(command: string): SafetyResult | null {
  const controlCharPattern = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\t]/
  if (controlCharPattern.test(command)) {
    return {
      safe: false,
      message: 'Command contains control characters which may be used for injection',
      reason: 'control_characters',
    }
  }
  return null
}

/**
 * Detect unicode whitespace characters used to bypass tokenization.
 */
export function validateUnicodeWhitespace(command: string): SafetyResult | null {
  const unicodeWhitespace = /[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/
  if (unicodeWhitespace.test(command)) {
    return {
      safe: false,
      message: 'Command contains unicode whitespace characters which may bypass tokenization',
      reason: 'unicode_whitespace',
    }
  }
  return null
}

/**
 * Detect mid-word hash characters that could comment out rest of command.
 */
export function validateMidWordHash(command: string): SafetyResult | null {
  // A # that appears in the middle of a word could turn the rest into a comment
  const context = buildValidationContext(command)

  // Use unquotedKeepQuoteChars to avoid false negatives from quote stripping
  const midWordHash = /[a-zA-Z0-9_]#/
  if (midWordHash.test(context.unquotedKeepQuoteChars)) {
    return {
      safe: false,
      message: 'Command contains mid-word hash (#) which may comment out the rest',
      reason: 'mid_word_hash',
    }
  }

  return null
}

/**
 * Validate Zsh-specific dangerous commands.
 */
export function validateZshDangerousCommands(command: string): SafetyResult | null {
  const trimmed = command.trim()
  const firstWord = trimmed.split(/\s+/)[0]
  if (firstWord && ZSH_DANGEROUS_COMMANDS.has(firstWord)) {
    return {
      safe: false,
      message: `Command uses Zsh dangerous built-in: ${firstWord}`,
      reason: 'zsh_dangerous_command',
    }
  }
  return null
}

/**
 * Detect git commit substitution attacks.
 */
export function validateGitCommitSubstitution(command: string): SafetyResult | null {
  if (!command.includes('git commit')) return null

  for (const flag of DANGEROUS_GIT_FLAGS) {
    const flagIdx = command.indexOf(flag)
    if (flagIdx === -1) continue

    // Check if the flag value contains command substitution
    const valueStart = flagIdx + flag.length
    const restAfterFlag = command.slice(valueStart)

    // Skip whitespace and =
    const valueMatch = restAfterFlag.match(/^\s*[= ]\s*(.*)$/)
    if (!valueMatch) continue

    const value = valueMatch[1]!
    if (/\$\(/.test(value) || value.includes('`')) {
      return {
        safe: false,
        message: `Git commit command uses flag ${flag} with command substitution`,
        reason: 'git_commit_substitution',
      }
    }
  }

  return null
}

/**
 * Detect access to /proc/environ or similar sensitive files.
 */
export function validateProcEnvironAccess(command: string): SafetyResult | null {
  const unquoted = extractQuotedContent(command).fullyUnquoted
  if (/\/proc\/self\/environ/.test(unquoted) || /\/proc\/(\d+)\/environ/.test(unquoted)) {
    return {
      safe: false,
      message: 'Command accesses /proc/*/environ which may expose environment variables',
      reason: 'proc_environ_access',
    }
  }
  return null
}

/**
 * Detect backslash-escaped whitespace.
 */
export function validateBackslashEscapedWhitespace(command: string): SafetyResult | null {
  // Look for backslash followed by space/tab
  const backslashWhitespace = /\\[ \t]/
  if (backslashWhitespace.test(command)) {
    return {
      safe: false,
      message: 'Command contains backslash-escaped whitespace which may obfuscate tokens',
      reason: 'backslash_escaped_whitespace',
    }
  }
  return null
}

/**
 * Detect brace expansion that could affect many files.
 */
export function validateBraceExpansion(command: string): SafetyResult | null {
  // Detect brace expansion patterns like {a,b,c}
  const braceExpansion = /\{[^}]*,[^}]*\}/
  if (braceExpansion.test(command)) {
    return {
      safe: false,
      message: 'Command contains brace expansion which could expand to multiple arguments',
      reason: 'brace_expansion',
    }
  }
  return null
}

/**
 * Detect backslash-escaped operators.
 */
export function validateBackslashEscapedOperators(command: string): SafetyResult | null {
  const escapedOpPatterns = [
    /\\\|/,
    /\\&/,
    /\\;/,
    /\\</,
    /\\>/,
    /\\\(/,
    /\\\)/,
    /\\`/,
    /\\\$/,
  ]

  for (const pattern of escapedOpPatterns) {
    if (pattern.test(command)) {
      return {
        safe: false,
        message: 'Command contains backslash-escaped shell operators which may bypass parsing',
        reason: 'backslash_escaped_operators',
      }
    }
  }
  return null
}

/**
 * Detect comment/quote desynchronization.
 */
export function validateCommentQuoteDesync(command: string): SafetyResult | null {
  // Detect patterns where # appears inside or adjacent to quotes
  // that could cause the parser to misinterpret the command structure
  const unquoted = extractQuotedContent(command).unquotedKeepQuoteChars

  // Check for # immediately after a quote close
  if (/['"]#/.test(unquoted)) {
    // This could be benign: echo "x"# comment
    // But the # after a quote could also be malicious
    const suspicious = /['"]\s*#[^ \t\n]/
    if (suspicious.test(unquoted)) {
      return {
        safe: false,
        message: 'Command has suspicious quote-comment pattern that may desync parsing',
        reason: 'comment_quote_desync',
      }
    }
  }
  return null
}

/**
 * Detect newlines inside quoted strings.
 */
export function validateQuotedNewline(command: string): SafetyResult | null {
  // Check if there's a newline inside a quoted string
  let inSingleQuote = false
  let inDoubleQuote = false

  for (let i = 0; i < command.length; i++) {
    const char = command[i]!

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      continue
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      continue
    }
    if (char === '\\') {
      i++ // Skip escaped char
      continue
    }
    if ((inSingleQuote || inDoubleQuote) && (char === '\n' || char === '\r')) {
      return {
        safe: false,
        message: 'Command contains newline inside quoted string which may indicate injection',
        reason: 'quoted_newline',
      }
    }
  }

  return null
}

/**
 * Edge case: Path env var injection via PATH injection.
 */
export function validatePathInjection(command: string): SafetyResult | null {
  const trimmed = command.trim().toLowerCase()

  // Detect commands that might be hijacked via PATH
  const dangerousPrefixes = ['./', '.\\']

  for (const prefix of dangerousPrefixes) {
    if (trimmed.startsWith(prefix)) {
      return {
        safe: false,
        message: 'Command uses relative path which may be vulnerable to PATH injection',
        reason: 'path_injection',
      }
    }
  }
  return null
}

// ─── Main Entry Point ─────────────────────────────────────

/**
 * Run all security checks on a command and return the first failure.
 * Returns { safe: true } if all checks pass.
 */
export function bashCommandIsSafe(command: string): SafetyResult {
  const checkFns: Array<(cmd: string) => SafetyResult | null> = [
    validateIncompleteCommands,
    validateNewlines,
    validateControlCharacters,
    validateUnicodeWhitespace,
    validateDangerousPatterns,
    validateJqSystemFunction,
    validateJqFileArguments,
    validateShellMetacharacters,
    validateDangerousVariables,
    validateGitCommitSubstitution,
    validateProcEnvironAccess,
    validateMidWordHash,
    validateZshDangerousCommands,
    validateBraceExpansion,
    validateBackslashEscapedWhitespace,
    validateBackslashEscapedOperators,
    validateCommentQuoteDesync,
    validateQuotedNewline,
    validatePathInjection,
    validateObfuscatedFlags,
  ]

  for (const checkFn of checkFns) {
    const result = checkFn(command)
    if (result !== null && !result.safe) {
      return result
    }
  }

  return { safe: true }
}
