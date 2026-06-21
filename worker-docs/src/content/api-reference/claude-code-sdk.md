# ClaudeCodeSDK

SDK 主入口类，提供会话管理、工具注册和全局配置功能。

## 构造函数

```typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK(config: SDKConfig)
```

## 配置参数

```typescript
interface SDKConfig {
  llm: LLMConfig                          // LLM 配置
  permissionMode?: PermissionMode         // 权限模式
  permissionRules?: PermissionRule[]      // 权限规则
  defaultTools?: boolean | string[]       // 默认工具
  mcpServers?: MCPServerConfig[]          // MCP 服务器
  context?: ContextOptions                // 上下文选项
  conversation?: ConversationOptions      // 对话选项
  global?: GlobalOptions                  // 全局选项
  session?: SessionConfig                 // 会话配置
  rateLimit?: { enabled?: boolean }       // 速率限制
}
```

## 方法

### `send()`

发送消息并获取回复：

```typescript
const response = await sdk.send('Hello')
```

### `stream()`

流式发送消息：

```typescript
const stream = sdk.stream('Tell me a story')
for await (const event of stream) {
  if (event.type === 'text') {
    process.stdout.write(event.text)
  }
}
```

### `getConfig()`

获取当前配置：

```typescript
const config = sdk.getConfig()
console.log(config.llm.provider) // 'anthropic'
```

## 属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `VERSION`（从模块导入） | `string` | SDK 版本号 |
| `configManager` | `ConfigManager` | 配置管理器 |
| `toolRegistry` | `ToolRegistry` | 工具注册表 |
| `hookSystem` | `HookSystem` | 钩子系统 |
