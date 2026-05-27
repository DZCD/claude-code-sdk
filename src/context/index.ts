/**
 * ClaudeCode SDK — Context Module Index
 */

export { ContextBuilder } from './builder.js'
export type { ContextOptions } from './builder.js'
export { findGitRoot, getGitState, getFileStatus, getBranch, getHead, getRemoteUrl } from './git.js'
export type { GitRepoState, FileStatusResult } from './git.js'
export { fetchGitDiff, parseGitNumstat, parseShortstat } from './git-diff.js'
export type { GitDiffResult, GitDiffStats, PerFileStats } from './git-diff.js'
export { MemoryFileLoader } from './memory-file.js'
export type { MemoryFileInfo, MemoryType, MemoryLoadOptions } from './memory-file.js'
