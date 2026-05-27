/**
 * ClaudeCode SDK — BashTool Mode Validation
 *
 * Mode-specific behavior restrictions for bash commands.
 * - acceptEdits: Auto-allow filesystem commands
 * - bypassPermissions: Auto-allow everything
 * - default/dontAsk: Pass through to other checks
 */
import type { PermissionResult, PermissionContext } from './types.js'

const FILESYSTEM_COMMANDS = [
  'mkdir', 'touch', 'rm', 'rmdir', 'mv', 'cp', 'sed',
] as const

type FilesystemCommand = (typeof FILESYSTEM_COMMANDS)[number]

function isFilesystemCommand(command: string): command is FilesystemCommand {
  return FILESYSTEM_COMMANDS.includes(command as FilesystemCommand)
}

/**
 * Check if commands should be handled differently based on the
 * current permission mode.
 *
 * @returns
 * - 'allow' if the mode permits auto-approval
 * - 'ask' if the command needs approval in current mode
 * - 'passthrough' if no mode-specific handling applies
 */
export function checkPermissionMode(
  command: string,
  context: PermissionContext,
): PermissionResult {
  const trimmedCmd = command.trim()
  const [baseCmd] = trimmedCmd.split(/\s+/)

  if (!baseCmd) {
    return {
      behavior: 'passthrough',
      message: 'Base command not found',
    }
  }

  // Bypass permissions mode handles everything
  if (context.mode === 'bypassPermissions') {
    return {
      behavior: 'allow',
      message: 'Bypass mode auto-approves all commands',
      decisionReason: { type: 'mode', mode: 'bypassPermissions' },
    }
  }

  // Accept Edits mode: auto-allow filesystem operations
  if (context.mode === 'acceptEdits' && isFilesystemCommand(baseCmd)) {
    return {
      behavior: 'allow',
      message: `Filesystem command auto-allowed in ${context.mode} mode`,
      decisionReason: { type: 'mode', mode: 'acceptEdits' },
    }
  }

  return {
    behavior: 'passthrough',
    message: `No mode-specific handling for '${baseCmd}' in ${context.mode} mode`,
  }
}

/**
 * Get the list of commands that are auto-allowed in the given mode.
 */
export function getAutoAllowedCommands(
  mode: PermissionContext['mode'],
): readonly string[] {
  return mode === 'acceptEdits' ? FILESYSTEM_COMMANDS : []
}
