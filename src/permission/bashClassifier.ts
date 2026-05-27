/**
 * Bash command danger level classifier.
 *
 * Phase 2-G: Classifies bash commands into danger levels
 * (safe, auto_allow, ask, deny) for YOLO/auto-mode decision making.
 *
 * Reference: claude-code-source-code/src/utils/permissions/bashClassifier.ts
 * SDK adaptation: pattern-based synchronous classifier (no LLM API calls).
 */
import type { BashCommandDangerLevel, ClassifierResult } from '../types/permission.js'
import { isDangerousBashCommand } from './dangerousPatterns.js'

// ============================================================================
// Safe (read-only) command patterns
// ============================================================================

const SAFE_COMMANDS = [
  // File listing
  /^ls\b/, /^ll\b/, /^la\b/, /^tree\b/, /^find\b/,
  // File reading
  /^cat\b/, /^head\b/, /^tail\b/, /^less\b/, /^more\b/, /^nl\b/,
  /^wc\b/, /^od\b/, /^xxd\b/, /^hexdump\b/,
  // Content search
  /^grep\b/, /^egrep\b/, /^fgrep\b/, /^rg\b/, /^ripgrep\b/, /^ag\b/, /^ack\b/,
  /^sed\s+(-n\s+)?'/, // sed in non-modifying mode (with -n)
  /^awk\b/,
  // Output (no side effects)
  /^echo\b/, /^printf\b/, /^true\b/, /^false\b/,
  // Environment inspection
  /^env\b/, /^printenv\b/, /^which\b/, /^whereis\b/, /^type\b/, /^hash\b/,
  /^pwd\b/, /^realpath\b/, /^readlink\b/,
  /^date\b/, /^cal\b/, /^ncal\b/,
  /^uname\b/, /^hostname\b/, /^whoami\b/, /^id\b/, /^groups\b/,
  /^uptime\b/, /^w\b/, /^who\b/, /^last\b/,
  // Process inspection
  /^ps\b/, /^top\b/, /^htop\b/, /^btop\b/,
  /^jobs\b/, /^fg\b/, /^bg\b/,
  /^lsof\b/, /^fuser\b/,
  // Network inspection (read-only)
  /^ping\b/, /^traceroute\b/, /^tracepath\b/,
  /^dig\b/, /^nslookup\b/, /^host\b/,
  /^ip\s+a\b/, /^ip\s+addr\b/, /^ip\s+route\b/, /^ip\s+link\b/,
  /^ifconfig\b/, /^netstat\b/, /^ss\b/,
  /^curl\s+-[^|]*$/, // curl without pipe (simple fetch, no pipe-to-shell)
  // File info
  /^file\b/, /^stat\b/, /^du\b/, /^df\b/,
  // Diff
  /^diff\b/, /^colordiff\b/, /^cmp\b/, /^comm\b/,
  // Compression inspection
  /^tar\s+-t\b/, /^unzip\s+-l\b/, /^zcat\b/, /^zless\b/, /^zmore\b/,
  /^gunzip\s+-c\b/,
  // Help/docs
  /^man\b/, /^help\b/, /^info\b/, /^whatis\b/, /^apropos\b/,
  /^tldr\b/, /^cheat\b/,
]

// ============================================================================
// Auto-allow (low-risk) command patterns
// ============================================================================

const AUTO_ALLOW_COMMANDS = [
  // Git read operations
  /^git\s+(status|diff|log|show|branch|tag|stash\s+list|describe|rev-parse|rev-list|config\s+(--global\s+)?--get|config\s+(--global\s+)?--list|shortlog|cherry|count-objects|name-rev)\b/,
  // Git local operations (safe)
  /^git\s+(checkout|switch)\s+[^-]/, // git checkout branch (not --orphan etc.)
  /^git\s+add\b/, /^git\s+restore\b/,
  /^git\s+stash\s+(save|push)\b/, /^git\s+clean\s+-[fd]/,
  // Package installs (read registry, write node_modules)
  /^npm\s+(install|i|ci|add|update|audit|fund|ls|outdated)\b/,
  /^yarn\s+(install|add|upgrade|outdated|why)\b/,
  /^pnpm\s+(install|add|update|outdated|ls)\b/,
  /^bun\s+(install|add|update|outdated|pm)\b/,
  // Build
  /^npm\s+run\b/, /^yarn\s+run\b/, /^pnpm\s+run\b/, /^bun\s+run\b/,
  /^make\b/, /^cmake\b/, /^ninja\b/,
  // File creation/mod (within project)
  /^touch\b/, /^mkdir\b/, /^cp\b/, /^mv\b/, /^ln\b/,
  /^chmod\b(?!\s+-R\s+777)/, /^chown\b(?!\s+-R\s+)/,
  // Text manipulation
  /^sed\s+-i\b/, /^tee\b/,
  // Output redirection
  /^>>/, /^>/,
]

// ============================================================================
// Ask (medium-risk) command patterns
// ============================================================================

const ASK_COMMANDS = [
  // Git destructive operations
  /^git\s+(push|pull|fetch|merge|rebase|reset|revert|cherry-pick|commit|tag\s+-[adf]|stash\s+(drop|pop|clear|apply)|branch\s+-[dDmM]|remote\s+(add|remove|rename|set-url)|submodule)\b/,
  // Service management
  /^systemctl\b/, /^service\b/, /^initctl\b/,
  // Package management (system-wide)
  /^apt\b/, /^apt-get\b/, /^dpkg\b/, /^snap\b/,
  /^yum\b/, /^dnf\b/, /^rpm\b/,
  /^brew\b/, /^port\b/,
  // Process management
  /^kill\b/, /^killall\b/, /^pkill\b/, /^nohup\b/,
  /^disown\b/,
  // Network changes
  /^ip\s+(link\s+(set|add|del)|addr\s+(add|del)|route\s+(add|del|replace)|neigh\s+(add|del|replace))\b/,
  // Docker
  /^docker\b/, /^podman\b/, /^nerdctl\b/,
  // Sudo (general)
  /^sudo\s+\w+/,
  // Configuration
  /^crontab\b/, /^at\b/,
  /^export\b/, /^alias\b/, /^unalias\b/, /^set\b/, /^unset\b/,
  // SSH connections
  /^ssh\b/, /^scp\b/, /^rsync\b/,
  // Source
  /^source\b/, /^\.\s+/,
  // Environment
  /^nvm\b/, /^sdk\b/, /^pyenv\b/, /^rbenv\b/, /^nodenv\b/,
  // Database
  /^psql\b/, /^mysql\b/, /^sqlite3\b/, /^mongosh\b/, /^redis-cli\b/,
  // Python venv
  /^python\s+-m\s+venv\b/, /^virtualenv\b/,
]

// ============================================================================
// Public API
// ============================================================================

/**
 * Classify a bash command into a danger level.
 *
 * @param command - The bash command string
 * @param _cwd - Current working directory (reserved for future use)
 * @returns ClassifierResult with danger level and reason
 */
export function classifyBashCommand(
  command: string,
  _cwd?: string,
): ClassifierResult {
  const trimmed = command.trim()
  if (!trimmed) {
    return { dangerLevel: 'safe', reason: 'Empty command' }
  }

  // 1. Check dangerous patterns first (highest priority)
  if (isDangerousBashCommand(trimmed)) {
    return {
      dangerLevel: 'deny',
      reason: `Command matches dangerous pattern`,
    }
  }

  // 2. Check safe (read-only) patterns
  for (const pattern of SAFE_COMMANDS) {
    if (pattern.test(trimmed)) {
      return { dangerLevel: 'safe', reason: 'Read-only command' }
    }
  }

  // 3. Check auto-allow (low-risk) patterns
  for (const pattern of AUTO_ALLOW_COMMANDS) {
    if (pattern.test(trimmed)) {
      return { dangerLevel: 'auto_allow', reason: 'Low-risk operation' }
    }
  }

  // 4. Check ask (medium-risk) patterns
  for (const pattern of ASK_COMMANDS) {
    if (pattern.test(trimmed)) {
      return { dangerLevel: 'ask', reason: 'Medium-risk operation requires confirmation' }
    }
  }

  // 5. Default: unknown command, treat as auto_allow
  // This is the permissive default — unknown commands are assumed low-risk
  return {
    dangerLevel: 'auto_allow',
    reason: 'Unrecognized command, allowed with low-risk classification',
  }
}

/**
 * Check if a command is read-only (safe for plan mode).
 */
export function isReadOnlyCommand(command: string): boolean {
  const trimmed = command.trim()
  if (!trimmed) return true

  // Check if it matches safe patterns (truly read-only)
  for (const pattern of SAFE_COMMANDS) {
    if (pattern.test(trimmed)) return true
  }

  // Also treat auto_allow commands as read-only (they're low-risk)
  for (const pattern of AUTO_ALLOW_COMMANDS) {
    if (pattern.test(trimmed)) return true
  }

  return false
}

/**
 * Check if a command can be auto-allowed (safe or low-risk).
 */
export function isAutoAllowCommand(command: string): boolean {
  const result = classifyBashCommand(command)
  return result.dangerLevel === 'safe' || result.dangerLevel === 'auto_allow'
}
