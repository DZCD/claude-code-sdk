# WebFetch Tool

## 功能说明

WebFetchTool 用于获取网页内容并提取可读文本。

## 类型定义

```typescript
interface WebFetchInput {
  url: string
  maxChars?: number    // 最大字符数，默认 50000
}

interface WebFetchOutput {
  content: string
  url: string
  truncated: boolean
}
```

## 使用示例

```typescript
import { WebFetchTool } from 'claude-code-sdk-ts'

const tool = new WebFetchTool()
const result = await tool.execute({
  url: 'https://example.com',
  maxChars: 10000,
})

console.log(result.text)
```
