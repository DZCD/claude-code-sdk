/**
 * ClaudeCode SDK — Permission Manager
 *
 * Controls what tools can do based on permission mode and rules.
 * Supports auto (allow all), manual (ask for each), plan (read-only),
 * and bypass (disable permissions) modes.
 */
import type { PermissionMode, PermissionRequest, PermissionDecision, PermissionRule, PermissionResult } from '../types/permission.js'
import type { Tool } from '../types/tool.js'

export class PermissionManager {
  private _mode: PermissionMode
  private readonly _rules: PermissionRule[] = []

  constructor(mode: PermissionMode = 'auto', rules?: PermissionRule[]) {
    this._mode = mode
    if (rules) {
      this._rules.push(...rules)
    }
  }

  /** Set the permission mode */
  setMode(mode: PermissionMode): void {
    this._mode = mode
  }

  /** Get the current permission mode */
  getMode(): PermissionMode {
    return this._mode
  }

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

  /** Validate a file path against allowed directories */
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

  /** Check if a tool is read-only (safe for plan mode) */
  isToolReadOnly(tool: Tool, input: Record<string, unknown>): boolean {
    return tool.isReadOnly?.(input as never) ?? false
  }

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
