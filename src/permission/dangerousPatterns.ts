/**
 * Dangerous shell command pattern detection.
 *
 * Phase 2-G: Identifies risky shell patterns that could be destructive
 * or used for privilege escalation.
 *
 * Reference: claude-code-source-code/src/utils/permissions/dangerousPatterns.ts
 * Adapted for SDK: cross-platform patterns only, no bun-specific features.
 */
import { homedir } from 'node:os'

// ============================================================================
// Cross-platform dangerous bash patterns
// ============================================================================

export const DANGEROUS_BASH_PATTERNS: readonly DangerousPatternDef[] = [
  // Filesystem destruction
  {
    pattern: /rm\s+(-rf|--recursive\s+--force|-fr)\s+\/?\*?$/,
    risk: 'high',
    description: 'Recursive force delete on system root',
  },
  {
    pattern: /rm\s+-rf\s+--no-preserve-root\s+\/?/,
    risk: 'high',
    description: 'Recursive force delete bypassing root protection',
  },
  {
    pattern: /rm\s+-rf\s+\/[*?{}\[\]]/,
    risk: 'high',
    description: 'Recursive force delete with shell expansion on root',
  },
  {
    pattern: /rm\s+-rf\s+\/\s*$/,
    risk: 'high',
    description: 'Recursive force delete on root directory',
  },

  // Disk operations
  {
    pattern: /dd\s+if=\/dev\/(zero|random|urandom)\s+of=\/dev\/(sd[a-z]|nvme\d|vd[a-z])/,
    risk: 'high',
    description: 'Direct disk overwrite with dd',
  },
  {
    pattern: /mkfs\.\w+\s+\/dev\//,
    risk: 'high',
    description: 'Filesystem creation on block device',
  },
  {
    pattern: /fdisk\s+\/dev\//,
    risk: 'high',
    description: 'Disk partition editing',
  },

  // Privilege escalation — curl|bash
  {
    pattern: /(curl|wget)\s+.*\|\s*(sudo\s+)?(bash|sh|zsh|ksh)\b/,
    risk: 'high',
    description: 'Remote script pipe to shell (curl|bash)',
  },
  {
    pattern: /(curl|wget)\s+.*\|\s*(sudo\s+)?(bash|sh|zsh|ksh)\s/,
    risk: 'high',
    description: 'Remote script pipe to shell with args',
  },

  // Shell injection via eval
  {
    pattern: /eval\s+["'].*\$\(/,
    risk: 'high',
    description: 'Eval with command substitution',
  },
  {
    pattern: /eval\s+["'].*`/,
    risk: 'high',
    description: 'Eval with backtick substitution',
  },

  // Permission changes on system paths
  {
    pattern: /chmod\s+-R\s+777\s+\//,
    risk: 'high',
    description: 'Recursive world-writable on root',
  },
  {
    pattern: /chmod\s+-R\s+777\s+\/etc/,
    risk: 'high',
    description: 'Recursive world-writable on /etc',
  },
  {
    pattern: /chmod\s+-R\s+777\s+\/usr/,
    risk: 'high',
    description: 'Recursive world-writable on /usr',
  },

  // Ownership changes
  {
    pattern: /chown\s+-R\s+\w+:\w+\s+\//,
    risk: 'high',
    description: 'Recursive ownership change on root',
  },

  // Passwd/shadow operations
  { pattern: /passwd\s+\w+/, risk: 'medium', description: 'Password change' },
  {
    pattern: /chpasswd\b/,
    risk: 'medium',
    description: 'Batch password change',
  },
  { pattern: /useradd\s+\w+/, risk: 'medium', description: 'User creation' },
  { pattern: /usermod\s+/, risk: 'medium', description: 'User modification' },

  // sudo operations (general pattern - captured by classifier but noted here)
  {
    pattern: /sudo\s+rm\s+/,
    risk: 'high',
    description: 'Sudo recursive delete',
  },
  {
    pattern: /sudo\s+!!/,
    risk: 'high',
    description: 'Sudo re-run last command as root',
  },
]

// ============================================================================
// Type definitions
// ============================================================================

export interface DangerousPatternDef {
  pattern: RegExp
  risk: 'high' | 'medium' | 'low'
  description: string
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Returns the list of all dangerous bash patterns with metadata.
 */
export function getDangerousPatterns(): DangerousPatternDef[] {
  return [...DANGEROUS_BASH_PATTERNS]
}

/**
 * Check if a bash command matches any dangerous pattern.
 * Returns true if the command is considered dangerous.
 */
export function isDangerousBashCommand(command: string): boolean {
  const trimmed = command.trim()
  if (!trimmed) return false

  return DANGEROUS_BASH_PATTERNS.some(({ pattern }) => pattern.test(trimmed))
}

/**
 * Get the risk level and matched pattern for a command.
 * Returns null if no dangerous pattern matches.
 */
export function getCommandRiskLevel(command: string): {
  risk: 'high' | 'medium' | 'low'
  pattern: RegExp
  description: string
} | null {
  const trimmed = command.trim()
  if (!trimmed) return null

  for (const def of DANGEROUS_BASH_PATTERNS) {
    if (def.pattern.test(trimmed)) {
      return {
        risk: def.risk,
        pattern: def.pattern,
        description: def.description,
      }
    }
  }

  return null
}

/**
 * Check if a resolved path is dangerous for removal operations.
 * Based on reference: pathValidation.ts isDangerousRemovalPath
 *
 * Dangerous paths:
 * - Wildcard '*' (removes all files in directory)
 * - Any path ending with '/*' or '\*'
 * - Root directory (/)
 * - Home directory (~ or $HOME)
 * - Direct children of root (/usr, /tmp, /etc, etc.)
 * - Windows drive root (C:\, D:\) and direct children (C:\Windows, C:\Users)
 */
export function isDangerousRemovalPath(resolvedPath: string): boolean {
  const forwardSlashed = resolvedPath.replace(/[\\/]+/g, '/')

  if (forwardSlashed === '*' || forwardSlashed.endsWith('/*')) {
    return true
  }

  const normalizedPath = forwardSlashed === '/' ? forwardSlashed : forwardSlashed.replace(/\/$/, '')

  if (normalizedPath === '/') {
    return true
  }

  const WINDOWS_DRIVE_ROOT_REGEX = /^[A-Za-z]:\/?$/
  if (WINDOWS_DRIVE_ROOT_REGEX.test(normalizedPath)) {
    return true
  }

  const normalizedHome = homedir().replace(/[\\/]+/g, '/')
  if (normalizedPath === normalizedHome) {
    return true
  }

  // Direct children of root
  const parentDir = forwardSlashed.substring(0, forwardSlashed.lastIndexOf('/'))
  if (parentDir === '' || parentDir === '/') {
    // Path is a direct child of root
    return forwardSlashed !== normalizedHome
  }

  // Windows drive children: C:\Windows, C:\Users
  const WINDOWS_DRIVE_CHILD_REGEX = /^[A-Za-z]:\/[^/]+$/
  if (WINDOWS_DRIVE_CHILD_REGEX.test(normalizedPath)) {
    return true
  }

  return false
}
