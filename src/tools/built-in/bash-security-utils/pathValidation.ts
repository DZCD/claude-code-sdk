/**
 * ClaudeCode SDK — BashTool Path Validation
 *
 * Path extraction and validation for bash commands.
 * Extracts file/directory paths from ~50 common bash commands
 * and checks for dangerous operations.
 *
 * Adapted from the Claude Code reference implementation
 * with SDK-specific simplifications.
 */
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import type { PathCommand, PermissionResult, SafetyResult } from './types.js'

// ─── Helper: Filter Flags ─────────────────────────────────

/**
 * Filter out flags (args starting with "-") from an argument list.
 * Correctly handles the POSIX `--` end-of-options delimiter.
 * After `--`, all subsequent args are treated as positional.
 */
export function filterOutFlags(args: string[]): string[] {
  const result: string[] = []
  let afterDoubleDash = false
  for (const arg of args) {
    if (afterDoubleDash) {
      result.push(arg)
    } else if (arg === '--') {
      afterDoubleDash = true
    } else if (!arg?.startsWith('-')) {
      result.push(arg)
    }
  }
  return result
}

// ─── Tilde Expansion ───────────────────────────────────────

/**
 * Expand tilde (~) at the start of a path to home directory.
 * ~username expansion is not supported for security reasons.
 */
export function expandTilde(path: string): string {
  if (path === '~' || path.startsWith('~/') || (process.platform === 'win32' && path.startsWith('~\\'))) {
    return homedir() + path.slice(1)
  }
  return path
}

// ─── Glob Base Directory ──────────────────────────────────

const GLOB_PATTERN_REGEX = /[*?[\]{}]/

/**
 * Extract the base directory from a glob pattern.
 * e.g., "/path/to/*.txt" → "/path/to"
 */
export function getGlobBaseDirectory(path: string): string {
  const globMatch = path.match(GLOB_PATTERN_REGEX)
  if (!globMatch || globMatch.index === undefined) {
    return path
  }

  const beforeGlob = path.substring(0, globMatch.index)
  const lastSepIndex = beforeGlob.lastIndexOf('/')
  if (lastSepIndex === -1) return '.'

  return beforeGlob.substring(0, lastSepIndex) || '/'
}

// ─── Dangerous Paths ──────────────────────────────────────

const DANGEROUS_REMOVAL_PATHS = new Set([
  '/',
  '/etc',
  '/bin',
  '/sbin',
  '/usr',
  '/usr/bin',
  '/usr/sbin',
  '/usr/local',
  '/usr/local/bin',
  '/usr/local/sbin',
  '/lib',
  '/lib64',
  '/System',
  '/System/Library',
  '/Applications',
  '/Library',
  '/boot',
  '/dev',
  '/proc',
  '/sys',
  '/mnt',
  '/media',
  '/opt',
  '/root',
  '/run',
  '/snap',
  '/var',
  '/var/log',
  '/var/lib',
  '/var/www',
])

/**
 * Check if a path is a dangerous removal target.
 * Paths like /, /etc, /usr that should always require human approval.
 */
export function isDangerousRemovalPath(absolutePath: string): boolean {
  // Normalize the path
  const normalized = resolve(absolutePath)

  // Check exact matches and direct children of dangerous paths
  if (DANGEROUS_REMOVAL_PATHS.has(normalized)) {
    return true
  }

  // Check parent paths
  for (const dangerous of DANGEROUS_REMOVAL_PATHS) {
    if (normalized.startsWith(`${dangerous}/`) || normalized === dangerous) {
      return true
    }
  }

  return false
}

// ─── Path Extraction ──────────────────────────────────────

/**
 * Parse a pattern command (grep/rg style) to extract file paths.
 * Pattern first, then file paths.
 */
function parsePatternCommand(args: string[], flagsWithArgs: Set<string>, defaults: string[] = []): string[] {
  const paths: string[] = []
  let patternFound = false
  let afterDoubleDash = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === undefined || arg === null) continue

    if (!afterDoubleDash && arg === '--') {
      afterDoubleDash = true
      continue
    }

    if (!afterDoubleDash && arg.startsWith('-')) {
      const flag = arg.split('=')[0]
      if (flag && ['-e', '--regexp', '-f', '--file'].includes(flag)) {
        patternFound = true
      }
      if (flag && flagsWithArgs.has(flag) && !arg.includes('=')) {
        i++
      }
      continue
    }

    if (!patternFound) {
      patternFound = true
      continue
    }
    paths.push(arg)
  }

  return paths.length > 0 ? paths : defaults
}

// ─── Path Extractors ──────────────────────────────────────

export const PATH_EXTRACTORS: Record<string, (args: string[]) => string[]> = {
  cd: (args) => (args.length === 0 ? [homedir()] : [args.join(' ')]),

  ls: (args) => {
    const paths = filterOutFlags(args)
    return paths.length > 0 ? paths : ['.']
  },

  find: (args) => {
    const paths = filterOutFlags(args)
    return paths.length > 0 ? paths : ['.']
  },

  mkdir: (args) => filterOutFlags(args),

  touch: (args) => filterOutFlags(args),

  rm: (args) => filterOutFlags(args),

  rmdir: (args) => filterOutFlags(args),

  mv: (args) => filterOutFlags(args),

  cp: (args) => filterOutFlags(args),

  cat: (args) => filterOutFlags(args),

  head: (args) => filterOutFlags(args),

  tail: (args) => filterOutFlags(args),

  sort: (args) => {
    const flagsWithArgs = new Set(['-o', '--output', '-T', '--temporary-directory'])
    return parsePatternCommand(args, flagsWithArgs, [])
  },

  uniq: (args) => {
    const flagsWithArgs = new Set(['-o', '--output'])
    return parsePatternCommand(args, flagsWithArgs, [])
  },

  wc: (args) => filterOutFlags(args),

  cut: (args) => filterOutFlags(args),

  paste: (args) => filterOutFlags(args),

  column: (args) => {
    const flagsWithArgs = new Set(['-o', '--output-separator', '-s', '--separator'])
    return parsePatternCommand(args, flagsWithArgs, [])
  },

  tr: () => [],

  file: (args) => filterOutFlags(args),

  stat: (args) => filterOutFlags(args),

  diff: (args) => filterOutFlags(args),

  awk: () => [],

  strings: (args) => filterOutFlags(args),

  hexdump: (args) => filterOutFlags(args),

  od: (args) => filterOutFlags(args),

  base64: (args) => filterOutFlags(args),

  nl: (args) => filterOutFlags(args),

  grep: (args) => {
    const flagsWithArgs = new Set([
      '-d',
      '--directories',
      '-D',
      '--devices',
      '-f',
      '--file',
      '--include',
      '--exclude',
      '--exclude-dir',
      '--exclude-from',
    ])
    return parsePatternCommand(args, flagsWithArgs)
  },

  rg: (args) => {
    const flagsWithArgs = new Set(['-g', '--glob', '--type', '-t', '--file', '-f', '--path-separator'])
    return parsePatternCommand(args, flagsWithArgs)
  },

  sed: (args) => {
    const flagsWithArgs = new Set<string>([])
    return parsePatternCommand(args, flagsWithArgs)
  },

  git: (args) => {
    if (args.length === 0) return ['.']
    const subcmd = args[0]!

    // Git read-only subcommands
    const readOnlySubcommands = new Set([
      'status',
      'log',
      'diff',
      'show',
      'branch',
      'tag',
      'stash',
      'blame',
      'describe',
      'help',
    ])

    if (readOnlySubcommands.has(subcmd)) {
      return ['.']
    }

    // Git subcommands with file args
    const fileSubcommands = new Set(['add', 'checkout', 'restore', 'reset', 'commit', 'rm', 'mv'])

    if (fileSubcommands.has(subcmd)) {
      // Skip subcommand name
      const fileArgs = args.slice(1)
      const pathFlags = new Set<string>()
      return parsePatternCommand(fileArgs, pathFlags)
    }

    return ['.']
  },

  jq: () => [],

  sha256sum: (args) => filterOutFlags(args),
  sha1sum: (args) => filterOutFlags(args),
  md5sum: (args) => filterOutFlags(args),
}

// ─── Check Dangerous Removals ─────────────────────────────

/**
 * Check if an rm/rmdir command targets dangerous paths.
 * Returns a PermissionResult with behavior 'ask' if dangerous.
 */
export function checkDangerousRemovalPaths(
  command: 'rm' | 'rmdir',
  args: string[],
  cwd: string,
): PermissionResult | null {
  const extractor = PATH_EXTRACTORS[command]
  if (!extractor) return null

  const paths = extractor(args)

  for (const path of paths) {
    const cleanPath = expandTilde(path.replace(/^['"]|['"]$/g, ''))
    const absolutePath = isAbsolute(cleanPath) ? cleanPath : resolve(cwd, cleanPath)

    if (isDangerousRemovalPath(absolutePath)) {
      return {
        behavior: 'ask',
        message: `Dangerous ${command} operation detected: '${absolutePath}'.\nThis command would remove a critical system directory and requires explicit approval.`,
        decisionReason: {
          type: 'other',
          reason: `Dangerous ${command} operation on critical path: ${absolutePath}`,
        },
        suggestions: [],
      }
    }
  }

  return null
}

// ─── Extract Paths from Command (High-Level) ─────────────

/**
 * Extract file/directory paths from a command string.
 * Works with the ~50 most common path-aware commands.
 */
export function extractPathsFromCommand(command: string): string[] {
  const trimmed = command.trim()
  const parts = trimmed.split(/\s+/)
  const cmdName = parts[0]

  if (!cmdName) return []

  const extractor = PATH_EXTRACTORS[cmdName]
  if (!extractor) return []

  const args = parts.slice(1)
  return extractor(args)
}
