/**
 * Git Diff — Diff statistics and parsing utilities.
 *
 * Provides git diff parsing for context building.
 * Based on Claude Code's src/utils/gitDiff.ts.
 */
import { execSync } from 'node:child_process'
import { findGitRoot } from './git.js'

// ─── Types ────────────────────────────────────────────────

export interface GitDiffStats {
  filesCount: number
  linesAdded: number
  linesRemoved: number
}

export interface PerFileStats {
  added: number
  removed: number
  isBinary: boolean
  isUntracked?: boolean
}

export interface GitDiffResult {
  stats: GitDiffStats
  perFileStats: Map<string, PerFileStats>
}

// ─── Constants ────────────────────────────────────────────

const GIT_TIMEOUT_MS = 5000
const MAX_FILES = 50
const MAX_FILES_FOR_DETAILS = 500

// ─── Git Command Helper ───────────────────────────────────

function git(args: string[], cwd: string): { stdout: string; code: number } {
  try {
    const stdout = execSync(`git ${args.join(' ')}`, {
      cwd,
      encoding: 'utf-8',
      timeout: GIT_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    return { stdout, code: 0 }
  } catch (e: unknown) {
    if (e instanceof Error && 'stdout' in e) {
      return {
        stdout: (e as { stdout: string }).stdout?.toString().trim() ?? '',
        code: 1,
      }
    }
    return { stdout: '', code: 1 }
  }
}

// ─── Numstat Parser ───────────────────────────────────────

/**
 * Parse git --numstat output format: "added\tremoved\tfile\n"
 */
export function parseGitNumstat(stdout: string): {
  stats: GitDiffStats
  perFileStats: Map<string, PerFileStats>
} {
  const perFileStats = new Map<string, PerFileStats>()
  let totalAdded = 0
  let totalRemoved = 0
  let filesCount = 0

  const lines = stdout.trim().split('\n').filter(l => l.length > 0)

  for (const line of lines) {
    const parts = line.split('\t')
    if (parts.length < 3) continue

    const [addedStr, removedStr, ...filenameParts] = parts
    const filename = filenameParts.join('\t') // handle filenames with tabs
    const isBinary = addedStr === '-' && removedStr === '-'

    if (isBinary) {
      perFileStats.set(filename, { added: 0, removed: 0, isBinary: true })
      filesCount++
      continue
    }

    const added = parseInt(addedStr ?? '0', 10)
    const removed = parseInt(removedStr ?? '0', 10)

    if (isNaN(added) || isNaN(removed)) continue

    perFileStats.set(filename, { added, removed, isBinary: false })
    totalAdded += added
    totalRemoved += removed
    filesCount++
  }

  return {
    stats: { filesCount, linesAdded: totalAdded, linesRemoved: totalRemoved },
    perFileStats,
  }
}

// ─── Shortstat Parser ─────────────────────────────────────

/**
 * Parse git --shortstat output format.
 * Example: " 2 files changed, 10 insertions(+), 3 deletions(-)"
 */
export function parseShortstat(stdout: string): GitDiffStats | null {
  const trimmed = stdout.trim()
  if (!trimmed) return null

  const filesMatch = trimmed.match(/(\d+)\s+files?\s+changed/)
  const insertionsMatch = trimmed.match(/(\d+)\s+insertions?\(\+\)/)
  const deletionsMatch = trimmed.match(/(\d+)\s+deletions?\(-\)/)

  if (!filesMatch) return null

  return {
    filesCount: parseInt(filesMatch[1]!, 10),
    linesAdded: insertionsMatch ? parseInt(insertionsMatch[1]!, 10) : 0,
    linesRemoved: deletionsMatch ? parseInt(deletionsMatch[1]!, 10) : 0,
  }
}

// ─── Fetch Untracked Files ────────────────────────────────

/**
 * Get list of untracked files.
 */
export async function fetchUntrackedFiles(
  cwd: string,
  maxFiles: number = MAX_FILES,
): Promise<Map<string, PerFileStats>> {
  const root = findGitRoot(cwd)
  if (!root) return new Map()

  const { stdout } = git(['ls-files', '--others', '--exclude-standard'], cwd)
  if (!stdout) return new Map()

  const files = stdout.split('\n').filter(l => l.length > 0).slice(0, maxFiles)
  const result = new Map<string, PerFileStats>()

  for (const file of files) {
    result.set(file, { added: 0, removed: 0, isBinary: false, isUntracked: true })
  }

  return result
}

// ─── Fetch Git Diff ───────────────────────────────────────

/**
 * Fetch git diff stats comparing working tree to HEAD.
 * Returns null if not in a git repo or if git commands fail.
 */
export async function fetchGitDiff(cwd: string): Promise<GitDiffResult | null> {
  const root = findGitRoot(cwd)
  if (!root) return null

  // Quick probe using --shortstat
  const { stdout: shortstatOut, code: shortstatCode } = git(
    ['--no-optional-locks', 'diff', 'HEAD', '--shortstat'],
    cwd,
  )

  if (shortstatCode === 0) {
    const quickStats = parseShortstat(shortstatOut)
    if (quickStats && quickStats.filesCount > MAX_FILES_FOR_DETAILS) {
      // Too many files — return totals without per-file details
      return {
        stats: quickStats,
        perFileStats: new Map(),
      }
    }
  }

  // Get detailed stats via --numstat
  const { stdout: numstatOut, code: numstatCode } = git(
    ['--no-optional-locks', 'diff', 'HEAD', '--numstat'],
    cwd,
  )

  if (numstatCode !== 0) return null

  const { stats, perFileStats } = parseGitNumstat(numstatOut)

  // Include untracked files
  const remainingSlots = MAX_FILES - perFileStats.size
  if (remainingSlots > 0) {
    const untrackedStats = await fetchUntrackedFiles(cwd, remainingSlots)
    for (const [path, fileStats] of untrackedStats) {
      stats.filesCount++
      perFileStats.set(path, fileStats)
    }
  }

  return { stats, perFileStats }
}
