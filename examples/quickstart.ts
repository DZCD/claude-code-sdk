/**
 * Claude Code SDK — Quick Start Example
 *
 * 展示 SDK 核心功能的完整一站式示例。
 * 将以下功能串联在同一个可运行脚本中：
 *
 * 1. 初始化 LLMConnector
 * 2. 注册自定义工具 (get_weather)
 * 3. ask() — 自动工具执行
 * 4. streamToText — 流式文本消费
 * 5. StreamConsumer — 事件订阅监控
 *
 * 运行方式: npx tsx examples/quickstart.ts
 *
 * @example
 * ```bash
 * npx tsx examples/quickstart.ts
 * ```
 */

// ─────────────────────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────────────────────

import { z } from 'zod'
import { createLLMConnector } from '../src/llm/index.js'
import { ToolRegistry, createTool } from '../src/tools/index.js'
import { ask } from '../src/ask/index.js'
import { streamToText, createStreamConsumer } from '../src/streaming/index.js'
import { createUserMessage } from '../src/types/message.js'

// ─────────────────────────────────────────────────────────────
// 1. Initialize LLMConnector
// ─────────────────────────────────────────────────────────────

/**
 * 使用 API Key 配置创建 LLM 连接器。
 * 这里使用了 Anthropic 兼容的 API 端点（DeepSeek），
 * 你也可以替换为其他 Provider（Bedrock/Vertex/Foundry）。
 */
const apiKey = process.env.MY_API_KEY ?? 'sk-af3a84b5661b44f5b5695b47cb39dcd2'
const baseUrl = 'https://api.deepseek.com/anthropic'

console.log('=== 1. Initializing LLMConnector ===')
console.log(`   Provider: anthropic (compatible)`)
console.log(`   Model: deepseek-v4-flash`)
console.log(`   Base URL: ${baseUrl}\n`)

const llm = createLLMConnector({
  provider: 'anthropic',
  apiKey,
  baseUrl,
  model: 'deepseek-v4-flash',
  maxTokens: 1024,
})

// ─────────────────────────────────────────────────────────────
// 2. Register a Custom Tool
// ─────────────────────────────────────────────────────────────

/**
 * 使用 createTool() 定义一个天气查询工具。
 * - name: 工具名（LLM 通过此名称调用）
 * - description: 工具描述（LLM 理解工具用途的依据）
 * - inputSchema: Zod schema 定义输入参数
 * - execute: 工具的执行函数
 */
const weatherTool = createTool({
  name: 'get_weather',
  description: 'Get the current weather for a city',
  inputSchema: z.object({
    city: z.string().describe('The city name (e.g., Tokyo, London, Beijing)'),
  }),
  execute: async (input) => {
    // 模拟天气查询（生产环境中可替换为真实 API 调用）
    const conditions = ['sunny ☀️', 'cloudy ☁️', 'rainy 🌧️', 'windy 💨'] as const
    const condition = conditions[Math.floor(Math.random() * conditions.length)]
    const temp = Math.round(15 + Math.random() * 20)

    return {
      content: `Weather in ${input.city}: ${condition}, ${temp}°C`,
      data: { city: input.city, condition, temperature: temp },
    }
  },
})

/**
 * 创建 ToolRegistry 并注册自定义工具。
 * 注册后的工具可以被 LLM 自动发现和使用。
 */
const registry = new ToolRegistry()
registry.register(weatherTool)

console.log('=== 2. Registered Custom Tool ===')
console.log(`   Tool: ${weatherTool.name}`)
console.log(`   Description: ${weatherTool.description}`)
console.log(`   Input schema: city (string)\n`)

// ─────────────────────────────────────────────────────────────
// 3. Use ask() — Auto Tool Execution
// ─────────────────────────────────────────────────────────────

/**
 * ask() 是最上层的便捷 API：
 * - 发送一条消息给 LLM
 * - 自动执行 LLM 请求的工具调用
 * - 返回最终结果（含文本、工具调用记录、token 用量）
 *
 * 相当于 conversationLoop 的 Promise-based 封装。
 */
console.log('=== 3. ask() — Auto Tool Execution ===')
console.log('   Sending: "What\'s the weather in Tokyo?"\n')

const result = await ask(llm, {
  systemPrompt: 'You are a helpful assistant with access to a weather tool. '
    + 'Use the get_weather tool when asked about weather.',
  messages: [createUserMessage("What's the weather in Tokyo?")],
  tools: registry,
})

console.log(`   Response: ${result.text}`)
console.log(`   Tool calls made: ${result.toolCalls.length}`)
for (const call of result.toolCalls) {
  console.log(`     - ${call.name}(${JSON.stringify(call.input)}) => ${call.result}`)
}
console.log(`   Token usage: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out\n`)

// ─────────────────────────────────────────────────────────────
// 4. Use streamToText — Stream Text Only
// ─────────────────────────────────────────────────────────────

/**
 * streamToText() 从 LLM 流式事件中过滤出纯文本。
 * 适用于只需要文本结果、不需要处理工具调用或 thinking 的场景。
 *
 * LLMConnector.send() 返回 AsyncIterable<StreamEvent>，
 * streamToText() 将其转换为 AsyncIterable<string>。
 */
console.log('=== 4. streamToText() — Streaming Text Only ===')
console.log('   Asking for a short joke...\n')

const textStream = llm.send(
  'You are a brief and funny assistant.',
  [{ role: 'user', content: 'Tell me a short joke about programming.' }],
  [],
)

let fullText = ''
for await (const text of streamToText(textStream)) {
  process.stdout.write(text)
  fullText += text
}
console.log(`\n   (Received ${fullText.length} characters)\n`)

// ─────────────────────────────────────────────────────────────
// 5. Use StreamConsumer — Event Subscription
// ─────────────────────────────────────────────────────────────

/**
 * StreamConsumer 提供事件订阅机制来监控流式响应。
 * 通过 on() 方法注册特定事件的回调函数，并返回 unsubscribe 函数。
 *
 * 支持的事件类型:
 * - 'text' — 文本片段
 * - 'tool_use_start' — 工具调用开始
 * - 'tool_use_end' — 工具调用结束
 * - 'thinking' — 思考过程
 * - 'retry' — 重试事件
 * - 'done' — 流结束（含 token 用量）
 */
console.log('=== 5. StreamConsumer — Event Subscription ===')
console.log('   Monitoring stream events...\n')

const monitoredStream = llm.send(
  'You are a helpful assistant.',
  [{ role: 'user', content: 'What is 2+2? Answer very briefly.' }],
  [],
)

const consumer = createStreamConsumer(monitoredStream)

// 注册文本事件回调
let textParts: string[] = []
const unsubText = consumer.on('text', (event) => {
  textParts.push(event.text)
  process.stdout.write(event.text)
})

// 注册 done 事件回调 — 获取最终 token 用量
const unsubDone = consumer.on('done', (event) => {
  console.log(`\n   [Stream Complete]`)
  console.log(`   Input tokens: ${event.usage.inputTokens}`)
  console.log(`   Output tokens: ${event.usage.outputTokens}`)
})

// 消费整个流（触发所有注册的事件回调）
await consumer.consume()

// 清理订阅（不再使用时取消注册）
unsubText()
unsubDone()

console.log()
console.log('=== Quick Start Complete ===')
