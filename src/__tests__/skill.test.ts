/**
 * ClaudeCode SDK — Skill System Tests
 *
 * Tests for SkillRegistry and SkillTool.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { SkillRegistry } from '../skill/registry.js'
import { SkillTool } from '../skill/skill-tool.js'
import type { Skill } from '../types/skill.js'
import { MAX_SKILL_LISTING_DESC_CHARS } from '../types/skill.js'

const codeReviewSkill: Skill = {
  name: 'code_review',
  description: '对代码进行全面审查，发现潜在问题',
  instruction: '你是一个资深代码审查专家。\n\n关注：\n1. 安全性\n2. 性能\n3. 可维护性\n\n审查完成后输出结构化报告。',
  allowedTools: ['FileRead', 'Grep', 'Glob'],
  context: 'inline',
}

const weatherSkill: Skill = {
  name: 'weather_check',
  description: '查询天气信息',
  instruction: '使用内置的 web_fetch 工具查询当前天气信息，然后以友好的方式回复用户。',
  allowedTools: ['WebFetch', 'WebSearch'],
}

describe('SkillRegistry', () => {
  let registry: SkillRegistry

  beforeEach(() => {
    registry = new SkillRegistry()
  })

  it('should start empty', () => {
    expect(registry.size).toBe(0)
    expect(registry.getAll()).toEqual([])
    expect(registry.toListing()).toBe('')
  })

  it('should register a skill', () => {
    registry.register(codeReviewSkill)
    expect(registry.size).toBe(1)
    expect(registry.has('code_review')).toBe(true)
  })

  it('should register multiple skills', () => {
    registry.register(codeReviewSkill, weatherSkill)
    expect(registry.size).toBe(2)
  })

  it('should throw on duplicate registration', () => {
    registry.register(codeReviewSkill)
    expect(() => registry.register(codeReviewSkill)).toThrow('already registered')
  })

  it('should get a skill by name', () => {
    registry.register(codeReviewSkill)
    const skill = registry.get('code_review')
    expect(skill).toBeDefined()
    expect(skill?.name).toBe('code_review')
    expect(skill?.description).toBe('对代码进行全面审查，发现潜在问题')
    expect(skill?.instruction).toContain('资深代码审查专家')
    expect(skill?.allowedTools).toEqual(['FileRead', 'Grep', 'Glob'])
    expect(skill?.context).toBe('inline')
  })

  it('should return undefined for unknown skill', () => {
    expect(registry.get('nonexistent')).toBeUndefined()
  })

  it('should unregister a skill', () => {
    registry.register(codeReviewSkill)
    expect(registry.unregister('code_review')).toBe(true)
    expect(registry.size).toBe(0)
    expect(registry.unregister('nonexistent')).toBe(false)
  })

  it('should clear all skills', () => {
    registry.register(codeReviewSkill, weatherSkill)
    registry.clear()
    expect(registry.size).toBe(0)
  })

  it('should return frozen skills array', () => {
    registry.register(codeReviewSkill)
    const skills = registry.getSkills()
    expect(Object.isFrozen(skills)).toBe(true)
  })

  describe('toListing()', () => {
    it('should generate listing for single skill', () => {
      registry.register(codeReviewSkill)
      const listing = registry.toListing()
      expect(listing).toContain('# Available Skills')
      expect(listing).toContain('code_review: 对代码进行全面审查，发现潜在问题')
      expect(listing).toContain('SkillTool')
    })

    it('should generate listing for multiple skills', () => {
      registry.register(codeReviewSkill, weatherSkill)
      const listing = registry.toListing()
      expect(listing).toContain('code_review')
      expect(listing).toContain('weather_check')
    })

    it('should truncate description over MAX_SKILL_LISTING_DESC_CHARS', () => {
      const longDesc = 'x'.repeat(MAX_SKILL_LISTING_DESC_CHARS + 100)
      registry.register({
        name: 'long_skill',
        description: longDesc,
        instruction: 'test',
      })
      const listing = registry.toListing()
      // Should not contain the full description
      expect(listing.length).toBeLessThan(longDesc.length + 100)
      expect(listing).toContain('...')
    })
  })
})

describe('SkillTool', () => {
  let registry: SkillRegistry
  let tool: SkillTool

  beforeEach(() => {
    registry = new SkillRegistry()
    tool = new SkillTool()
  })

  it('should have correct metadata', () => {
    expect(tool.name).toBe('SkillTool')
    expect(tool.description).toContain('Load')
    expect(tool.isReadOnly()).toBe(true)
    expect(tool.isConcurrencySafe()).toBe(true)
    expect(tool.userFacingName()).toBe('Skill Tool')
  })

  it('should return error when registry is not set', async () => {
    const result = await tool.execute({ skill_name: 'any' })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Skill system is not initialized')
  })

  it('should return error for unknown skill', async () => {
    tool.setRegistry(registry)
    const result = await tool.execute({ skill_name: 'nonexistent' })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('not found')
  })

  it('should return skill content for known skill', async () => {
    registry.register(codeReviewSkill)
    tool.setRegistry(registry)

    const result = await tool.execute({ skill_name: 'code_review' })
    expect(result.isError).toBe(false)
    expect(result.content).toContain('资深代码审查专家')
    expect(result.content).toContain('安全性')
    expect(result.content).toContain('FileRead')
    expect(result.content).toContain('Grep')
    expect(result.content).toContain('Glob')
  })

  it('should include allowedTools in output', async () => {
    registry.register(weatherSkill)
    tool.setRegistry(registry)

    const result = await tool.execute({ skill_name: 'weather_check' })
    expect(result.isError).toBe(false)
    expect(result.content).toContain('WebFetch')
    expect(result.content).toContain('WebSearch')
  })

  it('should include context fork note when context is fork', async () => {
    registry.register({
      name: 'fork_skill',
      description: 'test',
      instruction: 'do something',
      context: 'fork',
    })
    tool.setRegistry(registry)

    const result = await tool.execute({ skill_name: 'fork_skill' })
    expect(result.content).toContain('separate context')
  })
})
