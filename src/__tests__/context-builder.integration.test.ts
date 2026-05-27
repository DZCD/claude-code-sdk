import { execSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
/**
 * Integration Tests — ContextBuilder
 *
 * Tests context building with mock git commands and CLAUDE.md.
 * Uses vitest mocks for filesystem and child_process.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContextBuilder } from '../context/builder.js'

// ─── Tests ───────────────────────────────────────────────

describe('ContextBuilder Integration', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'sdk-context-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('CLAUDE.md loading', () => {
    it('should load CLAUDE.md from project root', async () => {
      await writeFile(join(tempDir, 'CLAUDE.md'), '# Project Guide\n\nThis is a test project.')

      const builder = new ContextBuilder(tempDir)
      const content = await builder.build({
        includeGitStatus: false,
        includeClaudeMd: true,
      })

      expect(content).toContain('Project Guide')
      expect(content).toContain('test project')
    })

    it('should load CLAUDE.md from .claude subdirectory', async () => {
      const claudeDir = join(tempDir, '.claude')
      const { mkdir } = await import('node:fs/promises')
      await mkdir(claudeDir, { recursive: true })
      await writeFile(join(claudeDir, 'CLAUDE.md'), '# Nested Guide')

      const builder = new ContextBuilder(tempDir)
      const content = await builder.build({
        includeGitStatus: false,
        includeClaudeMd: true,
      })

      expect(content).toContain('Nested Guide')
    })

    it('should return empty string when no CLAUDE.md exists', async () => {
      const builder = new ContextBuilder(tempDir)
      const content = await builder.build({
        includeGitStatus: false,
        includeClaudeMd: true,
      })

      expect(content).toBe('')
    })

    it('should skip CLAUDE.md when includeClaudeMd is false', async () => {
      await writeFile(join(tempDir, 'CLAUDE.md'), '# Should Not Appear')

      const builder = new ContextBuilder(tempDir)
      const content = await builder.build({
        includeGitStatus: false,
        includeClaudeMd: false,
      })

      expect(content).toBe('')
    })
  })

  describe('git status integration', () => {
    it('should include git status when available', async () => {
      // Initialize a git repo and make changes
      try {
        execSync('git init', {
          cwd: tempDir,
          encoding: 'utf-8',
          timeout: 3000,
        })
        execSync('git config user.email test@test.com', {
          cwd: tempDir,
          encoding: 'utf-8',
          timeout: 3000,
        })
        execSync('git config user.name Test', {
          cwd: tempDir,
          encoding: 'utf-8',
          timeout: 3000,
        })
        await writeFile(join(tempDir, 'test.txt'), 'content')
      } catch {
        // Git not available — skip this test
        return
      }

      const builder = new ContextBuilder(tempDir)
      const content = await builder.build({
        includeGitStatus: true,
        includeClaudeMd: false,
      })

      expect(content).toContain('Current branch')
    })

    it('should return empty string when not in git repo', async () => {
      // tempDir is not a git repo
      const builder = new ContextBuilder(tempDir)
      const content = await builder.build({
        includeGitStatus: true,
        includeClaudeMd: false,
      })

      expect(content).toBe('')
    })

    it('should skip git status when includeGitStatus is false', async () => {
      const builder = new ContextBuilder(tempDir)
      const content = await builder.build({
        includeGitStatus: false,
        includeClaudeMd: false,
      })

      expect(content).toBe('')
    })
  })

  describe('custom prefix and suffix', () => {
    it('should prepend custom prefix', async () => {
      const builder = new ContextBuilder(tempDir)
      const content = await builder.build({
        includeGitStatus: false,
        includeClaudeMd: false,
        customPrefix: 'PREFIX_CONTENT',
      })

      expect(content).toContain('PREFIX_CONTENT')
      expect(content.startsWith('PREFIX_CONTENT')).toBe(true)
    })

    it('should append custom suffix', async () => {
      const builder = new ContextBuilder(tempDir)
      const content = await builder.build({
        includeGitStatus: false,
        includeClaudeMd: false,
        customSuffix: 'SUFFIX_CONTENT',
      })

      expect(content).toContain('SUFFIX_CONTENT')
      expect(content.endsWith('SUFFIX_CONTENT')).toBe(true)
    })

    it('should include both prefix and suffix with content in between', async () => {
      await writeFile(join(tempDir, 'CLAUDE.md'), 'MIDDLE_CONTENT')

      const builder = new ContextBuilder(tempDir)
      const content = await builder.build({
        includeGitStatus: false,
        includeClaudeMd: true,
        customPrefix: 'PREFIX',
        customSuffix: 'SUFFIX',
      })

      expect(content).toContain('PREFIX')
      expect(content).toContain('MIDDLE_CONTENT')
      expect(content).toContain('SUFFIX')
    })
  })

  describe('loadFile', () => {
    it('should load a file by absolute path', async () => {
      await writeFile(join(tempDir, 'config.json'), '{"key": "value"}')

      const builder = new ContextBuilder(tempDir)
      const content = await builder.build({
        includeGitStatus: false,
        includeClaudeMd: false,
      })

      // loadFile is a separate method
      const fileContent = await builder.loadFile(join(tempDir, 'config.json'))
      expect(fileContent).toBe('{"key": "value"}')
    })

    it('should load a file by relative path', async () => {
      await writeFile(join(tempDir, 'notes.txt'), 'Hello Notes')

      const builder = new ContextBuilder(tempDir)
      const fileContent = await builder.loadFile('notes.txt')
      expect(fileContent).toBe('Hello Notes')
    })

    it('should return null for non-existent file', async () => {
      const builder = new ContextBuilder(tempDir)
      const fileContent = await builder.loadFile('/nonexistent/file.txt')
      expect(fileContent).toBeNull()
    })
  })
})
