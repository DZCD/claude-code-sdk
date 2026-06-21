# DeepSeek (Anthropic 兼容)

DeepSeek 是 SDK 推荐的 LLM Provider，通过 **Anthropic 兼容 API** 接入。使用 `provider: 'anthropic'` 配置，指向 DeepSeek 的 API 端点即可。

## 为什么用 DeepSeek？

- **价格更低** — DeepSeek 的 API 价格远低于原生 Anthropic
- **兼容性好** — 支持 Anthropic Messages API 格式，SDK 直接适配
- **模型能力** — `deepseek-v4-flash` 在推理任务上表现优秀

## 配置

```typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'anthropic',                       // 固定使用 anthropic 作为 provider
    baseUrl: 'https://api.deepseek.com/anthropic', // DeepSeek 兼容端点
    apiKey: process.env.DEEPSEEK_API_KEY!,
    model: 'deepseek-v4-flash',
    maxTokens: 8192,
    temperature: 0.7,
  },
})
```

### 验证配置是否生效

```typescript
const response = await sdk.send('1+1=？')
console.log(response.content)
// 1+1=2
```

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `DEEPSEEK_API_KEY` | 是 | DeepSeek API 密钥 |
| `DEEPSEEK_MODEL` | 否 | 模型名称（默认 deepseek-v4-flash） |
| `DEEPSEEK_BASE_URL` | 否 | API 基础地址（默认 https://api.deepseek.com/anthropic） |

## 支持模型

- `deepseek-v4-flash`（默认，推荐）
- `deepseek-v4`（完整版，速度较慢但更强）

## 流式响应

```typescript
import { ClaudeCodeSDK, createStreamConsumer } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'anthropic',
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: process.env.DEEPSEEK_API_KEY!,
    model: 'deepseek-v4-flash',
  },
})

// 方式 1: 直接消费文本流
const stream = sdk.stream('写一个简短的故事')
for await (const event of stream) {
  if (event.type === 'text') {
    process.stdout.write(event.text)
  }
}
// 输出（逐字打印）: 从前有座山，山里有座庙...

// 方式 2: 聚合为完整结果
const consumer = createStreamConsumer(sdk.stream('讲个笑话'))
const result = await consumer.toPromise()
console.log(result.text)
// 为什么程序员分不清万圣节和圣诞节？因为 Oct 31 == Dec 25
```

## 多 Provider 适配层的价值

SDK 的 LLM 连接器层是**一次集成，到处运行**的最佳实践：

```
          ┌─────────────┐
          │  你的代码     │
          └──────┬──────┘
                 │ 统一的 LLMConnector 接口
                 ▼
     ┌───────────────────────┐
     │    LLM 连接器层        │
     ├───────────────────────┤
     │ Anthropic │ Bedrock   │
     │ Vertex    │ Foundry   │
     └───────────────────────┘
                 │ 各自的 SDK/API
                 ▼
     DeepSeek   AWS   GCP   Anthropic
```

**带来的核心价值：**

- **切换零成本** — 从 DeepSeek 迁移到 Bedrock 只需改 `provider` 字段，不需要改任何业务代码
- **统一体验** — 无论底层是哪个 Provider，`send()`、`stream()`、工具调用等 API 完全一致
- **渐进式增强** — 测试阶段用便宜的 DeepSeek，上线后用 Bedrock/Vertex 的企业级 SLA
- **故障隔离** — 如果某个 Provider 宕机，可以快速切换到备选 Provider，不影响业务

## 其他 Provider

SDK 也支持其他 Anthropic 兼容或原生 Provider：

- [AWS Bedrock](/llm-providers/bedrock) — 通过 AWS 使用 Claude
- [Google Vertex AI](/llm-providers/vertex) — 通过 GCP 使用 Claude
- [Anthropic Foundry](/llm-providers/foundry) — 原生 Anthropic 企业版
