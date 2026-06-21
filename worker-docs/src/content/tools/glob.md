# Glob Tool

## 功能说明

GlobTool 使用 Glob 模式搜索文件路径，支持通配符和递归搜索。

## 类型定义

```typescript
interface GlobInput {
  pattern: string    // Glob 模式，如 "**/*.ts"
  path?: string       // 搜索起始目录
}

interface GlobOutput {
  files: string[]    // 匹配的文件路径列表
  count: number      // 匹配数量
}
```

## 使用示例

```typescript
import { GlobTool } from 'claude-code-sdk-ts'

const tool = new GlobTool()
const result = await tool.execute({
  pattern: 'src/**/*.ts',
  path: '.',
})

console.log(`找到 ${result.count} 个 TypeScript 文件`)
result.files.forEach(f => console.log(' -', f))
```
