/**
 * Tests — Context Module Edge Cases
 *
 * Covers: Git diff large files, empty repos, non-Git directories,
 * MemoryFile boundary cases, git state special scenarios.
 */
import { execSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ContextBuilder } from '../builder.js'
import { fetchGitDiff, fetchUntrackedFiles, parseGitNumstat, parseShortstat } from '../git-diff.js'
import { findGitRoot, getFileStatus, getGitState } from '../git.js'
import { MemoryFileLoader } from '../memory-file.js'

// ─── Helper ──────────────────────────────────────────────

function initGitRepo(dir: string, remoteUrl?: string) {
  execSync('git init', { cwd: dir, encoding: 'utf-8', timeout: 5000 })
  execSync('git config user.email test@test.com', { cwd: dir, encoding: 'utf-8', timeout: 5000 })
  execSync('git config user.name Test', { cwd: dir, encoding: 'utf-8', timeout: 5000 })
  if (remoteUrl) {
    execSync(`git remote add origin ${remoteUrl}`, { cwd: dir, encoding: 'utf-8', timeout: 5000 })
  }
  execSync('git commit --allow-empty -m "Initial"', { cwd: dir, encoding: 'utf-8', timeout: 5000 })
}

// ─── Git Diff Edge Cases ─────────────────────────────────

describe('Git Diff — Large Files & Edge Cases', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'sdk-diff-edge-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('should handle very large added lines in numstat', () => {
    const result = parseGitNumstat(`99999\t0\thuge-file.ts\n`)
    expect(result.stats.filesCount).toBe(1)
    expect(result.stats.linesAdded).toBe(99999)
    expect(result.stats.linesRemoved).toBe(0)
  })

  it('should handle many files in numstat (>50)', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `1\t0\tfile-${i}.ts\n`).join('')
    const result = parseGitNumstat(lines)
    expect(result.stats.filesCount).toBe(100)
    expect(result.stats.linesAdded).toBe(100)
  })

  it('should handle files with special characters in names', () => {
    const result = parseGitNumstat('1\t1\t"file with spaces.ts"\n')
    expect(result.stats.filesCount).toBe(1)
    expect(result.perFileStats.has('"file with spaces.ts"')).toBe(true)
  })

  it('should handle numstat with tabs in filename', () => {
    // Tabs in filename are unusual but should be handled
    const result = parseGitNumstat('1\t1\tsrc/main\tfile.ts\n')
    expect(result.stats.filesCount).toBe(1)
    expect(result.perFileStats.size).toBe(1)
  })

  it('should handle shortstat with single insertion (singular)', () => {
    const result = parseShortstat(' 1 file changed, 1 insertion(+)\n')
    expect(result).not.toBeNull()
    expect(result!.filesCount).toBe(1)
    expect(result!.linesAdded).toBe(1)
    expect(result!.linesRemoved).toBe(0)
  })

  it('should handle shortstat with single deletion (singular)', () => {
    const result = parseShortstat(' 1 file changed, 1 deletion(-)\n')
    expect(result).not.toBeNull()
    expect(result!.filesCount).toBe(1)
    expect(result!.linesAdded).toBe(0)
    expect(result!.linesRemoved).toBe(1)
  })

  it('should handle fetchGitDiff in an empty git repo (no HEAD)', async () => {
    execSync('git init', { cwd: tempDir, encoding: 'utf-8', timeout: 5000 })
    // No commits — diff HEAD should fail gracefully
    const result = await fetchGitDiff(tempDir)
    expect(result).toBeNull()
  })

  it('should handle fetchGitDiff outside git repo', async () => {
    const result = await fetchGitDiff(tempDir)
    expect(result).toBeNull()
  })

  it('should fetch untracked files but not overflow beyond maxFiles', async () => {
    initGitRepo(tempDir)
    // Create more than max files
    for (let i = 0; i < 60; i++) {
      await writeFile(join(tempDir, `untracked-${i}.txt`), 'content')
    }
    const untracked = await fetchUntrackedFiles(tempDir, 50)
    expect(untracked.size).toBeLessThanOrEqual(50)
  })

  it('should return empty map for fetchUntrackedFiles outside git repo', async () => {
    const untracked = await fetchUntrackedFiles(tempDir)
    expect(untracked.size).toBe(0)
  })

  it('should handle fetchGitDiff with only untracked files (no committed diff)', async () => {
    initGitRepo(tempDir)
    await writeFile(join(tempDir, 'new-file.ts'), 'const x = 1;\n')
    const result = await fetchGitDiff(tempDir)
    expect(result).not.toBeNull()
    expect(result!.stats.filesCount).toBeGreaterThanOrEqual(1)
  })
})

// ─── Git State Edge Cases ────────────────────────────────

describe('Git State — Special Scenarios', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'sdk-git-edge-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('should handle findGitRoot in root path', () => {
    initGitRepo(tempDir)
    const root = findGitRoot(tempDir)
    expect(root).toBe(tempDir)
  })

  it('should handle findGitRoot in system root (/)', () => {
    // Should not crash; returns null (or the root if there's a .git there)
    const root = findGitRoot('/')
    // Might be null or a valid path, but should not throw
    expect(typeof root === 'string' || root === null).toBe(true)
  })

  it('should handle getFileStatus with many untracked files', async () => {
    initGitRepo(tempDir)
    for (let i = 0; i < 100; i++) {
      await writeFile(join(tempDir, `file-${i}.txt`), 'content')
    }
    const status = await getFileStatus(tempDir)
    expect(status.untracked.length).toBe(100)
    expect(status.tracked.length).toBe(0)
  })

  it('should handle getFileStatus when repo is clean', async () => {
    initGitRepo(tempDir)
    const status = await getFileStatus(tempDir)
    expect(status.untracked).toEqual([])
    expect(status.tracked).toEqual([])
  })

  it('should handle getFileStatus outside git repo', async () => {
    const status = await getFileStatus(tempDir)
    expect(status.tracked).toEqual([])
    expect(status.untracked).toEqual([])
  })

  it('should detect that empty git repo has clean working tree', async () => {
    execSync('git init', { cwd: tempDir, encoding: 'utf-8', timeout: 5000 })
    const state = await getGitState(tempDir)
    // No commits yet - state should handle this gracefully
    if (state) {
      expect(typeof state.isClean).toBe('boolean')
    }
  })
})

// ─── MemoryFile Boundary Cases ───────────────────────────

describe('MemoryFile — Boundary Cases', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'sdk-memory-edge-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('should handle empty CLAUDE.md file', async () => {
    await writeFile(join(tempDir, 'CLAUDE.md'), '')
    const loader = new MemoryFileLoader({ cwd: tempDir })
    const files = await loader.loadFile(join(tempDir, 'CLAUDE.md'), 'Project')
    expect(files).toHaveLength(1)
    expect(files[0]!.content).toBe('')
  })

  it('should handle CLAUDE.md with only whitespace', async () => {
    await writeFile(join(tempDir, 'CLAUDE.md'), '   \n  \n  ')
    const loader = new MemoryFileLoader({ cwd: tempDir })
    const files = await loader.loadFile(join(tempDir, 'CLAUDE.md'), 'Project')
    expect(files).toHaveLength(1)
    expect(files[0]!.content.trim()).toBe('')
  })

  it('should handle deeply nested directories without git root', async () => {
    const deepDir = join(tempDir, 'a', 'b', 'c', 'd')
    await mkdir(deepDir, { recursive: true })
    await writeFile(join(deepDir, 'CLAUDE.md'), '# Deep Guide')

    const loader = new MemoryFileLoader({ cwd: deepDir })
    const files = await loader.loadMultiLevelClaudeMd()
    // Should find the CLAUDE.md at the deepest level
    expect(files.some((f) => f.content.includes('Deep Guide'))).toBe(true)
  })

  it('should handle @include directive with non-existent file', async () => {
    await writeFile(join(tempDir, 'CLAUDE.md'), 'Check @nonexistent-file.md')
    const loader = new MemoryFileLoader({ cwd: tempDir })
    const paths = loader.resolveIncludes('Check @nonexistent-file.md', tempDir, new Set())
    expect(paths).toHaveLength(0)
  })

  it('should handle @include with ~/ path (expanded to homedir)', async () => {
    const loader = new MemoryFileLoader({ cwd: tempDir })
    const paths = loader.resolveIncludes('Check @~/some-file.md', tempDir, new Set())
    // ~/ is expanded but file likely doesn't exist, so no paths
    expect(paths).toHaveLength(0)
  })

  it('should not include absolute paths in resolveIncludes (security)', async () => {
    const loader = new MemoryFileLoader({ cwd: tempDir })
    const paths = loader.resolveIncludes('Check @/etc/passwd', tempDir, new Set())
    expect(paths).toHaveLength(0)
  })

  it('should handle loadAll with no files at all', async () => {
    const loader = new MemoryFileLoader({ cwd: tempDir })
    const files = await loader.loadAll()
    // Should at least not crash
    expect(Array.isArray(files)).toBe(true)
  })

  it('should handle loadRules with nested non-md files', async () => {
    const rulesDir = join(tempDir, '.claude', 'rules')
    await mkdir(rulesDir, { recursive: true })
    await writeFile(join(rulesDir, 'note.txt'), 'Not a markdown file')
    await writeFile(join(rulesDir, 'readme.md'), '# Rule')
    await mkdir(join(rulesDir, 'subdir'), { recursive: true })

    const loader = new MemoryFileLoader({ cwd: tempDir })
    const files = await loader.loadRules(rulesDir)
    // Should only pick up .md files, not .txt or subdirectories
    expect(files).toHaveLength(1)
    expect(files[0]!.content).toContain('Rule')
  })

  it('should handle loadRules with empty directory', async () => {
    const rulesDir = join(tempDir, '.claude', 'rules')
    await mkdir(rulesDir, { recursive: true })
    // No files in rules dir
    const loader = new MemoryFileLoader({ cwd: tempDir })
    const files = await loader.loadRules(rulesDir)
    expect(files).toHaveLength(0)
  })

  it('should handle loadAll with only rules and no CLAUDE.md', async () => {
    const rulesDir = join(tempDir, '.claude', 'rules')
    await mkdir(rulesDir, { recursive: true })
    await writeFile(join(rulesDir, 'style.md'), '# Style Guide')

    const loader = new MemoryFileLoader({ cwd: tempDir })
    const files = await loader.loadAll()
    expect(files.length).toBeGreaterThanOrEqual(1)
    expect(files.some((f) => f.content.includes('Style Guide'))).toBe(true)
  })

  it('should handle @include loop prevention (circular references)', async () => {
    // Two files including each other
    await writeFile(join(tempDir, 'a.md'), 'Include @b.md')
    await writeFile(join(tempDir, 'b.md'), 'Include @a.md')

    const loader = new MemoryFileLoader({ cwd: tempDir })
    const files = await loader.loadFile(join(tempDir, 'a.md'), 'Project')
    // Should not loop infinitely, max depth is MAX_INCLUDE_DEPTH=10
    expect(files.length).toBeGreaterThanOrEqual(1)
    expect(files.length).toBeLessThanOrEqual(11) // a + b alternations up to depth limit
  })
})

// ─── ContextBuilder Edge Cases ───────────────────────────

describe('ContextBuilder — Render Edge Cases', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'sdk-cb-edge-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('should handle build with all options disabled', async () => {
    const builder = new ContextBuilder(tempDir)
    const content = await builder.build({
      includeGitStatus: false,
      includeClaudeMd: false,
      includeMemory: false,
      includeGitDiff: false,
    })
    expect(content).toBe('')
  })

  it('should handle build with custom prefix and suffix only', async () => {
    const builder = new ContextBuilder(tempDir)
    const content = await builder.build({
      includeGitStatus: false,
      includeClaudeMd: false,
      includeMemory: false,
      includeGitDiff: false,
      customPrefix: 'PREFIX',
      customSuffix: 'SUFFIX',
    })
    expect(content).toBe('PREFIX\n\nSUFFIX')
  })

  it('should handle loadFile with non-absolute path starting with /', async () => {
    const builder = new ContextBuilder(tempDir)
    // Absolute path to non-existent file
    const content = await builder.loadFile('/nonexistent/path/file.txt')
    expect(content).toBeNull()
  })

  it('should handle loadGitStatus when git not available', async () => {
    const builder = new ContextBuilder(tempDir)
    // tempDir is not a git repo
    const result = await builder.loadGitStatus()
    expect(result).toBe('')
  })

  it('should handle loadGitDiffInfo when git not available', async () => {
    const builder = new ContextBuilder(tempDir)
    const result = await builder.loadGitDiffInfo()
    expect(result).toBe('')
  })

  it('should combine prefix, suffix, and CLAUDE.md', async () => {
    await writeFile(join(tempDir, 'CLAUDE.md'), '## Project Rules')
    const builder = new ContextBuilder(tempDir)
    const content = await builder.build({
      includeGitStatus: false,
      includeClaudeMd: true,
      includeMemory: false,
      includeGitDiff: false,
      customPrefix: 'START',
      customSuffix: 'END',
    })
    expect(content).toContain('START')
    expect(content).toContain('Project Rules')
    expect(content).toContain('END')
  })
})
