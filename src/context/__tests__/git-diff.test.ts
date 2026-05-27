/**
 * Tests — Git Diff
 *
 * Git diff parsing and statistics.
 */
import { describe, expect, it } from 'vitest'
import { parseGitNumstat, parseShortstat } from '../git-diff.js'

describe('parseGitNumstat', () => {
  it('should parse single file numstat output', () => {
    const result = parseGitNumstat('1\t2\tfile.ts\n')
    expect(result.stats.filesCount).toBe(1)
    expect(result.stats.linesAdded).toBe(1)
    expect(result.stats.linesRemoved).toBe(2)
    expect(result.perFileStats.size).toBe(1)
    const stats = result.perFileStats.get('file.ts')
    expect(stats).toBeDefined()
    expect(stats!.added).toBe(1)
    expect(stats!.removed).toBe(2)
  })

  it('should parse multiple files', () => {
    const output = '3\t1\tsrc/a.ts\n5\t2\tsrc/b.ts\n'
    const result = parseGitNumstat(output)
    expect(result.stats.filesCount).toBe(2)
    expect(result.stats.linesAdded).toBe(8)
    expect(result.stats.linesRemoved).toBe(3)
    expect(result.perFileStats.get('src/a.ts')?.added).toBe(3)
    expect(result.perFileStats.get('src/b.ts')?.added).toBe(5)
  })

  it('should handle binary files (tab-only entry)', () => {
    const result = parseGitNumstat('-\t-\timage.png\n')
    expect(result.stats.filesCount).toBe(1)
    const stats = result.perFileStats.get('image.png')
    expect(stats).toBeDefined()
    expect(stats!.isBinary).toBe(true)
  })

  it('should handle empty input', () => {
    const result = parseGitNumstat('')
    expect(result.stats.filesCount).toBe(0)
    expect(result.stats.linesAdded).toBe(0)
    expect(result.stats.linesRemoved).toBe(0)
    expect(result.perFileStats.size).toBe(0)
  })

  it('should handle files with spaces in names', () => {
    const result = parseGitNumstat('1\t1\t"my file.ts"\n')
    expect(result.stats.filesCount).toBe(1)
    expect(result.perFileStats.has('"my file.ts"')).toBe(true)
  })
})

describe('parseShortstat', () => {
  it('should parse standard shortstat output', () => {
    const result = parseShortstat(' 2 files changed, 10 insertions(+), 3 deletions(-)\n')
    expect(result).not.toBeNull()
    expect(result!.filesCount).toBe(2)
    expect(result!.linesAdded).toBe(10)
    expect(result!.linesRemoved).toBe(3)
  })

  it('should handle insertions only', () => {
    const result = parseShortstat(' 1 file changed, 5 insertions(+)\n')
    expect(result).not.toBeNull()
    expect(result!.filesCount).toBe(1)
    expect(result!.linesAdded).toBe(5)
    expect(result!.linesRemoved).toBe(0)
  })

  it('should handle deletions only', () => {
    const result = parseShortstat(' 1 file changed, 3 deletions(-)\n')
    expect(result).not.toBeNull()
    expect(result!.filesCount).toBe(1)
    expect(result!.linesAdded).toBe(0)
    expect(result!.linesRemoved).toBe(3)
  })

  it('should handle single file', () => {
    const result = parseShortstat(' 1 file changed, 1 insertion(+), 1 deletion(-)\n')
    expect(result).not.toBeNull()
    expect(result!.filesCount).toBe(1)
  })

  it('should return null for empty input', () => {
    expect(parseShortstat('')).toBeNull()
  })

  it('should return null for non-matching input', () => {
    expect(parseShortstat('nothing here')).toBeNull()
  })
})

describe('fetchGitDiff', () => {
  it('should export fetchGitDiff and fetchUntrackedFiles functions', async () => {
    // These are integration functions that need a real git repo
    // We just verify they're exported as functions
    const mod = await import('../git-diff.js')
    expect(typeof mod.fetchGitDiff).toBe('function')
    expect(typeof mod.fetchUntrackedFiles).toBe('function')
  })
})
