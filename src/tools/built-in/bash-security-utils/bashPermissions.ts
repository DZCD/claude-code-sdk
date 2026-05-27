/**
 * ClaudeCode SDK — BashTool Permissions
 *
 * Permission checking for bash commands: rule matching,
 * safe wrapper stripping, and permission evaluation.
 *
 * Adapted from the Claude Code reference implementation
 * with SDK-specific simplifications.
 */
import type { PermissionContext, PermissionResult } from './types.js'

// ─── Safe Environment Variables ───────────────────────────

const SAFE_ENV_VARS = new Set([
  'NODE_ENV',
  'NODE_PATH',
  'NODE_OPTIONS',
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'EDITOR',
  'VISUAL',
  'PAGER',
  'TMPDIR',
  'TMP',
  'TEMPDIR',
  'DISPLAY',
  'COLORTERM',
  'CLICOLOR',
  'CLICOLOR_FORCE',
  'PIPENV_*, POETRY_*', // developer tooling
  'RUST_LOG',
  'RUST_BACKTRACE',
  'DEBUG',
  'VERBOSE',
  'CI',
  'GITHUB_*',
  'GITLAB_*',
  'BUNDLE_GEMFILE',
  'GEM_PATH',
  'GEM_HOME',
  'RBENV_VERSION',
  'RUBY_VERSION',
  'NVM_*',
  'PYENV_*',
  // Tool-specific but safe
  'MAKEFLAGS',
  'CARGO_*',
  'GOFLAGS',
  'GOOS',
  'GOARCH',
])

// ─── Safe Wrapper Patterns ───────────────────────────────

const SAFE_WRAPPER_PATTERNS = new Set([
  'timeout',
  'nice',
  'nohup',
  'stdbuf',
  'time',
  'env -i',
  'env -',
  'taskset',
  'numactl',
  'ionice',
  'chrt',
])

const SAFE_WRAPPER_PREFIXES = ['env '] as const

const BARE_SHELL_EXEC_PREFIXES = new Set([
  'sh',
  'bash',
  'zsh',
  'fish',
  'csh',
  'tcsh',
  'ksh',
  'dash',
  'cmd',
  'powershell',
  'pwsh',
  'env',
  'xargs',
  'nice',
  'stdbuf',
  'nohup',
  'timeout',
  'time',
  'sudo',
  'doas',
  'pkexec',
])

// ─── Rule Type ────────────────────────────────────────────

type PermissionRuleType = 'prefix' | 'exact' | 'wildcard'

type ParsedRule = {
  type: PermissionRuleType
  prefix?: string
  command?: string
  pattern?: string
}

/**
 * Parse a permission rule string into its components.
 */
export function parsePermissionRule(rule: string): ParsedRule {
  // Wildcard rules: Bash(*), Bash(rm:*)
  if (rule.startsWith('Bash(') && rule.endsWith(')')) {
    const inner = rule.slice(5, -1)
    if (inner === '*' || inner === ':*') {
      return { type: 'wildcard', pattern: '*', prefix: '' }
    }
    if (inner.endsWith(':*')) {
      const prefix = inner.slice(0, inner.lastIndexOf(':*'))
      return { type: 'prefix', prefix }
    }
    return { type: 'exact', command: inner }
  }

  // Simple command patterns
  if (rule.startsWith('Bash:')) {
    const inner = rule.slice(5)
    if (inner === '*' || inner.endsWith(':*')) {
      const prefix = inner === '*' ? '' : inner.slice(0, inner.lastIndexOf(':*'))
      return { type: 'prefix', prefix }
    }
    return { type: 'exact', command: inner }
  }

  return { type: 'exact', command: rule }
}

// ─── Wildcard Matching ────────────────────────────────────

export function matchWildcardPattern(pattern: string, command: string): boolean {
  // Convert Bash wildcard to regex
  const regexStr = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  try {
    return new RegExp(`^${regexStr}$`).test(command)
  } catch {
    return false
  }
}

// ─── Safe Wrapper Stripping ───────────────────────────────

const ENV_VAR_ASSIGN_RE = /^[A-Za-z_]\w*=/

/**
 * Strip safe environment variable prefixes from a command.
 */
function stripSafeEnvVars(command: string): string {
  const tokens = command.trim().split(/\s+/).filter(Boolean)
  let i = 0
  while (i < tokens.length && ENV_VAR_ASSIGN_RE.test(tokens[i]!)) {
    const varName = tokens[i]!.split('=')[0]!
    if (!SAFE_ENV_VARS.has(varName)) {
      // Non-safe env var found, stop stripping
      break
    }
    i++
  }
  return tokens.slice(i).join(' ')
}

/**
 * Strip safe wrapper commands (timeout, nice, nohup, etc.)
 * from the beginning of a command.
 * Handles wrappers that consume arguments (e.g., timeout 30 → strip 2 tokens).
 */
export function stripSafeWrappers(command: string): string {
  let current = command.trim()

  // Strip env vars first
  current = stripSafeEnvVars(current)

  // Known wrappers and how many tokens they consume (wrapper + args)
  const WRAPPER_TOKENS: Array<{ pattern: string; tokens: number }> = [
    // Two-token entries (command + arg)
    { pattern: 'timeout', tokens: 2 }, // timeout N cmd
    { pattern: 'nice -n', tokens: 3 }, // nice -n N cmd
    { pattern: 'stdbuf', tokens: 2 }, // stdbuf -oL cmd
    { pattern: 'taskset', tokens: 2 }, // taskset -c N cmd
    { pattern: 'numactl', tokens: 2 }, // numactl -N cmd
    { pattern: 'ionice', tokens: 2 }, // ionice -cn cmd
    { pattern: 'chrt', tokens: 2 }, // chrt -r N cmd
    // Single-token entries (command with no arg)
    { pattern: 'nice', tokens: 1 }, // nice cmd (nice -n above takes priority)
    { pattern: 'nohup', tokens: 1 },
    { pattern: 'time', tokens: 1 },
    // Multi-word entries
    { pattern: 'env -i', tokens: 2 },
    { pattern: 'env -', tokens: 2 },
  ]

  // Iteratively strip known safe wrappers
  while (true) {
    const tokens = current.split(/\s+/).filter(Boolean)
    if (tokens.length === 0) break

    let stripped = false

    for (const wrapper of WRAPPER_TOKENS) {
      const wrapperTokens = wrapper.pattern.split(/\s+/)
      // Check if the start of command matches the wrapper pattern
      let match = true
      if (tokens.length < wrapperTokens.length) {
        match = false
      } else {
        for (let i = 0; i < wrapperTokens.length; i++) {
          if (tokens[i] !== wrapperTokens[i]) {
            match = false
            break
          }
        }
      }

      if (match) {
        current = tokens.slice(wrapper.tokens).join(' ')
        current = stripSafeEnvVars(current)
        stripped = true
        break
      }
    }

    if (!stripped) break
  }

  return current
}

/**
 * Check if a command starts with a bare shell or wrapper
 * that would allow arbitrary code execution.
 */
export function isBareShellOrWrapperCommand(command: string): boolean {
  const stripped = stripSafeWrappers(command)
  const firstWord = stripped.split(/\s+/)[0]
  return firstWord ? BARE_SHELL_EXEC_PREFIXES.has(firstWord) : false
}

// ─── Command Prefix Extraction ────────────────────────────

/**
 * Extract a stable command prefix (command + subcommand) for rule suggestions.
 */
export function getSimpleCommandPrefix(command: string): string | null {
  const tokens = command.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null

  // Skip env var assignments
  let i = 0
  while (i < tokens.length && ENV_VAR_ASSIGN_RE.test(tokens[i]!)) {
    i++
  }

  const remaining = tokens.slice(i)
  if (remaining.length < 2) return null
  const subcmd = remaining[1]!
  // Second token must look like a subcommand (e.g., "commit", "run")
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(subcmd)) return null
  return remaining.slice(0, 2).join(' ')
}

// ─── Full Permission Check ────────────────────────────────

/**
 * Check if a command has permission to execute based on the current permission context.
 * Returns the permission result.
 */
export function checkBashPermission(command: string, context: PermissionContext): PermissionResult {
  // Bypass mode: everything is allowed
  if (context.mode === 'bypassPermissions') {
    return {
      behavior: 'allow',
      message: 'Permission bypass mode active',
      decisionReason: { type: 'mode', mode: 'bypassPermissions' },
    }
  }

  // Check deny rules first
  const stripped = stripSafeWrappers(command)
  for (const denyRule of context.denyRules) {
    const parsed = parsePermissionRule(denyRule)
    switch (parsed.type) {
      case 'exact':
        if (parsed.command === stripped) {
          return {
            behavior: 'deny',
            message: `Command '${command}' is denied by rule: ${denyRule}`,
            decisionReason: { type: 'rule', rule: denyRule },
          }
        }
        break
      case 'prefix':
        if (parsed.prefix && (stripped === parsed.prefix || stripped.startsWith(`${parsed.prefix} `))) {
          return {
            behavior: 'deny',
            message: `Command '${command}' is denied by rule: ${denyRule}`,
            decisionReason: { type: 'rule', rule: denyRule },
          }
        }
        break
      case 'wildcard':
        if (parsed.pattern && matchWildcardPattern(parsed.pattern, stripped)) {
          return {
            behavior: 'deny',
            message: `Command '${command}' is denied by rule: ${denyRule}`,
            decisionReason: { type: 'rule', rule: denyRule },
          }
        }
        break
    }
  }

  // Check allow rules
  for (const allowRule of context.allowRules) {
    const parsed = parsePermissionRule(allowRule)
    switch (parsed.type) {
      case 'exact':
        if (parsed.command === stripped) {
          return {
            behavior: 'allow',
            message: `Command '${command}' is allowed by rule: ${allowRule}`,
            decisionReason: { type: 'rule', rule: allowRule },
          }
        }
        break
      case 'prefix':
        if (parsed.prefix && (stripped === parsed.prefix || stripped.startsWith(`${parsed.prefix} `))) {
          return {
            behavior: 'allow',
            message: `Command '${command}' is allowed by rule: ${allowRule}`,
            decisionReason: { type: 'rule', rule: allowRule },
          }
        }
        break
      case 'wildcard':
        if (parsed.pattern && matchWildcardPattern(parsed.pattern, stripped)) {
          return {
            behavior: 'allow',
            message: `Command '${command}' is allowed by rule: ${allowRule}`,
            decisionReason: { type: 'rule', rule: allowRule },
          }
        }
        break
    }
  }

  // No rule matched — pass to next check
  return {
    behavior: 'passthrough',
    message: 'No matching permission rule found',
  }
}
