# AWS Bedrock Provider

通过 AWS Bedrock 使用 Claude 模型。

## 配置

```typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'bedrock',
    model: 'anthropic.deepseek-v4-flash',
    region: 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})
```

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `AWS_ACCESS_KEY_ID` | 推荐 | AWS 访问密钥 |
| `AWS_SECRET_ACCESS_KEY` | 推荐 | AWS 秘密密钥 |
| `AWS_REGION` | 否 | 区域（默认 us-east-1） |

## 使用 IAM Role

如果你使用 IAM Role（如在 EC2 上），可以省略凭证：

```typescript
const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'bedrock',
    model: 'anthropic.deepseek-v4-flash',
    region: 'ap-northeast-1',
  },
})
```

SDK 会自动使用 AWS 默认凭证链（环境变量 → 配置文件 → IAM Role）。
