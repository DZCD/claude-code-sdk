# Phase 2-F 上下文构建补齐 — 设计文档

## 1. 现状分析

当前 `ContextBuilder` (builder.ts, 115 行) 功能极简：

| 功能 | 现状 | 差距 |
|------|------|------|
| Git 状态 | `branch --show-current` + `status --short` | 无 diff 统计、无远程状态、无 commit hash |
| CLAUDE.md 加载 | 仅查项目根目录和 `.claude/` | 无多级遍历、无 rules/ 目录、无 user/memory 集成 |
| Memory 集成 | 无 | 完全缺失 |
| 上下文分析 | 无 | 完全缺失 |

参考源码提供了完整实现：
- `git.ts` (926行): `getGitState`, `getFileStatus`, `getHead`, `getBranch`, `getRemoteUrl`, `findGitRoot`
- `gitDiff.ts` (532行): `fetchGitDiff`, `parseGitNumstat`, `parseShortstat`
- `claudemd.ts` (1479行): `processMemoryFile`, `processMdRules`, `getMemoryFilesForNestedDirectory`
- `memory/types.ts`: MemoryType (User/Project/Local/Managed/AutoMem)

## 2. 补齐方案

### 2.1 新增文件结构

```
src/context/
├── index.ts              # 导出更新
├── builder.ts            # 扩展 — 集成 Git 增强、memory、CLAUDE.md 优化
├── git.ts                # [NEW] Git 工具函数（无子进程依赖，纯 exec）
├── git-diff.ts           # [NEW] Git Diff 统计
├── memory-file.ts        # [NEW] Memory 文件加载与 @include 处理
└── __tests__/
    ├── git.test.ts       # [NEW] Git 工具测试
    ├── git-diff.test.ts  # [NEW] Diff 解析测试
    └── memory-file.test.ts # [NEW] Memory 文件测试
```

### 2.2 Git Utils (git.ts)

**核心职责**: 提供 Git 仓库信息查询，替代现有的内联 execSync 调用。

**接口设计**:

```typescript
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

// 查找 git 根目录（向上遍历目录树找 .git）
export function findGitRoot(startPath: string): string | null

// 检查目录是否在 git 仓库中
export function dirIsInGitRepo(cwd: string): Promise<boolean>

// 获取完整 git 仓库状态
export async function getGitState(cwd: string): Promise<GitRepoState | null>

// 获取文件状态（tracked/untracked）
export async function getFileStatus(cwd: string): Promise<FileStatusResult>

// 获取当前分支名
export async function getBranch(cwd: string): Promise<string>

// 获取当前 commit hash
export async function getHead(cwd: string): Promise<string>

// 获取远程仓库 URL
export async function getRemoteUrl(cwd: string): Promise<string | null>

// 检查 HEAD 是否在远程
export async function getIsHeadOnRemote(cwd: string): Promise<boolean>

// 检查工作目录是否干净
export async function getIsClean(cwd: string): Promise<boolean>
```

**参考对照**: `git.ts` L1-L530 — `findGitRoot`, `getGitState`, `getFileStatus`, `getBranch`, `getHead`, `getRemoteUrl` 等

### 2.3 Git Diff (git-diff.ts)

**核心职责**: 获取 diff 统计信息（文件数、增删行数）。

**接口设计**:

```typescript
export interface GitDiffStats {
  filesCount: number
  linesAdded: number
  linesRemoved: number
}

export interface PerFileStats {
  added: number
  removed: number
  isBinary: boolean
  isUntracked?: boolean
}

export interface GitDiffResult {
  stats: GitDiffStats
  perFileStats: Map<string, PerFileStats>
}

// 获取 git diff 统计（HEAD vs working tree）
export async function fetchGitDiff(cwd: string): Promise<GitDiffResult | null>

// 解析 --numstat 输出
export function parseGitNumstat(stdout: string): {
  stats: GitDiffStats
  perFileStats: Map<string, PerFileStats>
}

// 解析 --shortstat 输出
export function parseShortstat(stdout: string): GitDiffStats | null

// 获取未跟踪文件列表
export async function fetchUntrackedFiles(cwd: string, maxFiles: number): Promise<Map<string, PerFileStats>>
```

**参考对照**: `gitDiff.ts` L1-L165 — `fetchGitDiff`, `parseGitNumstat`, `parseShortstat`

### 2.4 Memory File Loader (memory-file.ts)

**核心职责**: 加载 memory 文件（CLAUDE.md, .claude/rules/*.md, CLAUDE.local.md），支持多级目录遍历和 @include 指令。

**接口设计**:

```typescript
export type MemoryType = 'User' | 'Project' | 'Local' | 'Managed'

export interface MemoryFileInfo {
  filePath: string
  content: string
  type: MemoryType
  parent?: string
}

export interface MemoryLoadOptions {
  cwd: string
  includeUser?: boolean      // 加载 ~/.claude/CLAUDE.md
  includeProject?: boolean   // 加载项目 CLAUDE.md
  includeLocal?: boolean     // 加载 CLAUDE.local.md
  includeRules?: boolean     // 加载 .claude/rules/*.md
}

export class MemoryFileLoader {
  constructor(options?: MemoryLoadOptions)
  
  // 加载所有 memory 文件（多级目录遍历）
  async loadAll(): Promise<MemoryFileInfo[]>
  
  // 加载单个 memory 文件，处理 @include 指令
  async loadFile(filePath: string, type: MemoryType): Promise<MemoryFileInfo[]>
  
  // 从 cwd 向上遍历到 git root，收集各级目录的 CLAUDE.md
  async loadMultiLevelClaudeMd(): Promise<MemoryFileInfo[]>
  
  // 加载 .claude/rules/ 目录下的所有 .md 文件
  async loadRules(rulesDir: string): Promise<MemoryFileInfo[]>
  
  // 解析 @include 指令
  resolveIncludes(content: string, baseDir: string, processed: Set<string>): string[]
}
```

**参考对照**: `claudemd.ts` L1-L1479 中的关键函数：
- `getMemoryFilesForNestedDirectory` (L1249) — 多级目录遍历
- `processMemoryFile` (L618) — 单个文件处理含 @include
- `processMdRules` (L697) — 处理 rules 目录
- `MemoryFileInfo` 类型

### 2.5 ContextBuilder 扩展

在现有 `builder.ts` 基础上扩展：

```typescript
export interface ContextOptions {
  includeGitStatus?: boolean
  includeClaudeMd?: boolean
  includeMemory?: boolean      // [NEW] 是否包含 memory 文件
  includeGitDiff?: boolean     // [NEW] 是否包含 git diff 统计
  cwd?: string
  customPrefix?: string
  customSuffix?: string
  includeUserMemory?: boolean  // [NEW] 是否包含 ~/.claude/CLAUDE.md
}

export class ContextBuilder {
  // ... 现有方法保持不变
  
  // [增强] Git 状态 — 包含完整状态信息
  async loadGitStatus(): Promise<string>
  
  // [增强] CLAUDE.md — 多级目录遍历 + rules/ 目录
  async loadClaudeMd(): Promise<string>
  
  // [NEW] Git Diff 信息
  async loadGitDiffInfo(): Promise<string>
  
  // [NEW] Memory 文件加载
  async loadMemoryFiles(): Promise<string>
  
  // [NEW] Context 分析信息
  async analyzeContext(): Promise<ContextAnalysisResult>
}
```

增强后的 Git 状态输出示例：
```
Current branch: feature/my-feature
Commit: a1b2c3d4
Remote: origin (github.com/user/repo)
HEAD is on remote: yes
Working tree: clean (or dirty with X files changed)
```

增强后的 CLAUDE.md 输出示例：
```
[CLAUDE.md from /home/user/project]
# Project Guide
...

[.claude/rules/ from /home/user/project/.claude/rules]
- coding-standards.md
- testing.md

[CLAUDE.local.md from /home/user/project]
# Local Overrides
...
```

## 3. 测试策略

| 模块 | 测试文件 | 测试数量 | 说明 |
|------|---------|---------|------|
| Git Utils | `git.test.ts` | ~15 | 状态获取、分支解析、远程 URL 解析 |
| Git Diff | `git-diff.test.ts` | ~12 | diff 解析、numstat/shortstat 解析 |
| Memory File | `memory-file.test.ts` | ~15 | 文件加载、include 解析、多级遍历 |
| Builder 扩展 | 现有集成测试扩展 | ~8 | 完整构建流程验证 |

## 4. 实现顺序

1. Git Utils (git.ts) — 无依赖基础模块
2. Git Diff (git-diff.ts) — 依赖 git.ts
3. Memory File Loader (memory-file.ts) — 独立模块
4. ContextBuilder 扩展 (builder.ts) — 集成以上三个模块
