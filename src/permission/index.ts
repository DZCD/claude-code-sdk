/**
 * ClaudeCode SDK — Permission Module Index
 *
 * Exports all permission system components including Phase 2-G additions:
 * bash classifier, dangerous patterns, path validation.
 */

export { PermissionManager } from './manager.js'
export {
  classifyBashCommand,
  isReadOnlyCommand,
  isAutoAllowCommand,
} from './bashClassifier.js'
export {
  isDangerousBashCommand,
  isDangerousRemovalPath,
  getDangerousPatterns,
  getCommandRiskLevel,
} from './dangerousPatterns.js'
export {
  validatePath,
  isPathAllowed,
  expandTilde,
  getGlobBaseDirectory,
  matchesSensitivePath,
  SENSITIVE_PATHS,
} from './pathValidation.js'

// Permission Update (Phase 3D)
export {
  permissionUpdateDestinationSchema,
  permissionBehaviorSchema,
  permissionRuleValueSchema,
  permissionModeSchema,
  permissionUpdateSchema,
  validatePermissionUpdate,
  extractRules,
  hasRules,
  permissionRuleValueToString,
  supportsPersistence,
  applyPermissionUpdate,
  applyPermissionUpdates,
  createPermissionUpdateContext,
  createReadRuleSuggestion,
} from './permission-update.js'

export type {
  PermissionMode,
  PermissionRequest,
  PermissionDecision,
  PermissionRule,
  PermissionResult,
  ClassifierResult,
  BashCommandDangerLevel,
  FileOperationType,
  PathValidationResult,
  PathValidationOptions,
  PlanModeConfig,
  DangerousPattern,
} from '../types/permission.js'

export type {
  PermissionUpdateDestination,
  PermissionBehavior,
  PermissionRuleValue,
  PermissionUpdate,
  PermissionAddRulesUpdate,
  PermissionReplaceRulesUpdate,
  PermissionRemoveRulesUpdate,
  PermissionSetModeUpdate,
  PermissionAddDirectoriesUpdate,
  PermissionRemoveDirectoriesUpdate,
} from '../types/permission-update.js'

export type { PermissionUpdateContext } from './permission-update.js'

export { DEFAULT_PLAN_MODE_CONFIG } from '../types/permission.js'
