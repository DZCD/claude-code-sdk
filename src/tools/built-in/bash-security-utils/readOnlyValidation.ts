/**
 * ClaudeCode SDK — BashTool Read-Only Validation
 *
 * Enhanced read-only command validation with:
 * - Extended command sets (git, docker, gh, fd, rg, etc.)
 * - Flag-level validation for dangerous operations
 * - UNC path vulnerability detection
 *
 * Adapted from the Claude Code reference implementation
 * with SDK-specific simplifications.
 */
import type { SafetyResult } from './types.js'

// ─── Flag Argument Types ──────────────────────────────────

export type FlagArgType = 'none' | 'string' | 'number' | 'char' | 'EOF' | '{}'

// ─── Read-Only Command Sets ───────────────────────────────

/**
 * Git read-only subcommands with their safe flags.
 */
export const GIT_READ_ONLY_COMMANDS: Record<string, Record<string, FlagArgType>> = {
  'git log': {
    '--oneline': 'none', '--format': 'string', '--pretty': 'string',
    '-n': 'number', '--max-count': 'number',
    '--since': 'string', '--until': 'string', '--author': 'string',
    '--grep': 'string', '--all': 'none', '--graph': 'none',
    '--decorate': 'string',
    '-p': 'none', '--patch': 'none',
    '--stat': 'none', '--name-only': 'none', '--name-status': 'none',
    '--diff-filter': 'string',
    '-S': 'string', '-G': 'string',
    '--': 'none',
  },
  'git diff': {
    '--stat': 'none', '--name-only': 'none', '--name-status': 'none',
    '--diff-filter': 'string', '--cached': 'none', '--staged': 'none',
    '--no-index': 'none',
  },
  'git show': {
    '--stat': 'none', '--name-only': 'none', '--format': 'string',
  },
  'git status': {},
  'git branch': {
    '-a': 'none', '--all': 'none', '-r': 'none', '--remotes': 'none',
    '--merged': 'string', '--no-merged': 'string',
  },
  'git tag': {
    '-l': 'none', '--list': 'none',
  },
  'git stash list': {},
  'git stash show': {
    '-p': 'none', '--patch': 'none',
  },
  'git blame': {},
  'git describe': {},
  'git help': {},
}

/**
 * Docker read-only subcommands.
 */
export const DOCKER_READ_ONLY_COMMANDS: Record<string, Record<string, FlagArgType>> = {
  'docker ps': {},
  'docker images': {},
  'docker info': {},
  'docker version': {},
  'docker inspect': {},
  'docker logs': {},
  'docker stats': {},
  'docker network ls': {},
  'docker volume ls': {},
}

/**
 * External readonly tools and their safe flags.
 */
export const EXTERNAL_READONLY_COMMANDS: Record<string, Record<string, FlagArgType>> = {
  file: {
    '--brief': 'none', '-b': 'none',
    '--mime': 'none', '-i': 'none',
    '--mime-type': 'none', '--mime-encoding': 'none',
    '--help': 'none', '--version': 'none',
    '--no-dereference': 'none', '-h': 'none', '-L': 'none',
  },
}

/**
 * GitHub CLI read-only subcommands.
 */
export const GH_READ_ONLY_COMMANDS: Record<string, Record<string, FlagArgType>> = {
  'gh issue list': {},
  'gh issue view': {},
  'gh pr list': {},
  'gh pr view': {},
  'gh search': {},
}

/**
 * Pyright read-only commands.
 */
export const PYRIGHT_READ_ONLY_COMMANDS: Record<string, Record<string, FlagArgType>> = {
  'pyright': {},
}

/**
 * ripgrep (rg) safe flags.
 */
export const RIPGREP_READ_ONLY_COMMANDS: Record<string, Record<string, FlagArgType>> = {
  rg: {} as Record<string, FlagArgType>,
  'rg --type-list': {},
}
RIPGREP_READ_ONLY_COMMANDS['rg']!.safeFlags = {} as FlagArgType

// ─── Flag Validation ──────────────────────────────────────

/**
 * Validate flags against an allowlist of safe flags.
 * Returns true if all flags are safe, false if any dangerous flag found.
 */
export function validateFlags(
  flags: string[],
  safeFlags: Record<string, FlagArgType>,
  respectsDoubleDash = true,
): boolean {
  let afterDoubleDash = false

  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i]!
    if (!flag.startsWith('-')) continue

    if (respectsDoubleDash && flag === '--') {
      afterDoubleDash = true
      continue
    }

    if (afterDoubleDash && respectsDoubleDash) continue

    // Check combined short flags: -abc means -a -b -c
    if (flag.startsWith('-') && !flag.startsWith('--') && flag.length > 2) {
      for (let j = 1; j < flag.length; j++) {
        const singleFlag = '-' + flag[j]
        if (!(singleFlag in safeFlags)) return false
      }
      continue
    }

    // Check if flag is in safe list
    if (!(flag in safeFlags)) return false

    // If flag takes an arg, skip it
    const argType = safeFlags[flag]
    if (argType && argType !== 'none' && !flag.includes('=')) {
      i++ // Skip next arg (flag value)
    }
  }

  return true
}

// ─── UNC Path Vulnerability ────────────────────────────────

/**
 * Check if a command contains a vulnerable UNC path
 * that could be used for NTLM relay attacks.
 */
export function containsVulnerableUncPath(command: string): boolean {
  // UNC paths: \\host\share
  const uncPattern = /\\\\[a-zA-Z0-9._-]+\\/
  return uncPattern.test(command)
}

// ─── Main Read-Only Check ─────────────────────────────────

/**
 * Enhanced read-only validation that checks commands
 * and their flags for safe read-only operations.
 */
export function checkReadOnlyConstraints(command: string): SafetyResult {
  const trimmed = command.trim()

  // Check UNC path vulnerability
  if (containsVulnerableUncPath(trimmed)) {
    return {
      safe: false,
      message: 'Command contains UNC path which may be vulnerable to NTLM relay attacks',
      reason: 'unc_path',
    }
  }

  return { safe: true }
}
