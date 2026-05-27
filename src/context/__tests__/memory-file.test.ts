import { execSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
/**
 * Tests — Memory File Loader
 *
 * Memory file loading with multi-level directory traversal and @include support.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MemoryFileLoader } from '../memory-file.js'

describe('MemoryFileLoader', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'sdk-memory-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('loadFile', () => {
    it('should load a single CLAUDE.md file', async () => {
      await writeFile(join(tempDir, 'CLAUDE.md'), '# Project Guide\n\nThis is the project.')
      const loader = new MemoryFileLoader({ cwd: tempDir })
      const files = await loader.loadFile(join(tempDir, 'CLAUDE.md'), 'Project')
      expect(files).toHaveLength(1)
      expect(files[0]!.content).toContain('Project Guide')
      expect(files[0]!.type).toBe('Project')
    })

    it('should return empty array for non-existent file', async () => {
      const loader = new MemoryFileLoader({ cwd: tempDir })
      const files = await loader.loadFile('/nonexistent/CLAUDE.md', 'Project')
      expect(files).toEqual([])
    })
  })

  describe('resolveIncludes', () => {
    it('should find @include directives in content', async () => {
      await writeFile(join(tempDir, 'include-me.md'), '# Included Content')
      const loader = new MemoryFileLoader({ cwd: tempDir })
      const paths = loader.resolveIncludes('Some text\n@include-me.md\nmore text', tempDir, new Set())
      expect(paths).toHaveLength(1)
    })

    it('should not include files outside project', async () => {
      const loader = new MemoryFileLoader({ cwd: tempDir })
      const paths = loader.resolveIncludes('Hello @/etc/passwd world', tempDir, new Set())
      // Absolute paths outside project should be excluded for security
      expect(paths).toHaveLength(0)
    })

    it('should not process content inside code blocks', async () => {
      const loader = new MemoryFileLoader({ cwd: tempDir })
      const paths = loader.resolveIncludes('```\n@include-me.md\n```', tempDir, new Set())
      expect(paths).toHaveLength(0)
    })

    it('should skip already processed paths', async () => {
      const loader = new MemoryFileLoader({ cwd: tempDir })
      const processed = new Set([join(tempDir, 'already-done.md')])
      const paths = loader.resolveIncludes('Check @already-done.md', tempDir, processed)
      expect(paths).toHaveLength(0)
    })
  })

  describe('loadMultiLevelClaudeMd', () => {
    it('should find CLAUDE.md in current directory', async () => {
      await writeFile(join(tempDir, 'CLAUDE.md'), '# Root Guide')
      const loader = new MemoryFileLoader({ cwd: tempDir })
      const files = await loader.loadMultiLevelClaudeMd()
      expect(files.some((f) => f.content.includes('Root Guide'))).toBe(true)
    })

    it('should find CLAUDE.md from subdirectory up to git root', async () => {
      // Init git repo
      execSync('git init', { cwd: tempDir, encoding: 'utf-8', timeout: 5000 })
      await writeFile(join(tempDir, 'CLAUDE.md'), '# Root Guide')

      // Create subdirectory
      const subDir = join(tempDir, 'src', 'components')
      await mkdir(subDir, { recursive: true })
      await writeFile(join(subDir, 'CLAUDE.md'), '# Component Guide')

      const loader = new MemoryFileLoader({ cwd: subDir })
      const files = await loader.loadMultiLevelClaudeMd()
      // Should find both the closest one and the root one
      const contents = files.map((f) => f.content)
      expect(contents.some((c) => c.includes('Component Guide'))).toBe(true)
      expect(contents.some((c) => c.includes('Root Guide'))).toBe(true)
    })

    it('should load CLAUDE.local.md if present', async () => {
      await writeFile(join(tempDir, 'CLAUDE.md'), '# Project Guide')
      await writeFile(join(tempDir, 'CLAUDE.local.md'), '# Local Override')
      const loader = new MemoryFileLoader({ cwd: tempDir })
      const files = await loader.loadMultiLevelClaudeMd()
      const contents = files.map((f) => f.content)
      expect(contents.some((c) => c.includes('Local Override'))).toBe(true)
    })
  })

  describe('loadRules', () => {
    it('should load .md files from .claude/rules/', async () => {
      const rulesDir = join(tempDir, '.claude', 'rules')
      await mkdir(rulesDir, { recursive: true })
      await writeFile(join(rulesDir, 'coding.md'), '# Coding Standards')
      await writeFile(join(rulesDir, 'testing.md'), '# Testing Guide')

      const loader = new MemoryFileLoader({ cwd: tempDir })
      const files = await loader.loadRules(rulesDir)
      expect(files).toHaveLength(2)
    })

    it('should return empty array if rules dir does not exist', async () => {
      const loader = new MemoryFileLoader({ cwd: tempDir })
      const files = await loader.loadRules(join(tempDir, '.claude', 'rules'))
      expect(files).toEqual([])
    })
  })

  describe('loadAll', () => {
    it('should load all memory files', async () => {
      await writeFile(join(tempDir, 'CLAUDE.md'), '# Project Guide')
      const rulesDir = join(tempDir, '.claude', 'rules')
      await mkdir(rulesDir, { recursive: true })
      await writeFile(join(rulesDir, 'style.md'), '# Style Guide')

      const loader = new MemoryFileLoader({ cwd: tempDir })
      const files = await loader.loadAll()
      // Should at least find the project CLAUDE.md
      expect(files.length).toBeGreaterThanOrEqual(1)
      expect(files.some((f) => f.content.includes('Project Guide'))).toBe(true)
    })
  })
})
