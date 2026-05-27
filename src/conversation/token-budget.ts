/**
 * Token Budget — Token budget parsing and tracking.
 *
 * Based on Claude Code's src/utils/tokenBudget.ts.
 * Supports shorthand (+500k) and verbose (use 2M tokens) budget formats.
 */

// Shorthand: +500k at start, or " +1.5m" at end
const SHORTHAND_START_RE = /^\s*\+(\d+(?:\.\d+)?)\s*(k|m|b)\b/i
const SHORTHAND_END_RE = /\s\+(\d+(?:\.\d+)?)\s*(k|m|b)\s*[.!?]?\s*$/i
const VERBOSE_RE = /\b(?:use|spend)\s+(\d+(?:\.\d+)?)\s*(k|m|b)\s*tokens?\b/i
const VERBOSE_RE_G = new RegExp(VERBOSE_RE.source, 'gi')

const MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  m: 1_000_000,
  b: 1_000_000_000,
}

function parseBudgetMatch(value: string, suffix: string): number {
  return Number.parseFloat(value) * (MULTIPLIERS[suffix.toLowerCase()] ?? 1)
}

/**
 * Parse a token budget from text.
 * Supports formats: "+500k", "use 2M tokens", "+1.5m at end"
 * Returns the budget in tokens, or null if not found.
 */
export function parseTokenBudget(text: string): number | null {
  const startMatch = text.match(SHORTHAND_START_RE)
  if (startMatch) return parseBudgetMatch(startMatch[1]!, startMatch[2]!)
  const endMatch = text.match(SHORTHAND_END_RE)
  if (endMatch) return parseBudgetMatch(endMatch[1]!, endMatch[2]!)
  const verboseMatch = text.match(VERBOSE_RE)
  if (verboseMatch) return parseBudgetMatch(verboseMatch[1]!, verboseMatch[2]!)
  return null
}

/**
 * Find all budget-related positions in text.
 * Returns array of {start, end} positions for each match.
 */
export function findTokenBudgetPositions(text: string): Array<{ start: number; end: number }> {
  const positions: Array<{ start: number; end: number }> = []

  const startMatch = text.match(SHORTHAND_START_RE)
  if (startMatch) {
    const offset = startMatch.index! + startMatch[0].length - startMatch[0].trimStart().length
    positions.push({
      start: offset,
      end: startMatch.index! + startMatch[0].length,
    })
  }

  const endMatch = text.match(SHORTHAND_END_RE)
  if (endMatch) {
    const endStart = endMatch.index! + 1 // +1: regex includes leading \s
    const alreadyCovered = positions.some((p) => endStart >= p.start && endStart < p.end)
    if (!alreadyCovered) {
      positions.push({
        start: endStart,
        end: endMatch.index! + endMatch[0].length,
      })
    }
  }

  for (const match of text.matchAll(VERBOSE_RE_G)) {
    positions.push({ start: match.index, end: match.index + match[0].length })
  }

  return positions
}

/**
 * Generate a continuation message when token budget is reached.
 */
export function getBudgetContinuationMessage(pct: number, turnTokens: number, budget: number): string {
  const fmt = (n: number): string => new Intl.NumberFormat('en-US').format(n)
  return `Stopped at ${pct}% of token target (${fmt(turnTokens)} / ${fmt(budget)}). Keep working — do not summarize.`
}

/**
 * TokenBudget — tracks a token budget and remaining amount.
 */
export class TokenBudget {
  private _used = 0

  constructor(private readonly _budget: number) {}

  /** Get remaining budget tokens */
  get remaining(): number {
    return Math.max(0, this._budget - this._used)
  }

  /** Record token usage against the budget */
  recordUsage(usage: { inputTokens: number; outputTokens: number }): void {
    this._used += (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
  }

  /** Check if used tokens exceed a percentage threshold */
  isAboveThreshold(thresholdPct: number): boolean {
    if (this._budget <= 0) return false
    return this._used / this._budget > thresholdPct
  }

  /** Reset budget tracking */
  reset(): void {
    this._used = 0
  }
}
