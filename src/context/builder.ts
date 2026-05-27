/**
 * ClaudeCode SDK — Context Builder
 *
 * Builds system prompts with project context such as git status,
 * git diff, CLAUDE.md, and memory files.
 * Phase 2 extended with enhanced git, diff, and memory integration.
 */
import { execSync } from 'node:child_process'
import { readFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { findGitRoot, getGitState, getFileStatus } from './git.js'
import { fetchGitDiff } from './git-diff.js'
import { MemoryFileLoader } from './memory-file.js'

export interface ContextOptions {
  includeGitStatus?: boolean
  includeClaudeMd?: boolean
  includeMemory?: boolean
  includeGitDiff?: boolean
  includeUserMemory?: boolean
  cwd?: string
  customPrefix?: string
  customSuffix?: string
}

export class ContextBuilder {
  private readonly _cwd: string

  constructor(cwd?: string) {
    this._cwd = cwd ?? process.cwd()
  }

  /** Build the complete system prompt */
  async build(options?: ContextOptions): Promise<string> {
    const parts: string[] = []

    if (options?.customPrefix) {
      parts.push(options.customPrefix)
    }

    // Phase 1: Basic git status (backward compatible)
    if (options?.includeGitStatus !== false) {
      const gitStatus = await this.loadGitStatus()
      if (gitStatus) {
        parts.push(gitStatus)
      }
    }

    // Phase 2: Git diff info
    if (options?.includeGitDiff) {
      const diffInfo = await this.loadGitDiffInfo()
      if (diffInfo) {
        parts.push(diffInfo)
      }
    }

    // Phase 1: Basic CLAUDE.md (backward compatible)
    if (options?.includeClaudeMd !== false && options?.includeMemory !== true) {
      const claudeMd = await this.loadClaudeMd()
      if (claudeMd) {
        parts.push(claudeMd)
      }
    }

    // Phase 2: Memory files (supersedes basic CLAUDE.md)
    if (options?.includeMemory) {
      const memoryContent = await this.loadMemoryFiles(options?.includeUserMemory ?? true)
      if (memoryContent) {
        parts.push(memoryContent)
      }
    }

    if (options?.customSuffix) {
      parts.push(options.customSuffix)
    }

    return parts.join('\n\n')
  }

  /**
   * Load enhanced git status for context.
   * Includes branch name, commit hash, remote info, and file status.
   */
  async loadGitStatus(): Promise<string> {
    const gitRoot = findGitRoot(this._cwd)
    if (!gitRoot) return ''

    try {
      const state = await getGitState(this._cwd)
      const fileStatus = await getFileStatus(this._cwd)

      const parts: string[] = []

      if (state) {
        parts.push(`Current branch: ${state.branchName}`)
        parts.push(`Commit: ${state.commitHash}`)
        if (state.remoteUrl) {
          parts.push(`Remote: ${state.remoteUrl}`)
        }
        parts.push(`HEAD on remote: ${state.isHeadOnRemote ? 'yes' : 'no'}`)
        parts.push(`Working tree: ${state.isClean ? 'clean' : 'dirty'}`)

        if (!state.isClean && fileStatus.tracked.length > 0) {
          parts.push(`Modified files (${fileStatus.tracked.length}):`)
          for (const f of fileStatus.tracked.slice(0, 20)) {
            parts.push(`  ${f}`)
          }
        }

        if (fileStatus.untracked.length > 0) {
          parts.push(`Untracked files (${fileStatus.untracked.length}):`)
          for (const f of fileStatus.untracked.slice(0, 20)) {
            parts.push(`  ${f}`)
          }
        }
      }

      return parts.length > 0 ? parts.join('\n') : ''
    } catch {
      // Fallback to basic status
      try {
        const branch = execSync('git branch --show-current 2>/dev/null', {
          cwd: this._cwd,
          encoding: 'utf-8',
          timeout: 3000,
        }).trim()

        const status = execSync('git status --short 2>/dev/null', {
          cwd: this._cwd,
          encoding: 'utf-8',
          timeout: 3000,
        }).trim()

        const parts: string[] = []
        if (branch) {
          parts.push(`Current branch: ${branch}`)
        }
        if (status) {
          parts.push(`Git status:\n${status}`)
        }

        return parts.length > 0 ? parts.join('\n') : ''
      } catch {
        return ''
      }
    }
  }

  /**
   * Load git diff statistics for context.
   */
  async loadGitDiffInfo(): Promise<string> {
    try {
      const diff = await fetchGitDiff(this._cwd)
      if (!diff) return ''

      const { stats } = diff
      const parts: string[] = ['Changes (uncommitted):']

      if (stats.filesCount > 0) {
        parts.push(`  Files changed: ${stats.filesCount}`)
        parts.push(`  Lines added: ${stats.linesAdded}`)
        parts.push(`  Lines removed: ${stats.linesRemoved}`)
      }

      // Per-file details (up to 10 files)
      if (diff.perFileStats.size > 0) {
        parts.push('')
        let count = 0
        for (const [filePath, fileStats] of diff.perFileStats) {
          if (count++ >= 10) {
            parts.push(`  ... and ${diff.perFileStats.size - 10} more files`)
            break
          }
          const label = fileStats.isUntracked ? ' (new)' : ''
          parts.push(`  ${filePath}: +${fileStats.added}/-${fileStats.removed}${label}`)
        }
      }

      return parts.join('\n')
    } catch {
      return ''
    }
  }

  /** Load CLAUDE.md from project root (backward compatible) */
  async loadClaudeMd(): Promise<string> {
    const paths = [
      join(this._cwd, 'CLAUDE.md'),
      join(this._cwd, '.claude', 'CLAUDE.md'),
    ]

    for (const filePath of paths) {
      try {
        await access(filePath)
        const content = await readFile(filePath, 'utf-8')
        return content.trim()
      } catch {
        continue
      }
    }

    return ''
  }

  /**
   * Load all memory files (multi-level CLAUDE.md + rules + user).
   */
  async loadMemoryFiles(includeUserMemory?: boolean): Promise<string> {
    try {
      const loader = new MemoryFileLoader({
        cwd: this._cwd,
        includeUser: includeUserMemory ?? true,
        includeProject: true,
        includeLocal: true,
        includeRules: true,
      })

      const files = await loader.loadAll()
      if (files.length === 0) return ''

      const parts: string[] = []

      for (const file of files) {
        if (!file.content.trim()) continue

        // Annotate the source
        const label = file.type === 'User' ? 'User memory' :
                      file.type === 'Local' ? 'Local memory' :
                      file.type === 'Managed' ? 'Managed' :
                      'Project memory'

        const shortPath = file.filePath.replace(this._cwd, '.')
        parts.push(`[${label} — ${shortPath}]`)
        parts.push(file.content)
      }

      return parts.join('\n\n')
    } catch {
      return ''
    }
  }

  /** Load content from a specific file path */
  async loadFile(filePath: string): Promise<string | null> {
    try {
      const fullPath = filePath.startsWith('/') ? filePath : join(this._cwd, filePath)
      await access(fullPath)
      return await readFile(fullPath, 'utf-8')
    } catch {
      return null
    }
  }
}
