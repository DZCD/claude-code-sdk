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

export { DEFAULT_PLAN_MODE_CONFIG } from '../types/permission.js'
