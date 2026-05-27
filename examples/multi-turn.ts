/**
 * examples/multi-turn.ts — 多轮对话示例
 *
 * 展示如何：
 * 1. 使用 ask() 进行多轮对话
 * 2. 每轮保留 messages 历史，实现上下文积累
 * 3. 使用 StreamConsumer 监控每轮事件
 * 4. 通过 onToolCall 钩子实现自定义权限控制
 *
 * 前置条件：
 * - 设置 ANTHROPIC_API_KEY 环境变量
 *
 * 运行：
 *   npx tsx examples/multi-turn.ts
 */
import { createLLMConnector } from '../src/llm/client.js'
import { ToolRegistry } from '../src/tools/registry.js'
import { registerAllBuiltInTools } from '../src/tools/built-in/index.js'
import { createStreamConsumer } from '../src/streaming/index.js'
import { ask, askStream } from '../src/ask/index.js'
import type { Message } from '../src/types/message.js'

async function main() {
  // ── 1. 初始化 LLM 连接器 ──────────────────────────────
  const apiKey = process.env['ANTHROPIC_API_KEY']
  if (!apiKey) {
    console.error('请设置 ANTHROPIC_API_KEY 环境变量')
    process.exit(1)
  }

  const llm = createLLMConnector({
    provider: 'anthropic',
    apiKey,
    model: 'claude-sonnet-4-20250514',
  })

  // ── 2. 初始化工具 ─────────────────────────────────────
  const tools = new ToolRegistry()
  registerAllBuiltInTools(tools)

  // ── 3. 多轮对话 ───────────────────────────────────────
  //
  // messages 数组会跨轮次累积，LLM 能看到完整的对话历史。
  // 这是实现多轮对话的关键模式。
  const messages: Message[] = []

  // ===== 第一轮：用户提问 =====
  console.log('─'.repeat(60))
  console.log('🟢 第 1 轮: 用户提问')
  console.log('─'.repeat(60))

  messages.push({
    id: 'round-1',
    role: 'user',
    content: '请创建一个 /tmp/hello.ts 文件，内容是一个简单的 TypeScript hello world 程序。然后读取文件内容确认。',
    createdAt: new Date().toISOString(),
  })

  let result = await ask(llm, {
    systemPrompt: '你是一个编程助手。可以创建和读取文件。',
    messages,
    tools,
    options: {
      // onToolCall 钩子：每次工具调用前执行
      onToolCall: async (toolName, input) => {
        console.log(`  🛠️ 工具调用: ${toolName}(${JSON.stringify(input)})`)
        return true // 允许执行
      },
    },
  })

  // 将本轮结果追加到消息历史（供下一轮使用）
  messages.push(
    {
      id: 'round-1-assistant',
      role: 'assistant',
      content: result.text,
      createdAt: new Date().toISOString(),
    },
  )
  console.log(`\n  🤖 回复: ${result.text.substring(0, 200)}...`)
  console.log(`  📊 本轮 Token: 输入=${result.usage.inputTokens} 输出=${result.usage.outputTokens}`)

  // ===== 第二轮：追问 — 上下文延续 =====
  //
  // 由于 messages 包含了上一轮的完整上下文，LLM 知道
  // 刚才已经创建了 /tmp/hello.ts，可以在此基础上继续工作。
  console.log('\n' + '─'.repeat(60))
  console.log('🟢 第 2 轮: 追问（上下文积累）')
  console.log('─'.repeat(60))

  messages.push({
    id: 'round-2',
    role: 'user',
    content: '很好。现在请读取 /tmp/hello.ts 的内容，然后修改它：添加一个 sum 函数。',
    createdAt: new Date().toISOString(),
  })

  result = await ask(llm, {
    systemPrompt: '你是一个编程助手。可以创建、读取和编辑文件。',
    messages,
    tools,
    options: {
      onToolCall: async (toolName, input) => {
        console.log(`  🛠️ 工具调用: ${toolName}(${JSON.stringify(input)})`)
        return true
      },
    },
  })

  messages.push(
    {
      id: 'round-2-assistant',
      role: 'assistant',
      content: result.text,
      createdAt: new Date().toISOString(),
    },
  )
  console.log(`\n  🤖 回复: ${result.text.substring(0, 200)}...`)
  console.log(`  📊 本轮 Token: 输入=${result.usage.inputTokens} 输出=${result.usage.outputTokens}`)

  // ===== 第三轮：查看历史 =====
  //
  // 使用 StreamConsumer 展示流式监控能力
  console.log('\n' + '─'.repeat(60))
  console.log('🟢 第 3 轮: 使用 StreamConsumer 监控流式事件')
  console.log('─'.repeat(60))

  messages.push({
    id: 'round-3',
    role: 'user',
    content: '请读取 /tmp/hello.ts 的完整内容。',
    createdAt: new Date().toISOString(),
  })

  // 使用 askStream 配合 StreamConsumer 逐事件监听
  const stream = askStream(llm, {
    systemPrompt: '你是一个编程助手。',
    messages,
    tools,
  })

  const consumer = createStreamConsumer(stream as any)

  // 注册类型化的事件处理器
  const unsubText = consumer.on('text', (event) => {
    // 实时打印收到的文本片段
    process.stdout.write(`\x1b[90m[text:${event.text.length}ch]\x1b[0m `)
  })

  const unsubTool = consumer.on('tool_use_start', (event) => {
    console.log(`\n  🛠️ 工具开始: ${event.name}`)
  })

  // 注册通用事件处理器（* 通配符）
  const unsubAll = consumer.onEvent((event) => {
    if (event.type === 'done') {
      console.log(`\n  ✅ 流式完成, token 用量:`, event.usage)
    }
  })

  // 消费事件
  await consumer.consume()

  // 清理订阅
  unsubText()
  unsubTool()
  unsubAll()

  // ── 4. 汇总统计 ───────────────────────────────────────
  console.log('\n' + '='.repeat(60))
  console.log('📊 多轮对话汇总')
  console.log('='.repeat(60))
  console.log(`总轮次: 3`)
  console.log(`消息历史数: ${messages.length} 条`)
  for (const [i, msg] of messages.entries()) {
    const preview = typeof msg.content === 'string'
      ? msg.content.substring(0, 60).replace(/\n/g, ' ')
      : JSON.stringify(msg.content).substring(0, 60)
    console.log(`  ${i + 1}. [${msg.role}] ${preview}...`)
  }
}

main().catch((err) => {
  console.error('程序异常:', err)
  process.exit(1)
})
