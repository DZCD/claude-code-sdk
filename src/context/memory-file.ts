import { existsSync } from 'node:fs'
/**
 * Memory File Loader — Loads CLAUDE.md, .claude/rules/*.md, and memory files.
 *
 * Supports multi-level directory traversal (from cwd to git root),
 * @include directives, and User/Project/Local memory types.
 *
 * Based on Claude Code's src/utils/claudemd.ts.
 */
import { access, readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { findGitRoot } from './git.js'

// ─── Types ────────────────────────────────────────────────

export type MemoryType = 'User' | 'Project' | 'Local' | 'Managed'

export interface MemoryFileInfo {
  filePath: string
  content: string
  type: MemoryType
  parent?: string
}

export interface MemoryLoadOptions {
  cwd: string
  includeUser?: boolean
  includeProject?: boolean
  includeLocal?: boolean
  includeRules?: boolean
}

const DEFAULT_OPTIONS: MemoryLoadOptions = {
  cwd: process.cwd(),
  includeUser: true,
  includeProject: true,
  includeLocal: true,
  includeRules: true,
}

const MAX_INCLUDE_DEPTH = 10

// ─── MemoryFileLoader ─────────────────────────────────────

export class MemoryFileLoader {
  private readonly _options: MemoryLoadOptions

  constructor(options?: Partial<MemoryLoadOptions>) {
    this._options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Load a single memory file, processing @include directives.
   * Returns array of MemoryFileInfo (includes first, then the file itself).
   */
  async loadFile(filePath: string, type: MemoryType): Promise<MemoryFileInfo[]> {
    try {
      await access(filePath)
    } catch {
      return []
    }

    const processedPaths = new Set<string>()
    return this.processFile(filePath, type, processedPaths, false, 0)
  }

  /**
   * Process a memory file with @include resolution.
   */
  private async processFile(
    filePath: string,
    type: MemoryType,
    processedPaths: Set<string>,
    includeExternal: boolean,
    depth: number,
  ): Promise<MemoryFileInfo[]> {
    if (processedPaths.has(filePath) || depth >= MAX_INCLUDE_DEPTH) {
      return []
    }

    let content: string
    try {
      content = await readFile(filePath, 'utf-8')
    } catch {
      return []
    }

    processedPaths.add(filePath)

    const result: MemoryFileInfo[] = []
    result.push({ filePath, content: content.trim(), type })

    // Resolve @include directives
    const includePaths = this.resolveIncludes(content, dirname(filePath), new Set(processedPaths))

    for (const includePath of includePaths) {
      const isExternal = !includePath.startsWith(this._options.cwd)
      if (isExternal && !includeExternal) continue

      const included = await this.processFile(includePath, type, processedPaths, includeExternal, depth + 1)
      result.push(...included)
    }

    return result
  }

  /**
   * Resolve @include directives in content.
   * Only processes @path directives outside code blocks.
   */
  resolveIncludes(content: string, baseDir: string, processedPaths: Set<string>): string[] {
    const paths: string[] = []
    const lines = content.split('\n')
    let inCodeBlock = false

    for (const line of lines) {
      // Track code blocks
      if (line.trimStart().startsWith('```')) {
        inCodeBlock = !inCodeBlock
        continue
      }
      if (inCodeBlock) continue

      // Match @path patterns (must be at start of line or after whitespace)
      const match = line.match(/(?:^|\s)@(\S+)/)
      if (!match) continue

      let includePath = match[1]!

      // Handle ~/ paths
      if (includePath.startsWith('~/')) {
        includePath = join(homedir(), includePath.slice(2))
      } else if (isAbsolute(includePath)) {
        // Absolute paths — skip for security unless explicitly allowed
        continue
      } else {
        // Relative path — resolve against baseDir
        includePath = resolve(baseDir, includePath)
      }

      if (!processedPaths.has(includePath) && existsSync(includePath)) {
        paths.push(includePath)
      }
    }

    return paths
  }

  /**
   * Multi-level CLAUDE.md traversal from cwd up to git root.
   * Collects CLAUDE.md, .claude/CLAUDE.md, and CLAUDE.local.md
   * at each directory level.
   */
  async loadMultiLevelClaudeMd(): Promise<MemoryFileInfo[]> {
    const gitRoot = findGitRoot(this._options.cwd)
    const result: MemoryFileInfo[] = []

    // Collect directories from cwd up to git root
    const dirs: string[] = []
    let current = this._options.cwd
    const root = resolve(gitRoot || '/')

    while (true) {
      dirs.push(current)
      if (current === root) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }

    // Process directories from root down to cwd (so closest files have highest priority)
    dirs.reverse()

    const processedPaths = new Set<string>()

    for (const dir of dirs) {
      if (this._options.includeProject) {
        // CLAUDE.md in directory
        const claudeMd = join(dir, 'CLAUDE.md')
        const files = await this.processFile(claudeMd, 'Project', processedPaths, false, 0)
        result.push(...files)

        // .claude/CLAUDE.md
        const dotClaude = join(dir, '.claude', 'CLAUDE.md')
        const dotClaudeFiles = await this.processFile(dotClaude, 'Project', processedPaths, false, 0)
        result.push(...dotClaudeFiles)
      }

      if (this._options.includeLocal) {
        // CLAUDE.local.md (local/private overrides)
        const localMd = join(dir, 'CLAUDE.local.md')
        const localFiles = await this.processFile(localMd, 'Local', processedPaths, false, 0)
        result.push(...localFiles)
      }
    }

    return result
  }

  /**
   * Load all .md files from .claude/rules/ directory.
   */
  async loadRules(rulesDir: string): Promise<MemoryFileInfo[]> {
    try {
      await access(rulesDir)
      const dirStat = await stat(rulesDir)
      if (!dirStat.isDirectory()) return []
    } catch {
      return []
    }

    const result: MemoryFileInfo[] = []
    const entries = await readdir(rulesDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const filePath = join(rulesDir, entry.name)

      try {
        const content = await readFile(filePath, 'utf-8')
        result.push({ filePath, content: content.trim(), type: 'Project' })
      } catch {
        // Skip unreadable files
      }
    }

    return result
  }

  /**
   * Load all memory files.
   * Loads in order: User memory → Project CLAUDE.md → Rules → Local
   */
  async loadAll(): Promise<MemoryFileInfo[]> {
    const result: MemoryFileInfo[] = []
    const processedPaths = new Set<string>()

    // 1. User memory (~/.claude/CLAUDE.md)
    if (this._options.includeUser) {
      const userClaudeDir = join(homedir(), '.claude')
      const userMd = join(userClaudeDir, 'CLAUDE.md')
      const userFiles = await this.processFile(userMd, 'User', processedPaths, false, 0)
      result.push(...userFiles)
    }

    // 2. Multi-level CLAUDE.md from git root to cwd
    const projectFiles = await this.loadMultiLevelClaudeMd()
    result.push(...projectFiles)

    // 3. Rules from .claude/rules/ in the cwd
    if (this._options.includeRules) {
      const rulesDir = join(this._options.cwd, '.claude', 'rules')
      const rulesFiles = await this.loadRules(rulesDir)
      result.push(...rulesFiles)
    }

    return result
  }
}
