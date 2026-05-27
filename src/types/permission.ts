/**
 * ClaudeCode SDK — Permission Types
 */

export type PermissionMode = 'auto' | 'manual' | 'plan' | 'bypass'

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
