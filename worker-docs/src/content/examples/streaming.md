# 流式对话

使用流式 API 实时获取 LLM 响应，适合聊天界面、打字机效果等场景。

## 基础流式 — 逐字输出

```typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'anthropic',
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: process.env.DEEPSEEK_API_KEY!,
    model: 'deepseek-v4-flash',
  },
})

async function main() {
  const stream = sdk.stream('讲一个程序员的笑话')

  for await (const event of stream) {
    if (event.type === 'text') {
      process.stdout.write(event.text)
    }
  }
}

main()
```

**效果**：文字会逐字打印出来，像打字机一样：
```
为...什么...程...序...员...分...不...清...万...圣...节...和...圣...诞...节？
因...为... Oct 31 == Dec 25
```

## StreamConsumer — 灵活的流式处理

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

const stream = sdk.stream('用中文写一首五言绝句')
const consumer = createStreamConsumer(stream)

// 方式 1: 文本流（逐段输出）
for await (const text of consumer.toTextStream()) {
  process.stdout.write(text)
}

// 方式 2: 块流（含 tool_use 信息）
const stream2 = sdk.stream('搜索当前目录的文件')
const consumer2 = createStreamConsumer(stream2)
for await (const block of consumer2.toBlockStream()) {
  if (block.type === 'text') {
    console.log('文本:', block.text)
  } else if (block.type === 'tool_use') {
    console.log(`调用工具: ${block.name}`)
    console.log(`参数:`, block.input)
  }
}
// 调用工具: GlobTool
// 参数: { pattern: '*', path: '.' }

// 方式 3: 事件订阅
consumer.on('text', (event) => process.stdout.write(event.text))
consumer.on('done', (usage) => {
  console.log('Token 用量:', usage)
  // Token 用量: { inputTokens: 45, outputTokens: 128 }
})

// 方式 4: 聚合为完整结果
const result = await consumer.toPromise()
console.log('完整文本:', result.text)
console.log('Token 用量:', result.usage)
```

**`toPromise()` 输出示例：**

```
完整文本: 床前明月光，疑是地上霜。举头望明月，低头思故乡。
Token 用量: { inputTokens: 45, outputTokens: 128 }
```

## askStream() — 流式 + 自动工具执行

`askStream()` 是流式 + 自动工具执行的高级 API，适合需要 AI 自动调用工具的场景：

```typescript
import { ClaudeCodeSDK, askStream, ToolRegistry, registerAllBuiltInTools } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: {
    provider: 'anthropic',
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: process.env.DEEPSEEK_API_KEY!,
    model: 'deepseek-v4-flash',
  },
})

const registry = new ToolRegistry()
registerAllBuiltInTools(registry)

async function main() {
  for await (const event of askStream(sdk.getLLM(), {
    systemPrompt: 'You have file system access.',
    messages: [{ role: 'user', content: '列出当前目录的文件' }],
    tools: registry,
  })) {
    if (event.type === 'text') {
      process.stdout.write(event.text)
    } else if (event.type === 'tool_call') {
      console.log(`\
[调用工具: ${event.toolName}]`)
    } else if (event.type === 'result') {
      console.log('\
✅ 完成!')
    }
  }
}

main()
```

**输出示例：**

```
[调用工具: GlobTool]
当前目录包含以下文件：

├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   └── utils.ts
└── README.md

✅ 完成!
```

## 对比：流式 vs 非流式

| 方式 | 适用场景 | 特点 |
|------|----------|------|
| `sdk.send()` | 需要完整结果 | 等待全部返回 |
| `sdk.stream()` + `for await` | 实时展示 | 逐字输出，用户无需等待 |
| `askStream()` | 工具自动调用 | 流式 + 工具执行一体化 |

## 下一步

- [工具调用](/examples/tool-usage) — 让 AI 自动执行命令
- [Conversation Manager](/core-concepts/conversation) — 对话状态管理
