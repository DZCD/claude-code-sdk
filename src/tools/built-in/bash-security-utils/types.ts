/**
 * ClaudeCode SDK — BashTool Security Type Definitions
 *
 * Core types for the BashTool security layer, adapted from
 * the Claude Code reference implementation with SDK-specific
 * simplifications.
 */
import type { z } from 'zod'

// ─── Permission Modes ─────────────────────────────────────

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk'

// ─── Permission Behaviors ─────────────────────────────────

export type PermissionBehavior = 'allow' | 'deny' | 'ask' | 'passthrough'

// ─── Permission Decision Reasons ──────────────────────────

export type PermissionDecisionReason =
  | { type: 'mode'; mode: PermissionMode }
  | { type: 'rule'; rule: string }
  | { type: 'safetyCheck'; reason: string }
  | { type: 'other'; reason: string }

// ─── Permission Result ────────────────────────────────────

/**
 * Result of a permission check.
 * - 'allow': Command is allowed (possibly with updated input)
 * - 'deny': Command is denied
 * - 'ask': User needs to be prompted
 * - 'passthrough': No applicable rule, pass to next check
 */
export type PermissionResult = {
  behavior: PermissionBehavior
  message: string
  updatedInput?: { command: string }
  decisionReason?: PermissionDecisionReason
  suggestions?: string[]
}

// ─── Permission Context ───────────────────────────────────

/**
 * Context for permission checking.
 * Provides mode, rules, and directory boundaries.
 */
export interface PermissionContext {
  mode: PermissionMode
  allowedDirectories: string[]
  deniedDirectories: string[]
  allowRules: string[]
  denyRules: string[]
}

// ─── Safety Result ────────────────────────────────────────

export interface SafetyResult {
  safe: boolean
  message?: string
  reason?: string
}

// ─── Security Check Results ───────────────────────────────

/**
 * Identifiers for bash security checks (avoids logging raw strings).
 */
export const BASH_SECURITY_CHECK_IDS = {
  INCOMPLETE_COMMANDS: 1,
  JQ_SYSTEM_FUNCTION: 2,
  JQ_FILE_ARGUMENTS: 3,
  OBFUSCATED_FLAGS: 4,
  SHELL_METACHARACTERS: 5,
  DANGEROUS_VARIABLES: 6,
  NEWLINES: 7,
  DANGEROUS_PATTERNS_COMMAND_SUBSTITUTION: 8,
  DANGEROUS_PATTERNS_INPUT_REDIRECTION: 9,
  DANGEROUS_PATTERNS_OUTPUT_REDIRECTION: 10,
  IFS_INJECTION: 11,
  GIT_COMMIT_SUBSTITUTION: 12,
  PROC_ENVIRON_ACCESS: 13,
  MALFORMED_TOKEN_INJECTION: 14,
  BACKSLASH_ESCAPED_WHITESPACE: 15,
  BRACE_EXPANSION: 16,
  CONTROL_CHARACTERS: 17,
  UNICODE_WHITESPACE: 18,
  MID_WORD_HASH: 19,
  ZSH_DANGEROUS_COMMANDS: 20,
  BACKSLASH_ESCAPED_OPERATORS: 21,
  COMMENT_QUOTE_DESYNC: 22,
  QUOTED_NEWLINE: 23,
} as const

// ─── Validation Context ───────────────────────────────────

export interface ValidationContext {
  originalCommand: string
  baseCommand: string
  unquotedContent: string
  fullyUnquotedContent: string
  fullyUnquotedPreStrip: string
  unquotedKeepQuoteChars: string
}

// ─── Quote Extraction ─────────────────────────────────────

export interface QuoteExtraction {
  withDoubleQuotes: string
  fullyUnquoted: string
  unquotedKeepQuoteChars: string
}

// ─── Path Command Type ────────────────────────────────────

export type PathCommand =
  | 'cd' | 'ls' | 'find' | 'mkdir' | 'touch'
  | 'rm' | 'rmdir' | 'mv' | 'cp'
  | 'cat' | 'head' | 'tail' | 'sort' | 'uniq'
  | 'wc' | 'cut' | 'paste' | 'column' | 'tr'
  | 'file' | 'stat' | 'diff'
  | 'awk' | 'strings' | 'hexdump' | 'od'
  | 'base64' | 'nl'
  | 'grep' | 'rg' | 'sed'
  | 'git' | 'jq'
  | 'sha256sum' | 'sha1sum' | 'md5sum'

// ─── Sed Edit Info ────────────────────────────────────────

export interface SedEditInfo {
  filePath: string
  pattern: string
  replacement: string
  flags: string
  extendedRegex: boolean
}
