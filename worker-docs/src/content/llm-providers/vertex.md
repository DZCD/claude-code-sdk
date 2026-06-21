# Google Vertex AI Provider

通过 Google Vertex AI 使用 Claude 模型。

## 配置

```typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'vertex',
    projectId: process.env.ANTHROPIC_VERTEX_PROJECT_ID!,
    model: 'deepseek-v4-flash',
    region: 'us-east5',
  },
})
```

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `ANTHROPIC_VERTEX_PROJECT_ID` | 是 | GCP 项目 ID |
| `CLOUD_ML_REGION` | 否 | 区域（默认 us-east5） |

## 认证

Vertex AI 使用 Google Cloud 应用默认凭证 (ADC) 进行认证：

```bash
# 使用服务账号
export GOOGLE_APPLICATION_CREDENTIALS=./service-account-key.json

# 或使用 gcloud
gcloud auth application-default login
```

## 支持的模型

- `deepseek-v4-flash`
- `claude-3-opus@20240229`
- `claude-3-sonnet@20240229`
- `claude-3-haiku@20240307`
