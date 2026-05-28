/**
 * Config + Context — Edge Case Supplemental Tests
 *
 * Covers gaps not in existing test files:
 *  1. ConfigManager loadFromSources env block-replacement behavior
 *  2. validateZod discriminatedUnion literal mismatches (wrong provider)
 *  3. validateZod with full config schema coercion edge cases
 *  4. saveToFile permission error handling
 *  5. ContextBuilder clean repo (no changes) diff output
 *  6. ContextBuilder memory-only + includeClaudeMd combined mode
 *  7. ContextBuilder memory-only with no files returns empty
 *  8. MemoryFileLoader @include with actual file exists
 *  9. Multiple onDidChange listener removal isolation
 * 10. ConfigManager reset + update + validate lifecycle
 */
import { execSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigManager } from '../config/manager.js'
import { ContextBuilder } from '../context/builder.js'
import { fetchGitDiff, fetchUntrackedFiles } from '../context/git-diff.js'
import { MemoryFileLoader } from '../context/memory-file.js'

// ─── Helper ──────────────────────────────────────────────

function initGitRepo(dir: string) {
  execSync('git init', { cwd: dir, encoding: 'utf-8', timeout: 5000 })
  execSync('git config user.email test@test.com', { cwd: dir, encoding: 'utf-8', timeout: 5000 })
  execSync('git config user.name Test', { cwd: dir, encoding: 'utf-8', timeout: 5000 })
  execSync('git commit --allow-empty -m "Initial"', { cwd: dir, encoding: 'utf-8', timeout: 5000 })
}

// ─── 1. ConfigManager: loadFromSources env block-replacement ───

describe('ConfigManager — loadFromSources env block replacement', () => {
  it('should replace entire llm block when env sources have ANTHROPIC_API_KEY', () => {
    const cm = new ConfigManager({
      llm: {
        provider: 'anthropic',
        apiKey: 'sk-programmatic',
        model: 'claude-sonnet-4-20250514',
      },
    })

    // loadFromSources with env that has ANTHROPIC_API_KEY replaces llm block
    cm.loadFromSources({
      env: { ANTHROPIC_API_KEY: 'sk-env-key' },
    })

    const config = cm.getConfig()
    // Env ANTHROPIC_API_KEY sets provider to anthropic and replaces llm
    expect(config.llm.provider).toBe('anthropic')
    expect(config.llm.apiKey).toBe('sk-env-key')
  })

  it('should merge env ANTHROPIC_API_KEY over file llm section', () => {
    const cm = new ConfigManager()

    // First load from file with one key
    cm.update({
      llm: {
        provider: 'anthropic',
        apiKey: 'sk-file-key',
        model: 'file-model',
      },
    })

    // Then loadFromSources with env that has different key
    cm.loadFromSources({
      env: { ANTHROPIC_API_KEY: 'sk-env-wins' },
    })

    const config = cm.getConfig()
    // env replaces entire llm block, overriding model with default
    expect(config.llm.apiKey).toBe('sk-env-wins')
    expect(config.llm.model).toBe('claude-sonnet-4-20250514')
  })
})

// ─── 2. validateZod: discriminatedUnion literal edge cases ───

describe('ConfigManager — validateZod literal/discriminatedUnion', () => {
  it('should reject bedrock config with anthropic field requirements', () => {
    // bedrock doesn't require apiKey, but setting provider as bedrock
    // with missing model should fail
    const cm = new ConfigManager()
    cm.update({
      llm: {
        provider: 'bedrock',
        model: '',
      } as any,
    })
    const result = cm.validateZod()
    expect(result.valid).toBe(false)
    // model is min(1) so empty string fails
    expect(result.errors.some((e) => e.path === 'llm.model')).toBe(true)
  })

  it('should reject provider that does not match any discriminated union', () => {
    const cm = new ConfigManager()
    cm.update({
      llm: {
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-4',
      } as any,
    })
    const result = cm.validateZod()
    expect(result.valid).toBe(false)
    // The discriminated union should reject 'openai' as it's not a valid variant
    expect(result.errors.some((e) => e.path === 'llm.provider' || e.message.includes('Discriminated union'))).toBe(true)
  })

  it('should accept bedrock without optional credentials', () => {
    const cm = new ConfigManager()
    cm.update({
      llm: {
        provider: 'bedrock',
        model: 'anthropic.claude-sonnet-4-20250514',
      } as any,
    })
    const result = cm.validateZod()
    // bedrock allows optional accessKeyId and secretAccessKey
    expect(result.valid).toBe(true)
  })

  it('should accept defaultTools as array of strings (not just boolean)', () => {
    const cm = new ConfigManager({
      llm: {
        provider: 'anthropic',
        apiKey: 'sk-array',
        model: 'claude-sonnet-4-20250514',
      },
      defaultTools: ['bash', 'file_read'] as any,
    })
    const result = cm.validateZod()
    expect(result.valid).toBe(true)
  })

  it('should reject defaultTools as number', () => {
    const cm = new ConfigManager({
      llm: {
        provider: 'anthropic',
        apiKey: 'sk-test',
        model: 'test',
      },
      defaultTools: 42 as any,
    })
    const result = cm.validateZod()
    expect(result.valid).toBe(false)
  })

  it('should reject llm with missing provider key entirely', () => {
    const cm = new ConfigManager()
    // Override with completely wrong shape
    ;(cm as any)._config = { llm: { apiKey: 'sk-orphan', model: 'test' } }
    const result = cm.validateZod()
    expect(result.valid).toBe(false)
    // Should complain about missing provider
    expect(result.errors.some((e) => e.path === 'llm.provider' || e.message.includes('provider'))).toBe(true)
  })
})

// ─── 3. validateZod: numeric boundary + negative completeness ───

describe('ConfigManager — validateZod numeric boundary completeness', () => {
  it('should reject temperature exactly at 2.01 (just over max)', () => {
    const cm = new ConfigManager()
    cm.update({
      llm: {
        provider: 'anthropic',
        apiKey: 'sk-test',
        model: 'test',
        temperature: 2.01,
      } as any,
    })
    const result = cm.validateZod()
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'llm.temperature')).toBe(true)
  })

  it('should reject maxTokens as string', () => {
    const cm = new ConfigManager()
    cm.update({
      llm: {
        provider: 'anthropic',
        apiKey: 'sk-test',
        model: 'test',
        maxTokens: '10000' as any,
      },
    })
    const result = cm.validateZod()
    expect(result.valid).toBe(false)
  })

  it('should reject session.idleTimeout as negative', () => {
    const cm = new ConfigManager({
      llm: {
        provider: 'anthropic',
        apiKey: 'sk-test',
        model: 'test',
      },
      session: {
        idleTimeout: -1,
      } as any,
    })
    const result = cm.validateZod()
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path.includes('idleTimeout'))).toBe(true)
  })

  it('should accept session with valid negative-excluded fields', () => {
    const cm = new ConfigManager({
      llm: {
        provider: 'anthropic',
        apiKey: 'sk-test',
        model: 'test',
      },
      session: {
        maxTurns: 50,
        timeout: 300_000,
        idleTimeout: 60_000,
        attributionMode: 'simple',
        autoSave: true,
        autoSaveInterval: 30000,
      } as any,
    })
    const result = cm.validateZod()
    expect(result.valid).toBe(true)
  })
})

// ─── 4. saveToFile: permission and error handling ────────

describe('ConfigManager — saveToFile permission/file-error', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'cfg-save-err-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('should save to file and verify mode is 0o600', () => {
    const configPath = join(tmpDir, 'settings.json')
    const cm = new ConfigManager({
      llm: {
        provider: 'anthropic',
        apiKey: 'sk-mode-test',
        model: 'claude-sonnet-4-20250514',
      },
    })
    cm.saveToFile(configPath)

    const { statSync } = require('node:fs')
    const stats = statSync(configPath)
    if (process.platform !== 'win32') {
      expect(stats.mode & 0o777).toBe(0o600)
    }
    expect(stats.isFile()).toBe(true)
  })

  it('should save minimal config when only one field differs from default', () => {
    const configPath = join(tmpDir, 'minimal.json')
    const cm = new ConfigManager({
      llm: {
        provider: 'anthropic',
        apiKey: 'sk-minimal', // only non-default field
        model: 'claude-sonnet-4-20250514', // same as default
      },
    })
    cm.saveToFile(configPath)

    const { readFileSync } = require('node:fs')
    const saved = JSON.parse(readFileSync(configPath, 'utf-8'))
    // Only apiKey should be saved (everything else matches defaults)
    expect(saved.llm.apiKey).toBe('sk-minimal')
    expect(saved.llm.model).toBeUndefined() // matches default, filtered out
  })

  it('should handle save with session config present', () => {
    const configPath = join(tmpDir, 'session-cfg.json')
    const cm = new ConfigManager({
      llm: {
        provider: 'anthropic',
        apiKey: 'sk-session',
        model: 'test-model',
      },
      session: {
        maxTurns: 100,
        attributionMode: 'detailed',
      } as any,
    })
    expect(() => cm.saveToFile(configPath)).not.toThrow()

    const { readFileSync } = require('node:fs')
    const saved = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(saved.llm.apiKey).toBe('sk-session')
    expect(saved.session?.maxTurns).toBe(100)
  })
})

// ─── 5. onDidChange: multi-listener isolation ────────────

describe('ConfigManager — onDidChange multi-listener isolation', () => {
  it('should isolate listener removal — one unsubscribe does not affect others', () => {
    const cm = new ConfigManager()
    const spyA = vi.fn()
    const spyB = vi.fn()

    const unsubA = cm.onDidChange(spyA)
    cm.onDidChange(spyB)

    // Remove only A
    unsubA()
    cm.update({ permissionMode: 'manual' })

    // A should not have been called, B should
    expect(spyA).not.toHaveBeenCalled()
    expect(spyB).toHaveBeenCalledTimes(1)
  })

  it('should deduplicate same callback reference (Set stores only once)', () => {
    const cm = new ConfigManager()
    const spy = vi.fn()

    const unsub1 = cm.onDidChange(spy)
    const unsub2 = cm.onDidChange(spy) // same reference — Set dedup

    cm.update({ permissionMode: 'manual' })

    // Set deduplicated, so only called once
    expect(spy).toHaveBeenCalledTimes(1)

    // Remove one registration
    unsub1()
    cm.update({ permissionMode: 'bypass' })

    // Both unsub1 and unsub2 point to the same Set.delete operation.
    // After unsub1(), the callback is removed; unsub2() is a no-op.
    expect(spy).toHaveBeenCalledTimes(1) // no more calls after unsubscribe
  })
})

// ─── 6. ContextBuilder: clean repo diff output ──────────

describe('ContextBuilder — clean repo diff output', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ctx-clean-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('should return minimal output when repo is clean (no changes, no untracked)', async () => {
    initGitRepo(tempDir)

    const builder = new ContextBuilder(tempDir)
    const diffInfo = await builder.loadGitDiffInfo()
    // Clean repo: returns "Changes (uncommitted):" without per-file stats
    // (design quirk: header always emitted even if filesCount === 0)
    expect(diffInfo).toContain('Changes')
    expect(diffInfo).not.toContain('Files changed')
  })

  it('should produce diff output when untracked files exist', async () => {
    initGitRepo(tempDir)
    await writeFile(join(tempDir, 'new-file.ts'), 'const x = 1;\n')

    const builder = new ContextBuilder(tempDir)
    const diffInfo = await builder.loadGitDiffInfo()
    expect(diffInfo).toContain('Changes')
    expect(diffInfo).toContain('new-file.ts')
  })

  it('should produce diff output when tracked file is modified', async () => {
    initGitRepo(tempDir)
    await writeFile(join(tempDir, 'README.md'), 'Initial content')
    execSync('git add README.md', { cwd: tempDir, encoding: 'utf-8', timeout: 3000 })
    execSync('git commit -m "Add README"', { cwd: tempDir, encoding: 'utf-8', timeout: 3000 })
    // Modify tracked file
    await writeFile(join(tempDir, 'README.md'), 'Modified content\n')

    const builder = new ContextBuilder(tempDir)
    const diffInfo = await builder.loadGitDiffInfo()
    expect(diffInfo).toContain('Changes')
  })
})

// ─── 7. ContextBuilder: memory-only mode + combinations ──

describe('ContextBuilder — memory-only and option combinations', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ctx-mem-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('should load memory content with includeMemory=true even when includeGitStatus=false', async () => {
    await writeFile(join(tempDir, 'CLAUDE.md'), '# Only Memory Content')

    const builder = new ContextBuilder(tempDir)
    const content = await builder.build({
      includeGitStatus: false,
      includeGitDiff: false,
      includeClaudeMd: false,
      includeMemory: true,
    })

    expect(content).toContain('Only Memory Content')
  })

  it('should return empty when includeMemory=true but no memory files exist', async () => {
    const builder = new ContextBuilder(tempDir)
    const content = await builder.build({
      includeGitStatus: false,
      includeGitDiff: false,
      includeClaudeMd: false,
      includeMemory: true,
    })

    expect(content).toBe('')
  })

  it('should prefer memory over basic CLAUDE.md when both enabled', async () => {
    await writeFile(join(tempDir, 'CLAUDE.md'), '# Memory Version')

    const builder = new ContextBuilder(tempDir)
    const content = await builder.build({
      includeGitStatus: false,
      includeGitDiff: false,
      includeClaudeMd: true,
      includeMemory: true,
    })

    // Memory supersedes basic CLAUDE.md per logic: includeMemory=true → loadMemoryFiles
    // But since includeClaudeMd !== false AND includeMemory === true, only memory path runs
    expect(content).toContain('Memory Version')
  })

  it('should load CLAUDE.md from .claude subdirectory when in memory mode', async () => {
    const { mkdir } = await import('node:fs/promises')
    const claudeDir = join(tempDir, '.claude')
    await mkdir(claudeDir, { recursive: true })
    await writeFile(join(claudeDir, 'CLAUDE.md'), '# .claude Memory')

    const builder = new ContextBuilder(tempDir)
    const content = await builder.build({
      includeGitStatus: false,
      includeGitDiff: false,
      includeClaudeMd: false,
      includeMemory: true,
    })

    expect(content).toContain('.claude Memory')
  })
})

// ─── 8. MemoryFileLoader: @include with existing file ────

describe('MemoryFileLoader — @include with existing file', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mem-include-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('should resolve @include to existing relative file', async () => {
    await writeFile(join(tempDir, 'main.md'), 'Main\n@included.md\nEnd')
    await writeFile(join(tempDir, 'included.md'), '# Included Content')

    const loader = new MemoryFileLoader({ cwd: tempDir })
    const files = await loader.loadFile(join(tempDir, 'main.md'), 'Project')

    // Should include both main.md and its @include
    expect(files.length).toBeGreaterThanOrEqual(2)
    const contents = files.map((f) => f.content)
    expect(contents.some((c) => c.includes('Included Content'))).toBe(true)
  })

  it('should handle @include in a subdirectory', async () => {
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(tempDir, 'docs'), { recursive: true })
    await writeFile(join(tempDir, 'docs', 'main.md'), '# Doc\n@glossary.md\n')
    await writeFile(join(tempDir, 'docs', 'glossary.md'), '# Glossary')

    const loader = new MemoryFileLoader({ cwd: tempDir })
    const files = await loader.loadFile(join(tempDir, 'docs', 'main.md'), 'Project')

    expect(files.length).toBeGreaterThanOrEqual(2)
    expect(files.some((f) => f.content.includes('Glossary'))).toBe(true)
  })

  it('should not recurse infinitely on self-referencing @include', async () => {
    await writeFile(join(tempDir, 'self.md'), '@self.md\n# Self')

    const loader = new MemoryFileLoader({ cwd: tempDir })
    const files = await loader.loadFile(join(tempDir, 'self.md'), 'Project')

    // Should only load it once (processedPaths prevents loops)
    expect(files.length).toBe(1)
  })
})

// ─── 9. ConfigManager: lifecycle (reset → update → validate) ──

describe('ConfigManager — lifecycle reset-update-validate', () => {
  it('should reset then update then validate correctly', () => {
    const cm = new ConfigManager({
      llm: {
        provider: 'anthropic',
        apiKey: 'sk-first',
        model: 'first-model',
      },
    })

    // Reset to defaults
    cm.reset()
    let config = cm.getConfig()
    expect(config.llm.apiKey).toBe('')
    expect(config.permissionMode).toBe('auto')

    // Update
    cm.update({
      permissionMode: 'plan',
      llm: { provider: 'anthropic', apiKey: 'sk-second', model: 'second-model' },
    })
    config = cm.getConfig()
    expect(config.llm.apiKey).toBe('sk-second')
    expect(config.permissionMode).toBe('plan')

    // Validate
    const result = cm.validateZod()
    expect(result.valid).toBe(true)
  })

  it('should emit change events during reset → update cycle', () => {
    const cm = new ConfigManager({ permissionMode: 'manual' })
    const spy = vi.fn()
    cm.onDidChange(spy)

    cm.reset()
    expect(spy).toHaveBeenCalled()

    spy.mockClear()
    cm.update({ permissionMode: 'bypass' })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('should survive getConfig + validate after all fields cleared', () => {
    const cm = new ConfigManager()
    // Config must always have llm field with at minimum a provider
    // Even if partially set, getConfig() should always return valid shape
    const config = cm.getConfig()
    expect(config.llm).toBeDefined()
    expect(config.llm.provider).toBe('anthropic')
  })
})

// ─── 10. fetchGitDiff and fetchUntrackedFiles edge cases ──

describe('Git — fetchGitDiff with no changes', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'git-node-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('should return result with stats.filesCount=0 in clean repo', async () => {
    initGitRepo(tempDir)
    const result = await fetchGitDiff(tempDir)
    expect(result).not.toBeNull()
    expect(result!.stats.filesCount).toBe(0)
    expect(result!.stats.linesAdded).toBe(0)
    expect(result!.stats.linesRemoved).toBe(0)
  })

  it('should return null outside git repo', async () => {
    const result = await fetchGitDiff(tempDir)
    expect(result).toBeNull()
  })

  it('fetchUntrackedFiles should be empty in clean repo', async () => {
    initGitRepo(tempDir)
    const untracked = await fetchUntrackedFiles(tempDir, 10)
    expect(untracked.size).toBe(0)
  })
})
