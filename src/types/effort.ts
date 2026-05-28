/**
 * EffortLevel — Controls Claude's thinking/reasoning effort.
 *
 * Corresponds to Anthropic's `thinking.effort` parameter.
 *
 * - `low`: Minimal thinking effort, fastest response
 * - `medium`: Balanced thinking effort (default for most models)
 * - `high`: Maximum thinking effort, most thorough reasoning
 */
export type EffortLevel = 'low' | 'medium' | 'high'

/**
 * Normalize an unknown input to a valid EffortLevel.
 * Defaults to 'medium' if the input is not a recognized value.
 */
export function normalizeEffortLevel(value: unknown): EffortLevel {
  if (value === 'low' || value === 'medium' || value === 'high') {
    return value
  }
  return 'medium'
}

/**
 * All valid EffortLevel values.
 */
export const EFFORT_LEVELS: readonly EffortLevel[] = ['low', 'medium', 'high'] as const
