import { execSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
/**
 * Tests — Git Utils
 *
 * Git repository information utilities.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// Import git utilities
import { findGitRoot, getBranch, getFileStatus, getGitState, getHead, getRemoteUrl } from '../git.js'

function initGitRepo(dir: string, remoteUrl?: string) {
  execSync('git init', { cwd: dir, encoding: 'utf-8', timeout: 5000 })
  execSync('git config user.email test@test.com', {
    cwd: dir,
    encoding: 'utf-8',
    timeout: 5000,
  })
  execSync('git config user.name Test', {
    cwd: dir,
    encoding: 'utf-8',
    timeout: 5000,
  })
  if (remoteUrl) {
    execSync(`git remote add origin ${remoteUrl}`, {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 5000,
    })
  }
  // Make an initial commit so there's a HEAD
  execSync('git commit --allow-empty -m "Initial"', {
    cwd: dir,
    encoding: 'utf-8',
    timeout: 5000,
  })
}

describe('findGitRoot', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'sdk-git-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('should find git root from inside a repo', () => {
    initGitRepo(tempDir)
    const root = findGitRoot(tempDir)
    expect(root).toBe(tempDir)
  })

  it('should find git root from a subdirectory', () => {
    initGitRepo(tempDir)
    const subDir = join(tempDir, 'a', 'b', 'c')
    execSync(`mkdir -p ${subDir}`, { encoding: 'utf-8', timeout: 3000 })
    const root = findGitRoot(subDir)
    expect(root).toBe(tempDir)
  })

  it('should return null when not in a git repo', () => {
    const root = findGitRoot(tempDir)
    expect(root).toBeNull()
  })
})

describe('getBranch', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'sdk-git-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('should get current branch name', async () => {
    initGitRepo(tempDir)
    const branch = await getBranch(tempDir)
    expect(branch).toBeTruthy()
  })

  it('should return empty string outside git repo', async () => {
    const branch = await getBranch(tempDir)
    expect(branch).toBe('')
  })
})

describe('getHead', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'sdk-git-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('should get current commit hash', async () => {
    initGitRepo(tempDir)
    const head = await getHead(tempDir)
    expect(head).toMatch(/^[a-f0-9]+$/)
  })

  it('should return empty string outside git repo', async () => {
    const head = await getHead(tempDir)
    expect(head).toBe('')
  })
})

describe('getRemoteUrl', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'sdk-git-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('should get remote URL when set', async () => {
    initGitRepo(tempDir, 'https://github.com/user/repo.git')
    const url = await getRemoteUrl(tempDir)
    expect(url).toContain('github.com')
  })

  it('should return null when no remote', async () => {
    initGitRepo(tempDir) // no remote
    const url = await getRemoteUrl(tempDir)
    expect(url).toBeNull()
  })
})

describe('getGitState', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'sdk-git-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('should return full git state in a repo', async () => {
    initGitRepo(tempDir, 'https://github.com/user/repo.git')
    const state = await getGitState(tempDir)
    expect(state).not.toBeNull()
    expect(state!.branchName).toBeTruthy()
    expect(state!.commitHash).toMatch(/^[a-f0-9]+$/)
    expect(state!.remoteUrl).toContain('github.com')
    expect(typeof state!.isClean).toBe('boolean')
    expect(typeof state!.worktreeCount).toBe('number')
  })

  it('should return null outside git repo', async () => {
    const state = await getGitState(tempDir)
    expect(state).toBeNull()
  })

  it('should detect dirty working tree', async () => {
    initGitRepo(tempDir)
    await writeFile(join(tempDir, 'new-file.txt'), 'content')
    const state = await getGitState(tempDir)
    expect(state).not.toBeNull()
    expect(state!.isClean).toBe(false)
  })
})

describe('getFileStatus', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'sdk-git-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('should list tracked and untracked files', async () => {
    initGitRepo(tempDir)
    await writeFile(join(tempDir, 'untracked.txt'), 'new content')
    const status = await getFileStatus(tempDir)
    expect(status.untracked).toContain('untracked.txt')
    expect(Array.isArray(status.tracked)).toBe(true)
  })

  it('should return empty arrays outside git repo', async () => {
    const status = await getFileStatus(tempDir)
    expect(status.tracked).toEqual([])
    expect(status.untracked).toEqual([])
  })
})
