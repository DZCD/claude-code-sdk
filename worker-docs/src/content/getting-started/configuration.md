# 配置说明

SDK 支持从多种来源加载配置，按优先级从低到高排列：

1. **默认值** — 内置默认配置
2. **配置文件** — JSON 文件
3. **环境变量** — 操作系统环境
4. **编程覆盖** — 代码中直接传入

## 基础配置

```typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'anthropic',
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: process.env.DEEPSEEK_API_KEY!,
    model: 'deepseek-v4-flash',
    maxTokens: 8192,
    temperature: 0.7,
  },
  // 权限模式
  permissionMode: 'auto', // 'auto' | 'manual' | 'bypass' | 'plan'
  // 默认启用所有内置工具
  defaultTools: true,
})
```

## ConfigManager

使用 ConfigManager 可以更精细地管理配置：

```typescript
import { ConfigManager } from 'claude-code-sdk-ts'

const config = new ConfigManager()

// 从文件加载
config.loadFromFile('./claude-code-sdk.json')

// 从环境变量加载
config.mergeFromEnv()

// 编程更新
config.update({
  llm: { provider: 'vertex', projectId: 'my-project' },
})

// 获取配置
const current = config.getConfig()
console.log(current.llm.provider) // 'vertex'
```

## 配置验证

```typescript
import { sdkConfigSchema } from 'claude-code-sdk-ts/config'

const result = sdkConfigSchema.safeParse(myConfig)
if (!result.success) {
  console.error('配置验证失败:', result.error.issues)
  // [
  //   { path: ['llm', 'apiKey'], message: 'Required' },
  //   { path: ['llm', 'provider'], message: "Expected 'anthropic' | 'bedrock' | 'vertex' | 'foundry'" }
  // ]
}
```

## 配置优先级

```typescript
const config = new ConfigManager()

// 按优先级合并多个来源
config.loadFromSources({
  filePath: './settings.json',  // 低优先级
  env: process.env,             // 中优先级
  cliArgs: {                    // 高优先级
    permissionMode: 'bypass',
  },
})
```

## 环境变量对照

| 环境变量 | 对应配置项 | 示例 |
|----------|-----------|------|
| `DEEPSEEK_API_KEY` | `llm.apiKey` | `sk-...` |
| `DEEPSEEK_MODEL` | `llm.model` | `deepseek-v4-flash` |
| `DEEPSEEK_BASE_URL` | `llm.baseUrl` | `https://api.deepseek.com/anthropic` |
| `AWS_ACCESS_KEY_ID` | `llm.accessKeyId` | Bedrock 凭证 |
| `AWS_SECRET_ACCESS_KEY` | `llm.secretAccessKey` | Bedrock 凭证 |
| `ANTHROPIC_VERTEX_PROJECT_ID` | `llm.projectId` | Vertex 项目 ID |
| `CLAUDE_CODE_PERMISSION_MODE` | `permissionMode` | `auto/manual/bypass/plan` |

## 进阶配置（Phase 3D+）

### EffortLevel 思考深度

控制 AI 的思考/推理深度，影响回答质量和延迟：

```typescript
import type { EffortLevel } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: { provider: 'anthropic', baseUrl: 'https://api.deepseek.com/anthropic', apiKey: process.env.DEEPSEEK_API_KEY!, model: 'deepseek-v4-flash' },
  effort: 'high',  // 'low' | 'medium' | 'high'
})
```

| 级别 | 说明 | 适用场景 |
|------|------|---------|
| `low` | 快速响应，推理更少 | 简单问答、闲聊 |
| `medium` | 平衡质量与速度（默认） | 日常编码辅助 |
| `high` | 深度推理，更详细 | 复杂逻辑、架构设计 |

### AgentDefinition 自定义 Agent

定义可调用的子 Agent：

```typescript
import type { AgentDefinition } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: { provider: 'anthropic', baseUrl: 'https://api.deepseek.com/anthropic', apiKey: process.env.DEEPSEEK_API_KEY!, model: 'deepseek-v4-flash' },
  agents: {
    'code-reviewer': {
      description: 'Code review specialist agent',
      systemPrompt: 'You are a senior code reviewer...',
      tools: ['FileRead', 'Grep', 'Glob'],
      model: 'deepseek-v4-flash',
    },
  },
})
```

### FastMode 快速模式

并发工具执行状态管理：

```typescript
import { isFastModeEnabled, type FastModeState } from 'claude-code-sdk-ts'

const state: FastModeState = { enabled: true, concurrency: 3 }

if (isFastModeEnabled(state)) {
  console.log('FastMode 已启用，最多 3 个并发工具调用')
}
```

### PermissionUpdate 权限更新

动态更新权限规则：

```typescript
import { applyPermissionUpdate, createPermissionUpdateContext, type PermissionUpdate } from 'claude-code-sdk-ts'

const context = createPermissionUpdateContext('auto')

const update: PermissionUpdate = {
  type: 'addRules',
  rules: [{ toolName: 'Bash', decision: 'allow' }],
  destination: 'session',
}

const updated = applyPermissionUpdate(context, update)
```
