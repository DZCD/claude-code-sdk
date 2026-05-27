/**
 * ClaudeCode SDK — Permission Types
 */

// ============================================================================
// Permission Modes
// ============================================================================

export type PermissionMode = 'auto' | 'manual' | 'plan' | 'bypass'

// ============================================================================
// Basic Permission Structures
// ============================================================================

export interface PermissionRequest {
  toolName: string
  input: Record<string, unknown>
  mode: PermissionMode
}

export type PermissionDecision =
  | { type: 'allow' }
  | { type: 'deny'; reason?: string }
  | { type: 'ask'; prompt: string }

export interface PermissionResult {
  decision: PermissionDecision
  updatedInput?: Record<string, unknown>
}

export interface PermissionRule {
  pattern: string
  behavior: 'allow' | 'deny' | 'ask'
  source: 'user' | 'project' | 'global'
}

// ============================================================================
// Bash Classifier Types
// ============================================================================

/**
 * Danger level for a bash command.
 * - safe: no risk, auto-allow in any mode (e.g., ls, echo "hello")
 * - auto_allow: low risk, auto-allow in auto/bypass mode (e.g., git status)
 * - ask: medium risk, prompt user (e.g., git push, apt install)
 * - deny: high risk, block (e.g., rm -rf /, sudo rm)
 */
export type BashCommandDangerLevel = 'safe' | 'auto_allow' | 'ask' | 'deny'

export interface ClassifierResult {
  dangerLevel: BashCommandDangerLevel
  reason: string
  matchedPattern?: string
}

// ============================================================================
// Dangerous Patterns Types
// ============================================================================

/**
 * A recognized dangerous shell pattern with metadata.
 */
export interface DangerousPattern {
  pattern: string
  description: string
  risk: 'high' | 'medium' | 'low'
}

// ============================================================================
// Path Validation Types
// ============================================================================

export type FileOperationType = 'read' | 'write' | 'create'

export interface PathValidationResult {
  allowed: boolean
  resolvedPath: string
  reason?: string
}

export interface PathValidationOptions {
  /** Allowed working directories (whitelist) */
  allowedDirectories: string[]
  /** Directories to deny even if they're within allowed directories */
  denyWithinAllow: string[]
  /** Whether to enable sensitive path protection */
  enableSensitivePathProtection?: boolean
  /** Additional sensitive path patterns to block */
  additionalSensitivePatterns?: string[]
}

// ============================================================================
// Plan Mode Types
// ============================================================================

export interface PlanModeConfig {
  /** Whether to auto-allow read-only tools in plan mode */
  allowReadOnlyTools: boolean
  /** Whether to allow file read operations in plan mode */
  allowFileReads: boolean
  /** Whether to allow glob/grep/search operations in plan mode */
  allowSearchOperations: boolean
}

export const DEFAULT_PLAN_MODE_CONFIG: PlanModeConfig = {
  allowReadOnlyTools: true,
  allowFileReads: true,
  allowSearchOperations: true,
}
