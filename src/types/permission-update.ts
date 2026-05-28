/**
 * ClaudeCode SDK — Permission Update Types
 *
 * Defines types for runtime permission rule updates,
 * allowing dynamic adjustment of permission rules during a session.
 *
 * Reference: claude-code-source-code/src/entrypoints/sdk/coreSchemas.ts L242-299
 *            claude-code-source-code/src/utils/permissions/PermissionUpdateSchema.ts
 */
import type { PermissionMode } from './permission.js'

// ============================================================================
// Permission Update Destination
// ============================================================================

/**
 * Where a new permission rule should be saved to.
 *
 * - userSettings: Global user-level settings
 * - projectSettings: Shared per-directory project settings
 * - localSettings: Git-ignored local settings
 * - session: In-memory for current session only
 * - cliArg: From command line arguments
 */
export type PermissionUpdateDestination = 'userSettings' | 'projectSettings' | 'localSettings' | 'session' | 'cliArg'

// ============================================================================
// Permission Behavior
// ============================================================================

export type PermissionBehavior = 'allow' | 'deny' | 'ask'

// ============================================================================
// Permission Rule Value
// ============================================================================

/**
 * A single permission rule targeting a specific tool.
 */
export interface PermissionRuleValue {
  /** The name of the tool this rule applies to */
  toolName: string
  /** Optional rule content (e.g., glob pattern for file operations) */
  ruleContent?: string
}

// ============================================================================
// Permission Update — Discriminated Union
// ============================================================================

export type PermissionUpdate =
  | PermissionAddRulesUpdate
  | PermissionReplaceRulesUpdate
  | PermissionRemoveRulesUpdate
  | PermissionSetModeUpdate
  | PermissionAddDirectoriesUpdate
  | PermissionRemoveDirectoriesUpdate

export interface PermissionAddRulesUpdate {
  type: 'addRules'
  /** The rules to add */
  rules: PermissionRuleValue[]
  /** The behavior (allow/deny/ask) for these rules */
  behavior: PermissionBehavior
  /** Where to save the rules */
  destination: PermissionUpdateDestination
}

export interface PermissionReplaceRulesUpdate {
  type: 'replaceRules'
  /** The rules that will replace ALL existing rules for this behavior+destination */
  rules: PermissionRuleValue[]
  /** The behavior (allow/deny/ask) for these rules */
  behavior: PermissionBehavior
  /** Where to save the rules */
  destination: PermissionUpdateDestination
}

export interface PermissionRemoveRulesUpdate {
  type: 'removeRules'
  /** The rules to remove */
  rules: PermissionRuleValue[]
  /** The behavior (allow/deny/ask) for the rules to remove */
  behavior: PermissionBehavior
  /** Where to remove the rules from */
  destination: PermissionUpdateDestination
}

export interface PermissionSetModeUpdate {
  type: 'setMode'
  /** The new permission mode */
  mode: PermissionMode
  /** Where to persist the mode change */
  destination: PermissionUpdateDestination
}

export interface PermissionAddDirectoriesUpdate {
  type: 'addDirectories'
  /** Directories to add to the working directories list */
  directories: string[]
  /** Where to persist the directory additions */
  destination: PermissionUpdateDestination
}

export interface PermissionRemoveDirectoriesUpdate {
  type: 'removeDirectories'
  /** Directories to remove from the working directories list */
  directories: string[]
  /** Where to persist the removals */
  destination: PermissionUpdateDestination
}
