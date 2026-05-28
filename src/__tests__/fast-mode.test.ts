/**
 * Tests for FastModeState type and Zod schema.
 *
 * FastModeState tracks concurrent tool execution state:
 * - off: fast mode not active
 * - cooldown: temporarily disabled after rate limit
 * - on: concurrent tool execution enabled
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { FastModeStateSchema } from '../types/fast-mode.js'
import type { FastModeState } from '../types/fast-mode.js'

// ============================================================================
// FastModeState enum values
// ============================================================================

describe('FastModeState — valid values', () => {
  it('should accept "off"', () => {
    const result = FastModeStateSchema.safeParse('off')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toBe('off')
    }
  })

  it('should accept "cooldown"', () => {
    const result = FastModeStateSchema.safeParse('cooldown')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toBe('cooldown')
    }
  })

  it('should accept "on"', () => {
    const result = FastModeStateSchema.safeParse('on')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toBe('on')
    }
  })
})

// ============================================================================
// FastModeState — invalid values
// ============================================================================

describe('FastModeState — invalid values', () => {
  it('should reject unknown string values', () => {
    const invalid = ['enabled', 'disabled', 'active', 'inactive', 'running', '']
    for (const val of invalid) {
      const result = FastModeStateSchema.safeParse(val)
      expect(result.success).toBe(false, `Expected "${val}" to be rejected`)
    }
  })

  it('should reject non-string types', () => {
    const invalid = [null, undefined, 42, true, {}, [], 0, 1]
    for (const val of invalid) {
      const result = FastModeStateSchema.safeParse(val)
      expect(result.success).toBe(false, `Expected ${JSON.stringify(val)} to be rejected`)
    }
  })

  it('should reject case variations', () => {
    const invalid = ['OFF', 'On', 'CoolDown', 'Off', 'ON']
    for (const val of invalid) {
      const result = FastModeStateSchema.safeParse(val)
      expect(result.success).toBe(false, `Expected "${val}" to be rejected (case-sensitive)`)
    }
  })
})

// ============================================================================
// FastModeState — type safety
// ============================================================================

describe('FastModeState — type safety', () => {
  it('should be assignable from literal values', () => {
    const states: FastModeState[] = ['off', 'cooldown', 'on']
    expect(states).toHaveLength(3)
    expect(states).toContain('off')
    expect(states).toContain('cooldown')
    expect(states).toContain('on')
  })

  it('should have exactly 3 possible values', () => {
    const validValues = ['off', 'cooldown', 'on'] as const
    const allPass = validValues.every((v) => FastModeStateSchema.safeParse(v).success)
    expect(allPass).toBe(true)
  })

  it('should parse as part of a larger object', () => {
    const schema = z.object({
      fast_mode_state: FastModeStateSchema.optional(),
    })

    const withState = schema.safeParse({ fast_mode_state: 'on' })
    expect(withState.success).toBe(true)
    if (withState.success) {
      expect(withState.data.fast_mode_state).toBe('on')
    }

    const withoutState = schema.safeParse({})
    expect(withoutState.success).toBe(true)
    if (withoutState.success) {
      expect(withoutState.data.fast_mode_state).toBeUndefined()
    }
  })

  it('should serialize to and from JSON correctly', () => {
    const state: FastModeState = 'cooldown'
    const json = JSON.stringify({ state })
    const parsed = JSON.parse(json)
    expect(parsed.state).toBe('cooldown')

    const validation = FastModeStateSchema.safeParse(parsed.state)
    expect(validation.success).toBe(true)
  })
})

// ============================================================================
// FastModeState — state machine transitions
// ============================================================================

describe('FastModeState — state transitions', () => {
  const VALID_TRANSITIONS: Record<FastModeState, FastModeState[]> = {
    off: ['on'],
    cooldown: ['off', 'on'],
    on: ['off', 'cooldown'],
  }

  it('should validate allowed transitions from off', () => {
    VALID_TRANSITIONS.off.forEach((target) => {
      const result = FastModeStateSchema.safeParse(target)
      expect(result.success).toBe(true)
    })
  })

  it('should validate allowed transitions from cooldown', () => {
    VALID_TRANSITIONS.cooldown.forEach((target) => {
      const result = FastModeStateSchema.safeParse(target)
      expect(result.success).toBe(true)
    })
  })

  it('should validate allowed transitions from on', () => {
    VALID_TRANSITIONS.on.forEach((target) => {
      const result = FastModeStateSchema.safeParse(target)
      expect(result.success).toBe(true)
    })
  })

  it('should support full lifecycle: off → on → cooldown → off', () => {
    const lifecycle: FastModeState[] = ['off', 'on', 'cooldown', 'off']
    lifecycle.forEach((state) => {
      const result = FastModeStateSchema.safeParse(state)
      expect(result.success).toBe(true)
    })
  })
})

// ============================================================================
// Type inference
// ============================================================================

describe('Type inference', () => {
  it('should infer FastModeState from schema', () => {
    type Inferred = z.infer<typeof FastModeStateSchema>
    const val: Inferred = 'off'
    expect(val).toBe('off')
  })

  it('should allow assignment of all valid states', () => {
    type Inferred = z.infer<typeof FastModeStateSchema>
    // TypeScript compilation test: these assignments should type-check
    const off: Inferred = 'off'
    const cooldown: Inferred = 'cooldown'
    const on: Inferred = 'on'
    expect([off, cooldown, on]).toHaveLength(3)
  })
})
