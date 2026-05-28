/**
 * ClaudeCode SDK — Skill Registry
 *
 * Central registry for Skill management. Handles registration,
 * lookup, and listing generation for progressive-exposure skills.
 * Skills are not tools — they are instruction sets that AI discovers
 * through listing and loads on demand.
 */
import type { Skill, Skills } from '../types/skill.js'
import { MAX_SKILL_LISTING_DESC_CHARS } from '../types/skill.js'

export class SkillRegistry {
  private readonly _skills = new Map<string, Skill>()

  /** Register one or more skills */
  register(...skills: Skill[]): void {
    for (const skill of skills) {
      if (this._skills.has(skill.name)) {
        throw new Error(`Skill "${skill.name}" is already registered`)
      }
      this._skills.set(skill.name, skill)
    }
  }

  /** Get a skill by name */
  get(name: string): Skill | undefined {
    return this._skills.get(name)
  }

  /** Get all registered skills */
  getAll(): Skill[] {
    return Array.from(this._skills.values())
  }

  /** Get skills as a read-only array */
  getSkills(): Skills {
    return Object.freeze([...this._skills.values()])
  }

  /** Check if a skill exists */
  has(name: string): boolean {
    return this._skills.has(name)
  }

  /** Remove a skill by name */
  unregister(name: string): boolean {
    return this._skills.delete(name)
  }

  /** Clear all registered skills */
  clear(): void {
    this._skills.clear()
  }

  /** Get the number of registered skills */
  get size(): number {
    return this._skills.size
  }

  /** Generate listing text for AI discovery (progressive-exposure surface) */
  toListing(): string {
    if (this._skills.size === 0) return ''

    const lines: string[] = ['# Available Skills']

    for (const skill of this.getAll()) {
      const trimmedDesc =
        skill.description.length > MAX_SKILL_LISTING_DESC_CHARS
          ? `${skill.description.slice(0, MAX_SKILL_LISTING_DESC_CHARS - 3)}...`
          : skill.description

      lines.push(`- ${skill.name}: ${trimmedDesc}`)
    }

    lines.push('')
    lines.push('To use a skill, call the `SkillTool` with the skill name.')
    lines.push("The skill's instructions will be loaded into the conversation.")

    return lines.join('\n')
  }
}
