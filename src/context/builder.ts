/**
 * ClaudeCode SDK — Context Builder
 *
 * Builds system prompts with project context such as git status
 * and CLAUDE.md. Helps the model understand the project context.
 */
import { execSync } from 'node:child_process'
import { readFile, access } from 'node:fs/promises'
import { join } from 'node:path'

export interface ContextOptions {
  includeGitStatus?: boolean
  includeClaudeMd?: boolean
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

    if (options?.includeGitStatus !== false) {
      const gitStatus = await this.loadGitStatus()
      if (gitStatus) {
        parts.push(gitStatus)
      }
    }

    if (options?.includeClaudeMd !== false) {
      const claudeMd = await this.loadClaudeMd()
      if (claudeMd) {
        parts.push(claudeMd)
      }
    }

    if (options?.customSuffix) {
      parts.push(options.customSuffix)
    }

    return parts.join('\n\n')
  }

  /** Load git status for context */
  async loadGitStatus(): Promise<string> {
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

  /** Load CLAUDE.md from project root */
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
