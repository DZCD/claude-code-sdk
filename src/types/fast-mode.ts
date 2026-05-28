/**
 * FastModeState — Concurrent tool execution state management.
 *
 * Tracks whether fast mode (concurrent tool execution) is active.
 * Extracted from the CLI's fastMode.ts into the SDK core.
 *
 * States:
 * - 'off': Fast mode not active — tools execute sequentially
 * - 'cooldown': Temporarily disabled after a rate limit event
 * - 'on': Concurrent tool execution enabled
 *
 * @see /home/user/.duclaw/workspace/claude-code-source-code/src/entrypoints/sdk/coreSchemas.ts lines 1883-1889
 * @see /home/user/.duclaw/workspace/claude-code-source-code/src/cli/src/utils/fastMode.ts
 * @see /home/user/.duclaw/workspace/claude-code-source-code/src/entrypoints/sdk/controlSchemas.ts
 */
import { z } from 'zod'

// ============================================================================
// Types
// ============================================================================

/** Fast mode states for concurrent tool execution */
export type FastModeState = z.infer<typeof FastModeStateSchema>

// ============================================================================
// Schemas
// ============================================================================

/**
 * Fast mode state schema.
 *
 * 'off' — sequential execution, no concurrency
 * 'cooldown' — temporarily disabled after rate limiting
 * 'on' — concurrent tool execution enabled
 */
export const FastModeStateSchema = z
  .enum(['off', 'cooldown', 'on'])
  .describe(
    'Fast mode state: off, in cooldown after rate limit, or actively enabled.',
  )

// ============================================================================
// Helpers
// ============================================================================

/** Fast mode is available when state is 'on' */
export function isFastModeEnabled(state: FastModeState): boolean {
  return state === 'on'
}

/** Fast mode is supported (not in cooldown) */
export function isFastModeAvailable(state: FastModeState): boolean {
  return state !== 'cooldown'
}

/** Get a human-readable description of the current fast mode state */
export function getFastModeStateDescription(state: FastModeState): string {
  switch (state) {
    case 'off':
      return 'Fast mode is off — tools execute sequentially'
    case 'cooldown':
      return 'Fast mode in cooldown — temporarily disabled after rate limit'
    case 'on':
      return 'Fast mode is on — concurrent tool execution enabled'
  }
}
