# Anthropic Foundry Provider

通过 Anthropic Foundry 平台使用 Claude 模型。

## 配置

```typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'foundry',
    resourceName: 'organizations/my-org/projects/my-project',
    apiKey: process.env.FOUNDRY_API_KEY!,
    model: 'deepseek-v4-flash',
  },
})
```

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `FOUNDRY_API_KEY` | 否 | Foundry API 密钥 |
| `resourceName` | 是 | Foundry 资源路径 |

## 适用场景

Foundry 适用于企业级部署，提供：
- 更高的 API 配额
- 专用的计算资源
- 企业级安全合规
- 自定义模型部署
