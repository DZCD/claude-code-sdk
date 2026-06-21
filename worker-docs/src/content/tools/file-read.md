# FileRead Tool

## 功能说明

FileReadTool 用于读取文件内容。支持指定行范围、自动处理大文件。

## 类型定义

```typescript
interface FileReadInput {
  filePath: string
  limit?: number   // 最多读取行数
  offset?: number  // 起始行号（0-based）
}

interface FileReadOutput {
  content: string
  lineCount: number
  totalLines: number
}
```

## 使用示例

```typescript
import { FileReadTool } from 'claude-code-sdk-ts'

const tool = new FileReadTool()
const result = await tool.execute({
  filePath: './package.json',
  limit: 50,
})

console.log(result.text)
```
