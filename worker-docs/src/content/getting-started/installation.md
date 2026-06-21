# 安装

## 系统要求

- **Node.js** ≥ 18.x（LTS）
- **TypeScript** ≥ 5.0
- **ESM** — SDK 仅支持 ES Module 项目

## 设计理念：为什么用 DeepSeek 做默认 Provider？

SDK 默认使用 **DeepSeek** 的 Anthropic 兼容接口，而非直接接入 Anthropic Claude：

- **价格优势** — DeepSeek API 成本约为原生 Anthropic Claude 的 1/20，适合开发测试和高频调用场景
- **即开即用** — 无需申请 Anthropic 密钥、无需通过企业审批，注册 DeepSeek 即可获得 API Key
- **协议兼容** — DeepSeek 实现了标准的 Anthropic Messages API，SDK 零适配即可通信
- **灵活性** — 如需切换回原生 Anthropic 或其他 Provider，只需修改 `provider`/`baseUrl`/`apiKey` 三个字段

> 💡 SDK 的多 Provider 架构（见 [LLM Provider 配置](/getting-started/configuration)）使得换底层模型只需改配置，代码零改动。这也是「关注点分离」的设计体现——业务逻辑与模型服务解耦。

## 设计理念：零运行时设计

Claude Code SDK **不依赖 Claude Code 运行时环境**，这是 SDK 最根本的设计决策：

- **独立运行** — SDK 是纯 TypeScript 库，可以在任何 Node.js 环境中运行（CI/CD、Edge Function、桌面应用）
- **无隐式依赖** — 不读取 `.claude/settings.json`、不依赖系统安装的 Claude Code 二进制文件
- **可测试性** — 因为不依赖外部运行时，单元测试和集成测试都可以在隔离环境中运行
- **Tree-shakeable** — 只引用需要的模块，不影响打包体积

## npm 安装

```bash
npm install claude-code-sdk-ts
```

## 获取 API 密钥

SDK 通过 **DeepSeek** 的 Anthropic 兼容接口调用 AI 模型，需要先获取 DeepSeek API 密钥：

1. 前往 [platform.deepseek.com](https://platform.deepseek.com) 注册账号
2. 在 API Keys 页面创建新的密钥
3. 复制密钥（格式为 `sk-xxxxxxxxxxxx`）

配置方式有两种：

**方式一：环境变量**

```bash
export DEEPSEEK_API_KEY=sk-your-deepseek-api-key-here
```

**方式二：代码中直接传入**

```typescript
import { ClaudeCodeSDK, VERSION } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'anthropic',                       // DeepSeek 的 Anthropic 兼容接口
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: 'sk-your-deepseek-api-key-here',
    model: 'deepseek-v4-flash',
  },
})
```

## 验证安装

运行以下代码验证 SDK 是否正常工作：

```typescript
import { ClaudeCodeSDK, VERSION } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'anthropic',
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: process.env.DEEPSEEK_API_KEY!,
    model: 'deepseek-v4-flash',
  },
})

console.log('SDK 版本:', VERSION)
// SDK 版本: 0.5.0
```

### 完整验证（发送一条真实消息）

```typescript
import { ClaudeCodeSDK, VERSION } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'anthropic',
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: process.env.DEEPSEEK_API_KEY!,
    model: 'deepseek-v4-flash',
  },
})

const response = await sdk.send('Hello!')
console.log('AI 回复:', response.content)
// AI 回复: Hello! How can I help you today?
```

## 下一步

完成安装后，请阅读 [5 分钟快速上手](/getting-started/quick-start) 开始使用 SDK。

## 设计细节：为什么 ask() 需要 ToolRegistry 参数？

细心的读者可能注意到 `ask()` 函数即使不需要工具也要传 `new ToolRegistry()`。这背后是**明确性原则**：

- `ask()` 内部使用工具系统驱动 AI 的推理循环（工具结果 → 下一轮推理 → 再尝试工具），整个流程依赖于 ToolRegistry
- 即使没有注册任何工具，空的 ToolRegistry 也能为 `ask()` 提供标准的「无工具」合约
- 这样设计的好处是内部代码路径统一：无论有没有工具，`ask()` 的执行逻辑完全一致

> 在 SDK 的未来版本中，我们计划将 `tools` 改为可选参数，内部默认构造空 ToolRegistry。

## 可选依赖

根据不同 Provider，可能需要安装额外的包：

| Provider | 包名 |
|----------|------|
| AWS Bedrock | `@anthropic-ai/bedrock-sdk` |
| Google Vertex AI | `@anthropic-ai/vertex-sdk` |
| Anthropic Foundry | `@anthropic-ai/foundry-sdk` |

> 💡 **开源地址** — 源码和贡献指南请访问 [github.com/DZCD/claude-code-sdk](https://github.com/DZCD/claude-code-sdk)
