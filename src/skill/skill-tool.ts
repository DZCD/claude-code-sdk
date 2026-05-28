/**
 * ClaudeCode SDK — SkillTool
 *
 * Built-in tool that bridges the Skill system and the tool system.
 * When AI calls SkillTool with a skill name, the tool looks up the
 * skill in SkillRegistry and returns its full instruction content.
 *
 * This is the "deep dive" mechanism of progressive-exposure: AI first
 * sees only the skill listing (name: description), and when it selects
 * one, SkillTool loads the full instruction into the conversation.
 */
import { z } from 'zod'
import { BaseTool } from '../tools/base.js'
import type { SkillRegistry } from './registry.js'

export class SkillTool extends BaseTool {
  readonly name = 'SkillTool'
  readonly description =
    "Load a skill's instructions into the conversation. Call this when you need to execute a specific skill that matches the current task."

  readonly inputSchema = z.object({
    skill_name: z.string().describe('The name of the skill to load'),
  })

  private _registry: SkillRegistry | null = null

  /** Set the SkillRegistry instance (called during SDK initialization) */
  setRegistry(registry: SkillRegistry): void {
    this._registry = registry
  }

  async execute(input: { skill_name: string }): Promise<{
    data: null
    content: string
    isError: boolean
  }> {
    if (!this._registry) {
      return {
        data: null,
        content: 'Error: Skill system is not initialized. No SkillRegistry available.',
        isError: true,
      }
    }

    const skill = this._registry.get(input.skill_name)

    if (!skill) {
      const available = this._registry
        .getAll()
        .map((s) => s.name)
        .join(', ')
      return {
        data: null,
        content: `Error: Skill "${input.skill_name}" not found. Available skills: ${available || '(none)'}`,
        isError: true,
      }
    }

    // Return the full instruction as content — this gets injected into conversation
    const parts: string[] = [`# Skill: ${skill.name}`, '', skill.instruction]

    if (skill.allowedTools && skill.allowedTools.length > 0) {
      parts.push('', '## Allowed Tools', '', skill.allowedTools.map((t) => `- ${t}`).join('\n'))
    }

    if (skill.context === 'fork') {
      parts.push('', '> This skill runs in a separate context. Focus only on the task above.')
    }

    return {
      data: null,
      content: parts.join('\n'),
      isError: false,
    }
  }

  override isReadOnly(): boolean {
    return true
  }

  override isConcurrencySafe(): boolean {
    return true
  }

  override userFacingName(): string {
    return 'Skill Tool'
  }
}
