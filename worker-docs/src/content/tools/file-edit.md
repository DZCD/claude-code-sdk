# FileEdit Tool

## 功能说明

FileEditTool 用于对已有文件进行精确的字符串替换编辑，支持单次替换和全局替换。

## 类型定义

```typescript
interface FileEditInput {
  filePath: string
  oldString: string
  newString: string
  replaceAll?: boolean   // 是否替换所有匹配项
}

interface FileEditOutput {
  path: string
  replacements: number   // 替换次数
}
```

## 使用示例

```typescript
import { FileEditTool } from 'claude-code-sdk-ts'

const tool = new FileEditTool()
const result = await tool.execute({
  filePath: './index.ts',
  oldString: 'console.log',
  newString: 'console.info',
  replaceAll: true,
})

console.log(`已替换 ${result.replacements} 处`)
```
