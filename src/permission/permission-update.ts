/**
 * ClaudeCode SDK — Permission Update Module
 *
 * Zod schemas and runtime functions for validation and application
 * of permission updates at runtime. Supports dynamic permission rule
 * management: addRules, replaceRules, removeRules, setMode,
 * addDirectories, removeDirectories.
 *
 * Reference: claude-code-source-code/src/utils/permissions/PermissionUpdateSchema.ts
 *            claude-code-source-code/src/utils/permissions/PermissionUpdate.ts
 */
import { z } from 'zod'
import type {
  PermissionBehavior,
  PermissionRuleValue,
  PermissionUpdate,
  PermissionUpdateDestination,
} from '../types/permission-update.js'
import type { PermissionMode } from '../types/permission.js'

// ============================================================================
// Zod Schemas
// ============================================================================

export const permissionUpdateDestinationSchema = z.enum([
  'userSettings',
  'projectSettings',
  'localSettings',
  'session',
  'cliArg',
])

export const permissionBehaviorSchema = z.enum(['allow', 'deny', 'ask'])

export const permissionRuleValueSchema = z.object({
  toolName: z.string(),
  ruleContent: z.string().optional(),
})

export const permissionModeSchema = z.enum(['auto', 'manual', 'plan', 'bypass'])

export const permissionUpdateSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('addRules'),
    rules: z.array(permissionRuleValueSchema),
    behavior: permissionBehaviorSchema,
    destination: permissionUpdateDestinationSchema,
  }),
  z.object({
    type: z.literal('replaceRules'),
    rules: z.array(permissionRuleValueSchema),
    behavior: permissionBehaviorSchema,
    destination: permissionUpdateDestinationSchema,
  }),
  z.object({
    type: z.literal('removeRules'),
    rules: z.array(permissionRuleValueSchema),
    behavior: permissionBehaviorSchema,
    destination: permissionUpdateDestinationSchema,
  }),
  z.object({
    type: z.literal('setMode'),
    mode: permissionModeSchema,
    destination: permissionUpdateDestinationSchema,
  }),
  z.object({
    type: z.literal('addDirectories'),
    directories: z.array(z.string()),
    destination: permissionUpdateDestinationSchema,
  }),
  z.object({
    type: z.literal('removeDirectories'),
    directories: z.array(z.string()),
    destination: permissionUpdateDestinationSchema,
  }),
])

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a permission update object against the Zod schema.
 */
export function validatePermissionUpdate(update: unknown): {
  valid: boolean
  errors: string[]
  data?: PermissionUpdate
} {
  const result = permissionUpdateSchema.safeParse(update)
  if (result.success) {
    return { valid: true, errors: [], data: result.data as PermissionUpdate }
  }
  const errors = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
  return { valid: false, errors }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Extract PermissionRuleValue objects from permission updates
 * (only from addRules updates).
 */
export function extractRules(updates: PermissionUpdate[] | undefined): PermissionRuleValue[] {
  if (!updates) return []
  return updates.flatMap((update) => {
    switch (update.type) {
      case 'addRules':
        return update.rules
      default:
        return []
    }
  })
}

/**
 * Check if permission updates contain any rules.
 */
export function hasRules(updates: PermissionUpdate[] | undefined): boolean {
  return extractRules(updates).length > 0
}

/**
 * Convert a PermissionRuleValue to a human-readable string.
 */
export function permissionRuleValueToString(rule: PermissionRuleValue): string {
  if (rule.ruleContent) {
    return `${rule.toolName}(${rule.ruleContent})`
  }
  return rule.toolName
}

/**
 * Check if a destination supports persistence (non-volatile storage).
 */
export function supportsPersistence(destination: PermissionUpdateDestination): boolean {
  return destination === 'localSettings' || destination === 'userSettings' || destination === 'projectSettings'
}

// ============================================================================
// Permission Update Application
// ============================================================================

/**
 * Context object for applying permission updates.
 */
export interface PermissionUpdateContext {
  /** Current permission mode */
  mode: PermissionMode
  /** Rules organized by behavior and destination */
  alwaysAllowRules: Record<string, string[]>
  alwaysDenyRules: Record<string, string[]>
  alwaysAskRules: Record<string, string[]>
  /** Additional working directories */
  additionalWorkingDirectories: Map<string, { path: string; source: string }>
}

/**
 * Create a default empty permission update context.
 */
export function createPermissionUpdateContext(mode: PermissionMode = 'auto'): PermissionUpdateContext {
  return {
    mode,
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    additionalWorkingDirectories: new Map(),
  }
}

/**
 * Get the appropriate rule collection key for a given behavior.
 */
function ruleKindForBehavior(behavior: PermissionBehavior): 'alwaysAllowRules' | 'alwaysDenyRules' | 'alwaysAskRules' {
  switch (behavior) {
    case 'allow':
      return 'alwaysAllowRules'
    case 'deny':
      return 'alwaysDenyRules'
    case 'ask':
      return 'alwaysAskRules'
  }
}

/**
 * Apply a single permission update to the context.
 */
export function applyPermissionUpdate(
  context: PermissionUpdateContext,
  update: PermissionUpdate,
): PermissionUpdateContext {
  switch (update.type) {
    case 'setMode':
      return { ...context, mode: update.mode }

    case 'addRules': {
      const ruleKind = ruleKindForBehavior(update.behavior)
      const ruleStrings = update.rules.map(permissionRuleValueToString)
      const existing = context[ruleKind][update.destination] || []
      return {
        ...context,
        [ruleKind]: {
          ...context[ruleKind],
          [update.destination]: [...existing, ...ruleStrings],
        },
      }
    }

    case 'replaceRules': {
      const ruleKind = ruleKindForBehavior(update.behavior)
      const ruleStrings = update.rules.map(permissionRuleValueToString)
      return {
        ...context,
        [ruleKind]: {
          ...context[ruleKind],
          [update.destination]: ruleStrings,
        },
      }
    }

    case 'removeRules': {
      const ruleKind = ruleKindForBehavior(update.behavior)
      const ruleStrings = update.rules.map(permissionRuleValueToString)
      const rulesToRemove = new Set(ruleStrings)
      const existing = context[ruleKind][update.destination] || []
      return {
        ...context,
        [ruleKind]: {
          ...context[ruleKind],
          [update.destination]: existing.filter((rule) => !rulesToRemove.has(rule)),
        },
      }
    }

    case 'addDirectories': {
      const newDirs = new Map(context.additionalWorkingDirectories)
      for (const dir of update.directories) {
        newDirs.set(dir, { path: dir, source: update.destination })
      }
      return {
        ...context,
        additionalWorkingDirectories: newDirs,
      }
    }

    case 'removeDirectories': {
      const newDirs = new Map(context.additionalWorkingDirectories)
      for (const dir of update.directories) {
        newDirs.delete(dir)
      }
      return {
        ...context,
        additionalWorkingDirectories: newDirs,
      }
    }

    default:
      return context
  }
}

/**
 * Apply multiple permission updates to the context sequentially.
 */
export function applyPermissionUpdates(
  context: PermissionUpdateContext,
  updates: PermissionUpdate[],
): PermissionUpdateContext {
  let updatedContext = context
  for (const update of updates) {
    updatedContext = applyPermissionUpdate(updatedContext, update)
  }
  return updatedContext
}

/**
 * Create a Read rule suggestion for a directory.
 * Returns a PermissionUpdate to add a Read permission rule for the given directory.
 * Returns undefined for the root directory (too broad).
 */
export function createReadRuleSuggestion(
  dirPath: string,
  destination: PermissionUpdateDestination = 'session',
): PermissionUpdate | undefined {
  // Root directory is too broad
  if (dirPath === '/') {
    return undefined
  }

  const ruleContent = dirPath.startsWith('/') ? `/${dirPath}/**` : `${dirPath}/**`

  return {
    type: 'addRules',
    rules: [
      {
        toolName: 'Read',
        ruleContent,
      },
    ],
    behavior: 'allow',
    destination,
  }
}
