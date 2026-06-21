# MCP 集成

集成 MCP (Model Context Protocol) 工具服务器的完整示例。

## 文件系统服务器

```typescript
import { ClaudeCodeSDK, MCPServerManager, adaptMCPTool, ToolRegistry } from 'claude-code-sdk-ts'

async function main() {
  // 1. 创建 MCP 服务器管理器
  const manager = new MCPServerManager()

  // 2. 添加文件系统 MCP 服务器
  await manager.addServer({
    name: 'fs',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', './data'],
  })

  // 3. 适配 MCP 工具
  const registry = new ToolRegistry()
  for (const mcpTool of manager.getTools()) {
    registry.register(adaptMCPTool(mcpTool))
  }

  // 4. 创建 SDK 并使用
  const sdk = new ClaudeCodeSDK({
    llm: {
      provider: 'anthropic',
    baseUrl: 'https://api.deepseek.com/anthropic',
      apiKey: process.env.DEEPSEEK_API_KEY!,
    },
  })

  const response = await sdk.send('List files in the data directory')
  console.log(response.content)
}
```

## 多个 MCP 服务器

```typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: { provider: 'anthropic', apiKey: process.env.DEEPSEEK_API_KEY! },
    baseUrl: 'https://api.deepseek.com/anthropic',
  mcpServers: [
    {
      name: 'database',
      transport: 'stdio',
      command: 'node',
      args: ['./mcp-db-server.js'],
    },
    {
      name: 'weather',
      transport: 'url',
      url: 'https://weather-mcp.example.com/sse',
    },
  ],
})

// MCP 工具自动注册到 SDK
const response = await sdk.send('Query the database for recent users')
console.log(response.content)
```
