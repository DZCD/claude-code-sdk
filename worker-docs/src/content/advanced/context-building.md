# 上下文构建

ContextBuilder 负责构建发送给 LLM 的上下文信息。

## 基本使用

```typescript
import { ContextBuilder } from 'claude-code-sdk-ts'

const builder = new ContextBuilder()
const context = await builder.build()
```

## Git 上下文

```typescript
import { fetchGitDiff, getGitState, getBranch } from 'claude-code-sdk-ts'

// 获取 Git diff
const diff = await fetchGitDiff()
console.log(`变更文件: ${diff.files.length}`)

// 获取 Git 状态
const state = await getGitState()
console.log(`分支: ${state.branch}`)

// 获取当前分支
const branch = await getBranch()
console.log(`当前分支: ${branch}`)

// 获取远程地址
import { getRemoteUrl } from 'claude-code-sdk-ts'
const url = await getRemoteUrl()
console.log(`远程仓库: ${url}`)
```

## CLAUDE.md 加载

自动查找并加载项目中的 `CLAUDE.md` 文件：

```typescript
const context = await builder.build({
  includeClaudeMd: true,
  includeGitStatus: true,
})
```

CLAUDE.md 的搜索路径：
1. 项目根目录 `./CLAUDE.md`
2. `~/.claude/CLAUDE.md`
3. `~/.config/claude/CLAUDE.md`

## Memory 集成

```typescript
import { MemoryFileLoader } from 'claude-code-sdk-ts'

const loader = new MemoryFileLoader()
const memories = await loader.load()
// 返回三层 memory：项目级、全局级、会话级
```
