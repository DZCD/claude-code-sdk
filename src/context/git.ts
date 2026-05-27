/**
 * Git Utils — Git repository information utilities.
 *
 * Provides Git repository discovery and state querying.
 * Based on Claude Code's src/utils/git.ts.
 */
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname, resolve, sep } from 'node:path'

// ─── Types ────────────────────────────────────────────────

export interface GitRepoState {
  commitHash: string
  branchName: string
  remoteUrl: string | null
  isHeadOnRemote: boolean
  isClean: boolean
  worktreeCount: number
}

export interface FileStatusResult {
  tracked: string[]
  untracked: string[]
}

// ─── Git Root Discovery ───────────────────────────────────

/**
 * Find the git root by walking up the directory tree.
 * Looks for a .git directory or file (worktrees/submodules).
 * Returns the directory containing .git, or null if not found.
 */
export function findGitRoot(startPath: string): string | null {
  let current = resolve(startPath)
  const root = current.substring(0, current.indexOf(sep) + 1) || sep

  while (current !== root) {
    try {
      const gitPath = join(current, '.git')
      if (existsSync(gitPath)) {
        return current
      }
    } catch {
      // .git doesn't exist at this level
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  // Check root directory
  try {
    if (existsSync(join(root, '.git'))) {
      return root
    }
  } catch {
    // not found at root
  }

  return null
}

/**
 * Check if a directory is inside a git repository.
 */
export async function dirIsInGitRepo(cwd: string): Promise<boolean> {
  return findGitRoot(cwd) !== null
}

// ─── Git Command Helpers ──────────────────────────────────

function git(args: string[], cwd: string): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execSync(`git ${args.join(' ')}`, {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    return { stdout, stderr: '', code: 0 }
  } catch (e: unknown) {
    if (e instanceof Error && 'stdout' in e) {
      return {
        stdout: (e as { stdout: string }).stdout?.toString().trim() ?? '',
        stderr: ((e as unknown) as { stderr: string }).stderr?.toString().trim() ?? '',
        code: 1,
      }
    }
    return { stdout: '', stderr: String(e), code: 1 }
  }
}

// ─── Branch ───────────────────────────────────────────────

/**
 * Get the current branch name.
 */
export async function getBranch(cwd: string): Promise<string> {
  const root = findGitRoot(cwd)
  if (!root) return ''
  const { stdout } = git(['branch', '--show-current'], cwd)
  return stdout || ''
}

// ─── HEAD ─────────────────────────────────────────────────

/**
 * Get the current commit hash.
 */
export async function getHead(cwd: string): Promise<string> {
  const root = findGitRoot(cwd)
  if (!root) return ''
  const { stdout } = git(['rev-parse', 'HEAD'], cwd)
  return stdout || ''
}

// ─── Remote ───────────────────────────────────────────────

/**
 * Get the remote origin URL.
 */
export async function getRemoteUrl(cwd: string): Promise<string | null> {
  const root = findGitRoot(cwd)
  if (!root) return null
  const { stdout, code } = git(['remote', 'get-url', 'origin'], cwd)
  return code === 0 && stdout ? stdout : null
}

// ─── Clean State ──────────────────────────────────────────

/**
 * Check if the working tree is clean.
 */
export async function getIsClean(cwd: string): Promise<boolean> {
  const root = findGitRoot(cwd)
  if (!root) return true
  const { stdout } = git(['status', '--porcelain'], cwd)
  return stdout.length === 0
}

// ─── HEAD on Remote ───────────────────────────────────────

/**
 * Check if HEAD is on remote (has upstream tracking).
 */
export async function getIsHeadOnRemote(cwd: string): Promise<boolean> {
  const root = findGitRoot(cwd)
  if (!root) return false
  const { code } = git(['rev-parse', '@{u}'], cwd)
  return code === 0
}

// ─── Worktree Count ───────────────────────────────────────

/**
 * Get number of worktrees.
 */
export async function getWorktreeCount(cwd: string): Promise<number> {
  const root = findGitRoot(cwd)
  if (!root) return 0
  const { stdout } = git(['worktree', 'list', '--porcelain'], cwd)
  if (!stdout) return 1
  // Count worktree entries (each starts with "worktree ")
  const count = (stdout.match(/^worktree /gm) || []).length
  return Math.max(1, count)
}

// ─── File Status ──────────────────────────────────────────

/**
 * Get file status (tracked modified and untracked files).
 */
export async function getFileStatus(cwd: string): Promise<FileStatusResult> {
  const root = findGitRoot(cwd)
  if (!root) return { tracked: [], untracked: [] }

  const { stdout } = git(['status', '--porcelain'], cwd)
  if (!stdout) return { tracked: [], untracked: [] }

  const tracked: string[] = []
  const untracked: string[] = []

  stdout.split('\n').filter(line => line.length > 0).forEach(line => {
    const status = line.substring(0, 2)
    const filename = line.substring(2).trim()
    if (status === '??') {
      untracked.push(filename)
    } else if (filename) {
      tracked.push(filename)
    }
  })

  return { tracked, untracked }
}

// ─── Git State ────────────────────────────────────────────

/**
 * Get the full git repository state.
 * Returns null if not in a git repo.
 */
export async function getGitState(cwd: string): Promise<GitRepoState | null> {
  const root = findGitRoot(cwd)
  if (!root) return null

  try {
    const [
      commitHash,
      branchName,
      remoteUrl,
      isHeadOnRemote,
      isClean,
      worktreeCount,
    ] = await Promise.all([
      getHead(cwd),
      getBranch(cwd),
      getRemoteUrl(cwd),
      getIsHeadOnRemote(cwd),
      getIsClean(cwd),
      getWorktreeCount(cwd),
    ])

    return {
      commitHash,
      branchName,
      remoteUrl,
      isHeadOnRemote,
      isClean,
      worktreeCount,
    }
  } catch {
    return null
  }
}
