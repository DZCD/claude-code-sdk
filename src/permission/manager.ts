/**
 * ClaudeCode SDK — Permission Manager
 *
 * Controls what tools can do based on permission mode and rules.
 * Supports auto (allow all), manual (ask for each), plan (read-only),
 * and bypass (disable permissions) modes.
 *
 * Phase 2-G Extensions:
 * - Bash command classification (YOLO classifier)
 * - Path validation with sandbox constraints
 * - Dangerous pattern detection
 * - Plan mode refinement
 */
import type {
  PermissionMode,
  PermissionRequest,
  PermissionDecision,
  PermissionRule,
  PermissionResult,
  ClassifierResult,
  BashCommandDangerLevel,
  PlanModeConfig,
  PathValidationResult,
  FileOperationType,
  PathValidationOptions,
} from '../types/permission.js'
import type { Tool } from '../types/tool.js'
import { classifyBashCommand, isReadOnlyCommand, isAutoAllowCommand } from './bashClassifier.js'
import { isDangerousBashCommand, isDangerousRemovalPath } from './dangerousPatterns.js'
import { validatePath as validatePathEnhanced_, isPathAllowed } from './pathValidation.js'
import { DEFAULT_PLAN_MODE_CONFIG } from '../types/permission.js'

export class PermissionManager {
  private _mode: PermissionMode
  private readonly _rules: PermissionRule[] = []
  private _planModeConfig: PlanModeConfig = { ...DEFAULT_PLAN_MODE_CONFIG }
  private _allowedDirectories: string[] = []
  private _denyWithinAllow: string[] = []
  private _sensitivePathProtection: boolean = true

  constructor(mode: PermissionMode = 'auto', rules?: PermissionRule[]) {
    this._mode = mode
    if (rules) {
      this._rules.push(...rules)
    }
  }

  // ==========================================================================
  // Mode Management
  // ==========================================================================

  /** Set the permission mode */
  setMode(mode: PermissionMode): void {
    this._mode = mode
  }

  /** Get the current permission mode */
  getMode(): PermissionMode {
    return this._mode
  }

  // ==========================================================================
  // Rule Management
  // ==========================================================================

  /** Add a permission rule */
  addRule(rule: PermissionRule): void {
    this._rules.push(rule)
  }

  /** Add multiple permission rules */
  addRules(rules: PermissionRule[]): void {
    this._rules.push(...rules)
  }

  /** Get all rules */
  getRules(): PermissionRule[] {
    return [...this._rules]
  }

  // ==========================================================================
  // Plan Mode Configuration (Phase 2-G)
  // ==========================================================================

  /** Get plan mode configuration */
  getPlanModeConfig(): PlanModeConfig {
    return { ...this._planModeConfig }
  }

  /** Set plan mode configuration */
  setPlanModeConfig(config: PlanModeConfig): void {
    this._planModeConfig = { ...config }
  }

  /**
   * Check if a tool is allowed in plan mode.
   * Plan mode allows read-only tools when configured to do so.
   */
  checkToolInPlanMode(
    toolName: string,
    input: Record<string, unknown>,
    tool: { name: string; isReadOnly?: (input: Record<string, unknown>) => boolean },
  ): PermissionDecision {
    // If plan mode allows read-only tools, check if this tool is read-only
    if (this._planModeConfig.allowReadOnlyTools) {
      const readOnly = tool.isReadOnly?.(input as never) ?? false
      if (readOnly) {
        return { type: 'allow' }
      }
    }

    // If we got here, deny in plan mode
    return { type: 'deny', reason: `Plan mode: tool "${toolName}" execution not allowed` }
  }

  // ==========================================================================
  // Bash Command Classification (Phase 2-G)
  // ==========================================================================

  /**
   * Check if a bash command is permitted based on its danger level and current mode.
   *
   * Decision matrix:
   * | DangerLevel  | auto  | manual | plan   | bypass |
   * |-------------|-------|--------|--------|--------|
   * | safe        | allow | ask    | deny   | allow  |
   * | auto_allow  | allow | ask    | deny   | allow  |
   * | ask         | ask   | ask    | deny   | allow  |
   * | deny        | deny  | deny   | deny   | allow  |
   */
  async checkBashCommand(command: string, cwd?: string): Promise<PermissionDecision> {
    const trimmed = command.trim()
    if (!trimmed) {
      return { type: 'allow' }
    }

    // Bypass mode always allows
    if (this._mode === 'bypass') {
      return { type: 'allow' }
    }

    // Plan mode always denies bash
    if (this._mode === 'plan') {
      return { type: 'deny', reason: 'Plan mode: bash execution not allowed' }
    }

    // Classify the command
    const classification = classifyBashCommand(trimmed, cwd)

    switch (classification.dangerLevel) {
      case 'safe':
        // Safe commands are allowed in auto mode
        return { type: 'allow' }

      case 'auto_allow':
        // Low-risk commands are allowed in auto mode
        return { type: 'allow' }

      case 'ask':
        // Medium-risk commands require confirmation in auto/manual mode
        return {
          type: 'ask',
          prompt: `Allow command? ${classification.reason}: ${trimmed.substring(0, 100)}`,
        }

      case 'deny':
        // High-risk commands are always denied (except bypass)
        return {
          type: 'deny',
          reason: `Command denied: ${classification.reason}`,
        }

      default:
        return { type: 'ask', prompt: `Allow command: ${trimmed.substring(0, 100)}?` }
    }
  }

  /**
   * Get danger classification for a bash command without making a decision.
   */
  classifyBashCommand(command: string, cwd?: string): ClassifierResult {
    return classifyBashCommand(command, cwd)
  }

  /**
   * Check if a command is read-only.
   */
  isReadOnlyCommand(command: string): boolean {
    return isReadOnlyCommand(command)
  }

  /**
   * Check if a command can be auto-allowed.
   */
  isAutoAllowCommand(command: string): boolean {
    return isAutoAllowCommand(command)
  }

  /**
   * Check if a command is dangerous using pattern detection.
   */
  isDangerousBashCommand(command: string): boolean {
    return isDangerousBashCommand(command)
  }

  // ==========================================================================
  // Path Validation (Phase 2-G)
  // ==========================================================================

  /** Add an allowed directory for path validation */
  addAllowedDirectory(dir: string): void {
    if (!this._allowedDirectories.includes(dir)) {
      this._allowedDirectories.push(dir)
    }
  }

  /** Remove an allowed directory */
  removeAllowedDirectory(dir: string): void {
    this._allowedDirectories = this._allowedDirectories.filter((d) => d !== dir)
  }

  /** Set allowed directories (replaces existing) */
  setAllowedDirectories(dirs: string[]): void {
    this._allowedDirectories = [...dirs]
  }

  /** Get allowed directories */
  getAllowedDirectories(): string[] {
    return [...this._allowedDirectories]
  }

  /** Add a deny-within-allow path */
  addDenyPath(path: string): void {
    if (!this._denyWithinAllow.includes(path)) {
      this._denyWithinAllow.push(path)
    }
  }

  /** Set sensitive path protection */
  setSensitivePathProtection(enabled: boolean): void {
    this._sensitivePathProtection = enabled
  }

  /** Get path validation options */
  private _getPathValidationOptions(): PathValidationOptions {
    return {
      allowedDirectories: [...this._allowedDirectories],
      denyWithinAllow: [...this._denyWithinAllow],
      enableSensitivePathProtection: this._sensitivePathProtection,
    }
  }

  /**
   * Validate a file path with enhanced rules (Phase 2-G).
   *
   * @param path - Path to validate
   * @param cwd - Current working directory
   * @param operationType - Type of operation (read/write/create)
   * @returns PathValidationResult
   */
  validatePathEnhanced(
    path: string,
    cwd: string,
    operationType: FileOperationType,
  ): PathValidationResult {
    const options = this._getPathValidationOptions()
    return validatePathEnhanced_(path, cwd, options, operationType)
  }

  /** Legacy path validation (backwards compatible) */
  validatePath(path: string, allowedDirs: string[]): { valid: boolean; reason?: string } {
    const resolved = path.startsWith('/') ? path : `/${path}`
    for (const dir of allowedDirs) {
      if (resolved.startsWith(dir)) {
        return { valid: true }
      }
    }
    return {
      valid: false,
      reason: `Path "${path}" is not in any allowed directory`,
    }
  }

  /** Check if a path is dangerous for removal */
  isDangerousRemovalPath(resolvedPath: string): boolean {
    return isDangerousRemovalPath(resolvedPath)
  }

  // ==========================================================================
  // Core Permission Checking
  // ==========================================================================

  /** Check if a tool call is permitted */
  async check(request: PermissionRequest): Promise<PermissionDecision> {
    // Check rules first
    for (const rule of this._rules) {
      if (this._matchesRule(request, rule)) {
        switch (rule.behavior) {
          case 'allow':
            return { type: 'allow' }
          case 'deny':
            return { type: 'deny', reason: `Denied by rule: ${rule.pattern}` }
          case 'ask':
            return { type: 'ask', prompt: `Allow ${request.toolName}?` }
        }
      }
    }

    // Fall back to mode-based decisions
    switch (this._mode) {
      case 'bypass':
      case 'auto':
        return { type: 'allow' }
      case 'plan':
        return { type: 'deny', reason: 'Plan mode: tool execution not allowed' }
      case 'manual':
        return { type: 'ask', prompt: `Allow tool "${request.toolName}"?` }
    }
  }

  /** Check if a tool is read-only (safe for plan mode) */
  isToolReadOnly(tool: Tool, input: Record<string, unknown>): boolean {
    return tool.isReadOnly?.(input as never) ?? false
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /** Match a permission rule against a request */
  private _matchesRule(request: PermissionRequest, rule: PermissionRule): boolean {
    // Simple pattern: "ToolName" or "ToolName(pattern)"
    const [toolPattern, argPattern] = this._parseRulePattern(rule.pattern)

    if (toolPattern !== '*' && toolPattern !== request.toolName) {
      return false
    }

    if (argPattern && argPattern !== '*') {
      // Check if any input values match the arg pattern (supports wildcards)
      const regexStr = '^' + argPattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.') + '$'
      const regex = new RegExp(regexStr, 'i')

      const inputValues = Object.values(request.input).map(String)
      const hasMatch = inputValues.some((val) => regex.test(val))
      if (!hasMatch) {
        return false
      }
    }

    return true
  }

  /** Parse a rule pattern like "Bash(git *)" into ["Bash", "git *"] */
  private _parseRulePattern(pattern: string): [string, string | undefined] {
    const parenIndex = pattern.indexOf('(')
    if (parenIndex === -1) {
      return [pattern.trim(), undefined]
    }
    const toolName = pattern.slice(0, parenIndex).trim()
    const argPattern = pattern.slice(parenIndex + 1, pattern.lastIndexOf(')')).trim()
    return [toolName, argPattern || undefined]
  }
}
