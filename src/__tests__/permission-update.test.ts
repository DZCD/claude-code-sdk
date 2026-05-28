/**
 * Tests for Permission Update module (Phase 3D)
 *
 * Covers: Zod validation, runtime application functions (addRules,
 * replaceRules, removeRules, setMode, addDirectories, removeDirectories),
 * extractRules/hasRules utilities, permissionRuleValueToString,
 * createReadRuleSuggestion, supportsPersistence.
 */
import { describe, expect, it } from 'vitest'
import { permissionUpdateSchema } from '../permission/permission-update.js'
import {
  applyPermissionUpdate,
  applyPermissionUpdates,
  createPermissionUpdateContext,
  createReadRuleSuggestion,
  extractRules,
  hasRules,
  permissionRuleValueToString,
  supportsPersistence,
  validatePermissionUpdate,
} from '../permission/permission-update.js'
import type { PermissionUpdate } from '../types/permission-update.js'

// ============================================================================
// Zod Schema Validation
// ============================================================================

describe('permissionUpdateSchema validation', () => {
  describe('addRules', () => {
    it('should parse valid addRules update', () => {
      const result = permissionUpdateSchema.safeParse({
        type: 'addRules',
        rules: [{ toolName: 'Bash', ruleContent: 'git *' }],
        behavior: 'allow',
        destination: 'userSettings',
      })
      expect(result.success).toBe(true)
    })

    it('should parse addRules with multiple rules', () => {
      const result = permissionUpdateSchema.safeParse({
        type: 'addRules',
        rules: [{ toolName: 'Read' }, { toolName: 'Write', ruleContent: '*.ts' }],
        behavior: 'deny',
        destination: 'session',
      })
      expect(result.success).toBe(true)
    })

    it('should reject addRules with missing required fields', () => {
      const result = permissionUpdateSchema.safeParse({
        type: 'addRules',
        rules: [],
      })
      expect(result.success).toBe(false)
    })

    it('should reject addRules with invalid behavior', () => {
      const result = permissionUpdateSchema.safeParse({
        type: 'addRules',
        rules: [{ toolName: 'Bash' }],
        behavior: 'invalid',
        destination: 'session',
      })
      expect(result.success).toBe(false)
    })

    it('should reject addRules with invalid destination', () => {
      const result = permissionUpdateSchema.safeParse({
        type: 'addRules',
        rules: [{ toolName: 'Bash' }],
        behavior: 'allow',
        destination: 'someRandomPlace',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('replaceRules', () => {
    it('should parse valid replaceRules update', () => {
      const result = permissionUpdateSchema.safeParse({
        type: 'replaceRules',
        rules: [{ toolName: 'Bash' }],
        behavior: 'ask',
        destination: 'projectSettings',
      })
      expect(result.success).toBe(true)
    })
  })

  describe('removeRules', () => {
    it('should parse valid removeRules update', () => {
      const result = permissionUpdateSchema.safeParse({
        type: 'removeRules',
        rules: [{ toolName: 'Read' }],
        behavior: 'allow',
        destination: 'localSettings',
      })
      expect(result.success).toBe(true)
    })
  })

  describe('setMode', () => {
    it('should parse valid setMode update', () => {
      const result = permissionUpdateSchema.safeParse({
        type: 'setMode',
        mode: 'manual',
        destination: 'session',
      })
      expect(result.success).toBe(true)
    })

    it('should parse all valid modes', () => {
      for (const mode of ['auto', 'manual', 'plan', 'bypass'] as const) {
        const result = permissionUpdateSchema.safeParse({
          type: 'setMode',
          mode,
          destination: 'session',
        })
        expect(result.success).toBe(true)
      }
    })

    it('should reject invalid mode', () => {
      const result = permissionUpdateSchema.safeParse({
        type: 'setMode',
        mode: 'superman',
        destination: 'session',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('addDirectories', () => {
    it('should parse valid addDirectories update', () => {
      const result = permissionUpdateSchema.safeParse({
        type: 'addDirectories',
        directories: ['/home/user/project', '/tmp/build'],
        destination: 'localSettings',
      })
      expect(result.success).toBe(true)
    })

    it('should reject addDirectories with missing directories', () => {
      const result = permissionUpdateSchema.safeParse({
        type: 'addDirectories',
        destination: 'session',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('removeDirectories', () => {
    it('should parse valid removeDirectories update', () => {
      const result = permissionUpdateSchema.safeParse({
        type: 'removeDirectories',
        directories: ['/tmp/build'],
        destination: 'session',
      })
      expect(result.success).toBe(true)
    })
  })

  describe('invalid type', () => {
    it('should reject unknown update type', () => {
      const result = permissionUpdateSchema.safeParse({
        type: 'unknownAction',
        something: 'value',
      })
      expect(result.success).toBe(false)
    })
  })
})

// ============================================================================
// validatePermissionUpdate helper
// ============================================================================

describe('validatePermissionUpdate()', () => {
  it('should return valid=true and data for valid input', () => {
    const result = validatePermissionUpdate({
      type: 'addRules',
      rules: [{ toolName: 'Bash' }],
      behavior: 'allow',
      destination: 'session',
    })
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.data).toBeDefined()
    expect(result.data!.type).toBe('addRules')
  })

  it('should return valid=false and errors for invalid input', () => {
    const result = validatePermissionUpdate({
      type: 'setMode',
      mode: 'unknown',
    })
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// Utility Functions
// ============================================================================

describe('extractRules()', () => {
  it('should return empty array for undefined', () => {
    expect(extractRules(undefined)).toEqual([])
  })

  it('should extract rules from addRules updates only', () => {
    const updates: PermissionUpdate[] = [
      {
        type: 'addRules',
        rules: [{ toolName: 'Bash', ruleContent: 'git *' }],
        behavior: 'allow',
        destination: 'session',
      },
      {
        type: 'setMode',
        mode: 'manual',
        destination: 'session',
      },
      {
        type: 'addRules',
        rules: [{ toolName: 'Read' }],
        behavior: 'deny',
        destination: 'userSettings',
      },
    ]
    const rules = extractRules(updates)
    expect(rules).toHaveLength(2)
    expect(rules[0]!.toolName).toBe('Bash')
    expect(rules[1]!.toolName).toBe('Read')
  })

  it('should return empty for non-addRules updates', () => {
    const updates: PermissionUpdate[] = [
      {
        type: 'setMode',
        mode: 'bypass',
        destination: 'session',
      },
      {
        type: 'addDirectories',
        directories: ['/tmp'],
        destination: 'session',
      },
    ]
    expect(extractRules(updates)).toEqual([])
  })
})

describe('hasRules()', () => {
  it('should return false for undefined', () => {
    expect(hasRules(undefined)).toBe(false)
  })

  it('should return false for updates without addRules', () => {
    const updates: PermissionUpdate[] = [
      {
        type: 'setMode',
        mode: 'plan',
        destination: 'session',
      },
    ]
    expect(hasRules(updates)).toBe(false)
  })

  it('should return true for updates with addRules', () => {
    const updates: PermissionUpdate[] = [
      {
        type: 'addRules',
        rules: [{ toolName: 'Bash' }],
        behavior: 'allow',
        destination: 'session',
      },
    ]
    expect(hasRules(updates)).toBe(true)
  })
})

describe('permissionRuleValueToString()', () => {
  it('should format rule with ruleContent', () => {
    expect(
      permissionRuleValueToString({
        toolName: 'Bash',
        ruleContent: 'git *',
      }),
    ).toBe('Bash(git *)')
  })

  it('should format rule without ruleContent', () => {
    expect(
      permissionRuleValueToString({
        toolName: 'Read',
      }),
    ).toBe('Read')
  })
})

describe('supportsPersistence()', () => {
  it('should return true for persistent sources', () => {
    expect(supportsPersistence('userSettings')).toBe(true)
    expect(supportsPersistence('projectSettings')).toBe(true)
    expect(supportsPersistence('localSettings')).toBe(true)
  })

  it('should return false for volatile sources', () => {
    expect(supportsPersistence('session')).toBe(false)
    expect(supportsPersistence('cliArg')).toBe(false)
  })
})

// ============================================================================
// Permission Update Application
// ============================================================================

describe('applyPermissionUpdate()', () => {
  it('should set mode via setMode', () => {
    const ctx = createPermissionUpdateContext('auto')
    const updated = applyPermissionUpdate(ctx, {
      type: 'setMode',
      mode: 'manual',
      destination: 'session',
    })
    expect(updated.mode).toBe('manual')
  })

  it('should add rules via addRules', () => {
    const ctx = createPermissionUpdateContext('auto')
    const updated = applyPermissionUpdate(ctx, {
      type: 'addRules',
      rules: [{ toolName: 'Bash', ruleContent: 'git *' }],
      behavior: 'allow',
      destination: 'userSettings',
    })
    expect(updated.alwaysAllowRules.userSettings).toEqual(['Bash(git *)'])
  })

  it('should add deny rules to alwaysDenyRules', () => {
    const ctx = createPermissionUpdateContext('auto')
    const updated = applyPermissionUpdate(ctx, {
      type: 'addRules',
      rules: [{ toolName: 'Bash', ruleContent: 'rm *' }],
      behavior: 'deny',
      destination: 'session',
    })
    expect(updated.alwaysDenyRules.session).toEqual(['Bash(rm *)'])
  })

  it('should add ask rules to alwaysAskRules', () => {
    const ctx = createPermissionUpdateContext('auto')
    const updated = applyPermissionUpdate(ctx, {
      type: 'addRules',
      rules: [{ toolName: 'WebFetch' }],
      behavior: 'ask',
      destination: 'session',
    })
    expect(updated.alwaysAskRules.session).toEqual(['WebFetch'])
  })

  it('should replace rules via replaceRules', () => {
    const ctx = createPermissionUpdateContext('auto')
    // First add some rules
    let updated = applyPermissionUpdate(ctx, {
      type: 'addRules',
      rules: [{ toolName: 'Read' }, { toolName: 'Glob' }],
      behavior: 'allow',
      destination: 'session',
    })
    expect(updated.alwaysAllowRules.session).toEqual(['Read', 'Glob'])

    // Then replace
    updated = applyPermissionUpdate(updated, {
      type: 'replaceRules',
      rules: [{ toolName: 'Grep' }],
      behavior: 'allow',
      destination: 'session',
    })
    expect(updated.alwaysAllowRules.session).toEqual(['Grep'])
  })

  it('should remove rules via removeRules', () => {
    const ctx = createPermissionUpdateContext('auto')
    // Add rules
    let updated = applyPermissionUpdate(ctx, {
      type: 'addRules',
      rules: [{ toolName: 'Read' }, { toolName: 'Glob' }, { toolName: 'Grep' }],
      behavior: 'allow',
      destination: 'session',
    })
    expect(updated.alwaysAllowRules.session).toHaveLength(3)

    // Remove Glob
    updated = applyPermissionUpdate(updated, {
      type: 'removeRules',
      rules: [{ toolName: 'Glob' }],
      behavior: 'allow',
      destination: 'session',
    })
    expect(updated.alwaysAllowRules.session).toEqual(['Read', 'Grep'])
  })

  it('should add directories via addDirectories', () => {
    const ctx = createPermissionUpdateContext('auto')
    const updated = applyPermissionUpdate(ctx, {
      type: 'addDirectories',
      directories: ['/home/user/project'],
      destination: 'localSettings',
    })
    expect(updated.additionalWorkingDirectories.has('/home/user/project')).toBe(true)
    const entry = updated.additionalWorkingDirectories.get('/home/user/project')
    expect(entry!.source).toBe('localSettings')
  })

  it('should remove directories via removeDirectories', () => {
    const ctx = createPermissionUpdateContext('auto')
    // Add directory
    let updated = applyPermissionUpdate(ctx, {
      type: 'addDirectories',
      directories: ['/tmp/a', '/tmp/b'],
      destination: 'session',
    })
    expect(updated.additionalWorkingDirectories.size).toBe(2)

    // Remove one
    updated = applyPermissionUpdate(updated, {
      type: 'removeDirectories',
      directories: ['/tmp/a'],
      destination: 'session',
    })
    expect(updated.additionalWorkingDirectories.size).toBe(1)
    expect(updated.additionalWorkingDirectories.has('/tmp/a')).toBe(false)
    expect(updated.additionalWorkingDirectories.has('/tmp/b')).toBe(true)
  })

  it('should not mutate the original context', () => {
    const ctx = createPermissionUpdateContext('auto')
    const updated = applyPermissionUpdate(ctx, {
      type: 'setMode',
      mode: 'manual',
      destination: 'session',
    })
    expect(ctx.mode).toBe('auto')
    expect(updated.mode).toBe('manual')
  })
})

describe('applyPermissionUpdates()', () => {
  it('should apply multiple updates in sequence', () => {
    const ctx = createPermissionUpdateContext('auto')
    const updates: PermissionUpdate[] = [
      {
        type: 'setMode',
        mode: 'manual',
        destination: 'session',
      },
      {
        type: 'addRules',
        rules: [{ toolName: 'Read' }],
        behavior: 'allow',
        destination: 'session',
      },
      {
        type: 'addDirectories',
        directories: ['/home/project'],
        destination: 'userSettings',
      },
    ]
    const result = applyPermissionUpdates(ctx, updates)
    expect(result.mode).toBe('manual')
    expect(result.alwaysAllowRules.session).toEqual(['Read'])
    expect(result.additionalWorkingDirectories.has('/home/project')).toBe(true)
  })

  it('should apply updates in order (later updates override earlier ones)', () => {
    const ctx = createPermissionUpdateContext('auto')
    const updates: PermissionUpdate[] = [
      {
        type: 'setMode',
        mode: 'manual',
        destination: 'session',
      },
      {
        type: 'setMode',
        mode: 'bypass',
        destination: 'session',
      },
    ]
    const result = applyPermissionUpdates(ctx, updates)
    expect(result.mode).toBe('bypass')
  })
})

describe('createPermissionUpdateContext()', () => {
  it('should create context with default mode', () => {
    const ctx = createPermissionUpdateContext()
    expect(ctx.mode).toBe('auto')
    expect(ctx.alwaysAllowRules).toEqual({})
    expect(ctx.alwaysDenyRules).toEqual({})
    expect(ctx.alwaysAskRules).toEqual({})
    expect(ctx.additionalWorkingDirectories.size).toBe(0)
  })

  it('should create context with specified mode', () => {
    const ctx = createPermissionUpdateContext('manual')
    expect(ctx.mode).toBe('manual')
  })
})

// ============================================================================
// createReadRuleSuggestion
// ============================================================================

describe('createReadRuleSuggestion()', () => {
  it('should create a read rule for a directory path', () => {
    const update = createReadRuleSuggestion('/home/user/project')
    expect(update).toBeDefined()
    expect(update!.type).toBe('addRules')
    expect(update!.behavior).toBe('allow')
    expect(update!.rules).toHaveLength(1)
    expect(update!.rules[0]!.toolName).toBe('Read')
    expect(update!.rules[0]!.ruleContent).toBe('//home/user/project/**')
    expect(update!.destination).toBe('session')
  })

  it('should accept a custom destination', () => {
    const update = createReadRuleSuggestion('/tmp/build', 'userSettings')
    expect(update!.destination).toBe('userSettings')
  })

  it('should return undefined for root directory', () => {
    const update = createReadRuleSuggestion('/')
    expect(update).toBeUndefined()
  })

  it('should handle relative paths', () => {
    const update = createReadRuleSuggestion('src')
    expect(update!.rules[0]!.ruleContent).toBe('src/**')
  })
})
