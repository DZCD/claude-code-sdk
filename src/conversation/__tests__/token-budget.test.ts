/**
 * Tests — TokenBudget
 *
 * Token budget parsing and tracking.
 */
import { describe, expect, it } from 'vitest'
import {
  TokenBudget,
  findTokenBudgetPositions,
  getBudgetContinuationMessage,
  parseTokenBudget,
} from '../token-budget.js'

describe('parseTokenBudget', () => {
  it('should parse shorthand at start: +500k', () => {
    expect(parseTokenBudget('+500k')).toBe(500_000)
  })

  it('should parse shorthand at start: +2M', () => {
    expect(parseTokenBudget('+2M')).toBe(2_000_000)
  })

  it('should parse shorthand at end', () => {
    expect(parseTokenBudget('budget +1.5m')).toBe(1_500_000)
  })

  it('should parse verbose form: use 500k tokens', () => {
    expect(parseTokenBudget('use 500k tokens')).toBe(500_000)
  })

  it('should parse verbose form: spend 2M tokens', () => {
    expect(parseTokenBudget('spend 2M tokens')).toBe(2_000_000)
  })

  it('should return null for text without budget', () => {
    expect(parseTokenBudget('hello world')).toBeNull()
  })

  it('should return null for empty string', () => {
    expect(parseTokenBudget('')).toBeNull()
  })
})

describe('findTokenBudgetPositions', () => {
  it('should find start shorthand position', () => {
    const positions = findTokenBudgetPositions('+500k tokens')
    expect(positions).toHaveLength(1)
    expect(positions[0]!.start).toBe(0)
    expect(positions[0]!.end).toBe(5)
  })

  it('should find end shorthand position', () => {
    const positions = findTokenBudgetPositions('budget +1k')
    expect(positions).toHaveLength(1)
    expect(positions[0]!.start).toBeGreaterThan(0)
  })

  it('should find verbose positions', () => {
    const positions = findTokenBudgetPositions('use 500k tokens please')
    expect(positions.length).toBeGreaterThanOrEqual(1)
  })

  it('should find multiple positions', () => {
    const positions = findTokenBudgetPositions('+500k use 2M tokens')
    expect(positions.length).toBeGreaterThanOrEqual(2)
  })

  it('should return empty array for text without budget', () => {
    expect(findTokenBudgetPositions('hello world')).toEqual([])
  })
})

describe('getBudgetContinuationMessage', () => {
  it('should generate continuation message with correct values', () => {
    const msg = getBudgetContinuationMessage(85, 17000, 20000)
    expect(msg).toContain('85%')
    expect(msg).toContain('17,000')
    expect(msg).toContain('20,000')
    expect(msg).toContain('Keep working')
  })
})

describe('TokenBudget', () => {
  it('should track remaining budget', () => {
    const budget = new TokenBudget(100000)
    expect(budget.remaining).toBe(100000)
  })

  it('should decrease remaining after recording usage', () => {
    const budget = new TokenBudget(100000)
    budget.recordUsage({ inputTokens: 30000, outputTokens: 10000 })
    expect(budget.remaining).toBe(60000)
  })

  it('should detect threshold exceeded', () => {
    const budget = new TokenBudget(100000)
    budget.recordUsage({ inputTokens: 80000, outputTokens: 10000 })
    expect(budget.isAboveThreshold(0.8)).toBe(true)
  })

  it('should not trigger threshold when under limit', () => {
    const budget = new TokenBudget(100000)
    budget.recordUsage({ inputTokens: 50000, outputTokens: 10000 })
    expect(budget.isAboveThreshold(0.8)).toBe(false)
  })

  it('should reset', () => {
    const budget = new TokenBudget(100000)
    budget.recordUsage({ inputTokens: 50000, outputTokens: 10000 })
    budget.reset()
    expect(budget.remaining).toBe(100000)
  })

  it('should not go below zero remaining', () => {
    const budget = new TokenBudget(1000)
    budget.recordUsage({ inputTokens: 2000, outputTokens: 500 })
    expect(budget.remaining).toBe(0)
  })
})
