# Grep Tool

## 功能说明

GrepTool 在文件内容中搜索匹配正则表达式的行，支持文件类型过滤。

## 类型定义

```typescript
interface GrepInput {
  pattern: string     // 正则表达式
  include?: string    // 文件过滤模式，如 "*.ts"
  path?: string       // 搜索目录
}

interface GrepOutput {
  matches: Array<{
    file: string
    line: number
    content: string
  }>
  count: number
}
```

## 使用示例

```typescript
import { GrepTool } from 'claude-code-sdk-ts'

const tool = new GrepTool()
const result = await tool.execute({
  pattern: 'class.*extends',
  include: '*.ts',
  path: './src',
})

console.log(`找到 ${result.count} 个类继承`)
```
