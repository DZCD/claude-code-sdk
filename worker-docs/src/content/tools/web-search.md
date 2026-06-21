# WebSearch Tool

## 功能说明

WebSearchTool 用于执行网络搜索，支持 DuckDuckGo 和 Exa 两种搜索引擎。

## 类型定义

```typescript
interface WebSearchInput {
  query: string
  maxResults?: number     // 最大结果数，默认 8
  type?: 'auto' | 'fast' | 'deep'
  engine?: 'duckduckgo' | 'exa'
}

interface WebSearchOutput {
  results: Array<{
    title: string
    url: string
    content: string
    source?: string
  }>
}
```

## 使用示例

```typescript
import { WebSearchTool } from 'claude-code-sdk-ts'

const tool = new WebSearchTool()
const result = await tool.execute({
  query: 'TypeScript latest version',
  maxResults: 5,
})

result.results.forEach(r => {
  console.log(`[${r.title}](${r.url})`)
})
```
