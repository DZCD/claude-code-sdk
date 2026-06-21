# FileWrite Tool

## 功能说明

FileWriteTool 用于创建新文件或覆盖已有文件内容。

## 类型定义

```typescript
interface FileWriteInput {
  filePath: string
  content: string
}

interface FileWriteOutput {
  path: string
  size: number
}
```

## 使用示例

```typescript
import { FileWriteTool } from 'claude-code-sdk-ts'

const tool = new FileWriteTool()
const result = await tool.execute({
  filePath: './hello.txt',
  content: 'Hello, World!',
})

console.log(`已写入 ${result.size} 字节`)
```
