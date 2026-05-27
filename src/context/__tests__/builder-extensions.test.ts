/**
 * Tests — ContextBuilder Phase 2 Extensions
 *
 * Tests the enhanced ContextBuilder with git state, diff, and memory features.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ContextBuilder } from '../builder.js'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'

describe('ContextBuilder — Phase 2 Extensions', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'sdk-context-ph2-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('enhanced git status', () => {
    it('should include branch and commit info when in git repo', async () => {
      execSync('git init', { cwd: tempDir, encoding: 'utf-8', timeout: 5000 })
      execSync('git config user.email test@test.com', { cwd: tempDir, encoding: 'utf-8', timeout: 5000 })
      execSync('git config user.name Test', { cwd: tempDir, encoding: 'utf-8', timeout: 5000 })
      execSync('git commit --allow-empty -m "Initial"', { cwd: tempDir, encoding: 'utf-8', timeout: 5000 })

      const builder = new ContextBuilder(tempDir)
      const content = await builder.build({
        includeClaudeMd: false,
        includeMemory: false,
        includeGitDiff: false,
      })

      expect(content).toContain('Current branch')
      expect(content).toContain('Commit')
    })

    it('should still work when not in git repo', async () => {
      const builder = new ContextBuilder(tempDir)
      const content = await builder.build({
        includeGitStatus: true,
        includeClaudeMd: false,
        includeMemory: false,
        includeGitDiff: false,
      })
      expect(content).toBe('')
    })
  })

  describe('git diff info', () => {
    it('should include diff stats when there are changes', async () => {
      execSync('git init', { cwd: tempDir, encoding: 'utf-8', timeout: 5000 })
      execSync('git config user.email test@test.com', { cwd: tempDir, encoding: 'utf-8', timeout: 5000 })
      execSync('git config user.name Test', { cwd: tempDir, encoding: 'utf-8', timeout: 5000 })
      execSync('git commit --allow-empty -m "Initial"', { cwd: tempDir, encoding: 'utf-8', timeout: 5000 })
      await writeFile(join(tempDir, 'new-file.ts'), 'const x = 1;\n')

      const builder = new ContextBuilder(tempDir)
      const content = await builder.build({
        includeClaudeMd: false,
        includeMemory: false,
        includeGitDiff: true,
      })

      expect(content).toContain('Changes')
    })

    it('should not include diff info when disabled', async () => {
      execSync('git init', { cwd: tempDir, encoding: 'utf-8', timeout: 5000 })
      execSync('git config user.email test@test.com', { cwd: tempDir, encoding: 'utf-8', timeout: 5000 })
      execSync('git config user.name Test', { cwd: tempDir, encoding: 'utf-8', timeout: 5000 })
      execSync('git commit --allow-empty -m "Initial"', { cwd: tempDir, encoding: 'utf-8', timeout: 5000 })
      await writeFile(join(tempDir, 'new-file.ts'), 'content')

      const builder = new ContextBuilder(tempDir)
      const content = await builder.build({
        includeClaudeMd: false,
        includeMemory: false,
        includeGitDiff: false,
      })

      expect(content).not.toContain('Changes')
    })
  })

  describe('memory file integration', () => {
    it('should include CLAUDE.md content when includeMemory is true', async () => {
      await writeFile(join(tempDir, 'CLAUDE.md'), '# Project Memory\n\nKey guidelines.')

      const builder = new ContextBuilder(tempDir)
      const content = await builder.build({
        includeGitStatus: false,
        includeGitDiff: false,
        includeMemory: true,
      })

      expect(content).toContain('Project Memory')
      expect(content).toContain('Key guidelines.')
    })

    it('should exclude memory when includeMemory and includeClaudeMd are false', async () => {
      await writeFile(join(tempDir, 'CLAUDE.md'), '# Should Not Appear')

      const builder = new ContextBuilder(tempDir)
      const content = await builder.build({
        includeGitStatus: false,
        includeGitDiff: false,
        includeClaudeMd: false,
        includeMemory: false,
      })

      expect(content).toBe('')
    })

    it('should load .claude/rules/ files', async () => {
      const rulesDir = join(tempDir, '.claude', 'rules')
      await mkdir(rulesDir, { recursive: true })
      await writeFile(join(rulesDir, 'coding.md'), '# Coding Standards')

      const builder = new ContextBuilder(tempDir)
      const content = await builder.build({
        includeGitStatus: false,
        includeGitDiff: false,
        includeMemory: true,
      })

      expect(content).toContain('Coding Standards')
    })

    it('should include memory section with file path annotations', async () => {
      await writeFile(join(tempDir, 'CLAUDE.md'), '# Important Rules')

      const builder = new ContextBuilder(tempDir)
      const content = await builder.build({
        includeGitStatus: false,
        includeGitDiff: false,
        includeMemory: true,
      })

      expect(content).toContain('CLAUDE.md')
      expect(content).toContain('Important Rules')
    })
  })

  describe('combined context', () => {
    it('should combine git, diff, and memory information', async () => {
      execSync('git init', { cwd: tempDir, encoding: 'utf-8', timeout: 5000 })
      execSync('git config user.email test@test.com', { cwd: tempDir, encoding: 'utf-8', timeout: 5000 })
      execSync('git config user.name Test', { cwd: tempDir, encoding: 'utf-8', timeout: 5000 })
      execSync('git commit --allow-empty -m "Initial"', { cwd: tempDir, encoding: 'utf-8', timeout: 5000 })
      await writeFile(join(tempDir, 'CLAUDE.md'), '# Guide')
      await writeFile(join(tempDir, 'new.ts'), 'const a = 1;\n')

      const builder = new ContextBuilder(tempDir)
      const content = await builder.build({
        includeGitStatus: true,
        includeGitDiff: true,
        includeMemory: true,
      })

      expect(content).toContain('Current branch')
      expect(content).toContain('Changes')
      expect(content).toContain('Guide')
    })
  })
})
