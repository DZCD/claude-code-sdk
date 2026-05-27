/**
 * Path validation rules for permission checking.
 *
 * Phase 2-G: Implements sandbox constraints, directory whitelists,
 * sensitive path protection, and glob pattern validation.
 *
 * Reference: claude-code-source-code/src/utils/permissions/pathValidation.ts
 * SDK adaptation: simplified for library use, no sandbox manager dependency.
 */
import { homedir } from 'node:os'
import { dirname, isAbsolute, resolve } from 'node:path'
import type { FileOperationType, PathValidationOptions, PathValidationResult } from '../types/permission.js'

// ============================================================================
// Constants
// ============================================================================

const GLOB_PATTERN_REGEX = /[*?[\]{}]/
const MAX_DIRS_TO_LIST = 5

// ============================================================================
// Sensitive path definitions
// ============================================================================

export interface SensitivePathDef {
  pattern: string
  description: string
  isPrefix: boolean
}

/**
 * Paths that are considered sensitive and should be blocked/require confirmation.
 * Used when enableSensitivePathProtection is true.
 */
export const SENSITIVE_PATHS: SensitivePathDef[] = [
  // Shell configuration files
  {
    pattern: '.ssh',
    description: 'SSH configuration and keys',
    isPrefix: true,
  },
  { pattern: '.gnupg', description: 'GPG keys', isPrefix: true },
  { pattern: '.aws', description: 'AWS credentials', isPrefix: true },
  { pattern: '.azure', description: 'Azure credentials', isPrefix: true },
  {
    pattern: '.gcloud',
    description: 'Google Cloud credentials',
    isPrefix: true,
  },
  {
    pattern: '.config/gcloud',
    description: 'Google Cloud config',
    isPrefix: true,
  },
  {
    pattern: '.docker/config.json',
    description: 'Docker credentials',
    isPrefix: false,
  },
  { pattern: '.npmrc', description: 'NPM credentials/tokens', isPrefix: false },
  { pattern: '.npm/_cacache', description: 'NPM cache', isPrefix: true },
  { pattern: '.yarnrc', description: 'Yarn credentials', isPrefix: false },
  { pattern: '.yarnrc.yml', description: 'Yarn credentials', isPrefix: false },

  // Environment / secrets
  { pattern: '.env', description: 'Environment variables', isPrefix: false },
  {
    pattern: '.env.local',
    description: 'Local environment variables',
    isPrefix: false,
  },
  {
    pattern: '.env.production',
    description: 'Production env variables',
    isPrefix: false,
  },
  {
    pattern: '.env.development',
    description: 'Development env variables',
    isPrefix: false,
  },
  { pattern: '.env.test', description: 'Test env variables', isPrefix: false },
  {
    pattern: '.env.staging',
    description: 'Staging env variables',
    isPrefix: false,
  },

  // Git
  { pattern: '.git', description: 'Git directory', isPrefix: true },

  // Claude configuration
  { pattern: '.claude', description: 'Claude config', isPrefix: true },

  // IDE/Editor config (sensitive)
  {
    pattern: '.vscode/settings.json',
    description: 'VS Code settings',
    isPrefix: false,
  },

  // Package config with credentials
  { pattern: '.pypirc', description: 'PyPI credentials', isPrefix: false },
  {
    pattern: '.gem/credentials',
    description: 'RubyGem credentials',
    isPrefix: false,
  },
  { pattern: '.netrc', description: 'Netrc credentials', isPrefix: false },

  // Kubernetes
  {
    pattern: '.kube/config',
    description: 'Kubernetes config',
    isPrefix: false,
  },

  // History files
  { pattern: '.bash_history', description: 'Bash history', isPrefix: false },
  { pattern: '.zsh_history', description: 'Zsh history', isPrefix: false },
  {
    pattern: '.python_history',
    description: 'Python history',
    isPrefix: false,
  },
  {
    pattern: '.node_repl_history',
    description: 'Node REPL history',
    isPrefix: false,
  },
]

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Expand tilde (~) at the start of a path to the user's home directory.
 */
export function expandTilde(path: string): string {
  if (path === '~' || path.startsWith('~/') || (process.platform === 'win32' && path.startsWith('~\\'))) {
    return homedir() + path.slice(1)
  }
  return path
}

/**
 * Extracts the base directory from a glob pattern for validation.
 * For example: "/path/to/*.txt" returns "/path/to"
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

/**
 * Check if a resolved path matches any sensitive path pattern.
 */
export function matchesSensitivePath(resolvedPath: string): boolean {
  // Normalize path separators
  const normalized = resolvedPath.replace(/\\/g, '/')

  for (const sensitive of SENSITIVE_PATHS) {
    const pattern = sensitive.pattern.replace(/\\/g, '/')
    if (sensitive.isPrefix) {
      // Check if the path contains the sensitive directory/prefix
      if (normalized.includes(`/${pattern}/`) || normalized.endsWith(`/${pattern}`)) {
        return true
      }
    } else {
      // Exact filename match
      if (normalized.endsWith(`/${pattern}`) || normalized === pattern) {
        return true
      }
    }
  }

  return false
}

/**
 * Check if a path is in one of the allowed directories.
 * Considers denyWithinAllow as exceptions.
 */
export function isPathInAllowedDirectory(resolvedPath: string, options: PathValidationOptions): boolean {
  const normalized = resolvedPath.replace(/\\/g, '/')

  // Check denyWithinAllow first (higher priority)
  for (const denyPath of options.denyWithinAllow) {
    const normalizedDeny = denyPath.replace(/\\/g, '/')
    if (normalized.startsWith(normalizedDeny) || normalizedDeny.startsWith(normalized)) {
      return false
    }
  }

  // Check allowed directories
  for (const dir of options.allowedDirectories) {
    const normalizedDir = dir.replace(/\\/g, '/')
    if (
      normalized === normalizedDir ||
      normalized.startsWith(`${normalizedDir}/`) ||
      normalized.startsWith(`${normalizedDir}\\`)
    ) {
      return true
    }
  }

  return false
}

// ============================================================================
// Core validation functions
// ============================================================================

/**
 * Low-level path permission check.
 * Determines if a resolved path is allowed for the given operation type.
 */
export function isPathAllowed(
  resolvedPath: string,
  options: PathValidationOptions,
  operationType: FileOperationType,
): { allowed: boolean; reason?: string } {
  // 1. Check sensitive path protection
  if (options.enableSensitivePathProtection !== false) {
    if (matchesSensitivePath(resolvedPath)) {
      return {
        allowed: false,
        reason: 'Path matches sensitive path pattern',
      }
    }
  }

  // 2. Check if path is in allowed directories
  if (!isPathInAllowedDirectory(resolvedPath, options)) {
    return {
      allowed: false,
      reason: 'Path is outside allowed directories',
    }
  }

  return { allowed: true }
}

/**
 * Full path validation with tilde expansion, shell syntax checks,
 * glob pattern handling, and permission checking.
 *
 * @param path - The path to validate (can be relative or absolute)
 * @param cwd - Current working directory for resolving relative paths
 * @param options - Path validation options
 * @param operationType - The type of file operation
 * @returns PathValidationResult with allowed status and resolved path
 */
export function validatePath(
  path: string,
  cwd: string,
  options: PathValidationOptions,
  operationType: FileOperationType,
): PathValidationResult {
  // Remove surrounding quotes if present
  let cleanPath = path.replace(/^['"]|['"]$/g, '')

  // Expand tilde
  cleanPath = expandTilde(cleanPath)

  // SECURITY: Reject tilde variants (~user, ~+, ~-, ~N) that expandTilde doesn't handle.
  if (cleanPath.startsWith('~') && cleanPath !== homedir()) {
    // Check if it's just the home dir (already expanded starting with /)
    if (cleanPath.startsWith('/')) {
      // Already absolute, proceed
    } else {
      return {
        allowed: false,
        resolvedPath: cleanPath,
        reason: 'Tilde expansion variants (~user, ~+, ~-) in paths require manual approval',
      }
    }
  }

  // SECURITY: Block shell expansion syntax
  if (cleanPath.includes('$') || cleanPath.includes('%') || cleanPath.startsWith('=')) {
    return {
      allowed: false,
      resolvedPath: cleanPath,
      reason: 'Shell expansion syntax in paths requires manual approval',
    }
  }

  // Handle glob patterns
  if (GLOB_PATTERN_REGEX.test(cleanPath)) {
    if (operationType === 'write' || operationType === 'create') {
      return {
        allowed: false,
        resolvedPath: cleanPath,
        reason: 'Glob patterns are not allowed in write operations. Please specify an exact file path.',
      }
    }

    // For read operations, validate the base directory
    const basePath = getGlobBaseDirectory(cleanPath)
    const absoluteBasePath = isAbsolute(basePath) ? basePath : resolve(cwd, basePath)
    const resolvedBasePath = absoluteBasePath

    const result = isPathAllowed(resolvedBasePath, options, operationType)
    return {
      allowed: result.allowed,
      resolvedPath: cleanPath,
      reason: result.reason,
    }
  }

  // Resolve path
  const absolutePath = isAbsolute(cleanPath) ? cleanPath : resolve(cwd, cleanPath)

  const result = isPathAllowed(absolutePath, options, operationType)
  return {
    allowed: result.allowed,
    resolvedPath: absolutePath,
    reason: result.reason,
  }
}

/**
 * Check if a resolved path is dangerous for removal operations (rm/rmdir).
 * Re-exported from dangerousPatterns for convenience.
 */
export { isDangerousRemovalPath } from './dangerousPatterns.js'
