# MCP 协议

Model Context Protocol (MCP) 集成，支持连接外部工具服务器。

## MCPServerManager

管理 MCP 服务器连接：

```typescript
import { MCPServerManager } from 'claude-code-sdk-ts'

const manager = new MCPServerManager()
```

### 添加服务器

支持两种传输模式：

```typescript
// stdio 模式
await manager.addServer({
  name: 'my-tools',
  transport: 'stdio',
  command: 'node',
  args: ['./mcp-server.js'],
})

// URL 模式
await manager.addServer({
  name: 'remote-tools',
  transport: 'url',
  url: 'https://mcp.example.com/sse',
})
```

### 获取工具

```typescript
const tools = manager.getTools()
console.log(`可用 MCP 工具: ${tools.length}`)
```

### 适配工具

```typescript
import { adaptMCPTool, ToolRegistry } from 'claude-code-sdk-ts'

const registry = new ToolRegistry()
for (const mcpTool of manager.getTools()) {
  const adapted = adaptMCPTool(mcpTool)
  registry.register(adapted)
}
```

## MCP 资源配置

```typescript
// MCP 配置集成到主配置
const sdk = new ClaudeCodeSDK({
  llm: { provider: 'anthropic', apiKey: 'sk-...' },
    baseUrl: 'https://api.deepseek.com/anthropic',
  mcpServers: [
    {
      name: 'filesystem',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', './data'],
    },
  ],
})
```
