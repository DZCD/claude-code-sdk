/**
 * ClaudeCode SDK — Skill Type Definitions
 *
 * Skills are progressive-exposure instruction sets that AI can discover
 * and load on demand. Unlike tools which are always visible with full
 * schema, Skills only show a name/description listing initially and
 * inject their full content only when the AI selects one.
 */

/** A progressive-exposure Skill */
export interface Skill {
  /** Unique skill name */
  readonly name: string

  /** Brief description (max 250 chars — this is all AI sees in listing) */
  readonly description: string

  /** Full instruction content injected when AI selects this skill */
  readonly instruction: string

  /** Optional: tools the AI is allowed to use while executing this skill */
  readonly allowedTools?: string[]

  /** Execution context mode */
  readonly context?: 'inline' | 'fork'
}

/** Options for creating a Skill */
export interface SkillOptions {
  name: string
  description: string
  instruction: string
  allowedTools?: string[]
  context?: 'inline' | 'fork'
}

/** List of registered skills */
export type Skills = readonly Skill[]

/** Maximum characters for skill listing description */
export const MAX_SKILL_LISTING_DESC_CHARS = 250

/** Maximum percentage of context tokens for skill listing */
export const SKILL_BUDGET_CONTEXT_PERCENT = 0.01
