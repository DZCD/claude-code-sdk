/**
 * examples/mcp-server.ts — MCP 服务集成示例
 *
 * 展示如何：
 * 1. 启动本地 MCP server（stdio 模式）
 * 2. 通过 MCPServerManager 注册 MCP 工具
 * 3. 将 MCP 工具自动注册到 ToolRegistry
 * 4. 使用 ask() 让 LLM 调用 MCP 提供的工具
 *
 * 前置条件：
 * - 设置 ANTHROPIC_API_KEY 环境变量
 * - 安装一个 MCP server（此处以 @anthropic/mcp-server-filesystem 为例）
 *   npm install -g @anthropic/mcp-server-filesystem
 *
 * 运行：
 *   npx tsx examples/mcp-server.ts
 */
import { createLLMConnector } from '../src/llm/client.js'
import { MCPServerManager } from '../src/mcp/manager.js'
import { ToolRegistry } from '../src/tools/registry.js'
import { ask } from '../src/ask/index.js'
import { registerAllBuiltInTools } from '../src/tools/built-in/index.js'

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

  // ── 2. 初始化 ToolRegistry 并注册内置工具 ─────────────
  const registry = new ToolRegistry()
  registerAllBuiltInTools(registry)

  // ── 3. 配置 MCP Server ────────────────────────────────
  //
  // 此处以 filesystem MCP server 为例。
  // 你可以替换成任何 stdio MCP server，如：
  // - npx @modelcontextprotocol/server-github
  // - npx @modelcontextprotocol/server-filesystem /path
  // - uvx mcp-server-vegan-lol
  const mcpConfigs = [
    {
      name: 'filesystem',
      type: 'stdio' as const,
      commandOrUrl: 'npx',
      args: [
        '-y',
        '@anthropic/mcp-server-filesystem',
        '/tmp', // 允许访问的目录
      ],
      // 可选：限制注册哪些工具
      toolConfiguration: {
        allowedTools: ['read_file', 'list_directory'],
      },
    },
  ]

  // ── 4. 连接 MCP Server ────────────────────────────────
  const mcpManager = new MCPServerManager()
  try {
    console.log('🔄 正在连接到 MCP servers...')
    await mcpManager.connectAll(mcpConfigs)
    console.log(`✅ 已连接 ${mcpManager.connectedServers.length} 个 server`)
    console.log(`   工具数: ${mcpManager.getAllTools().length}`)

    // 显示连接信息
    const connections = mcpManager.getConnectionInfo()
    for (const conn of connections) {
      console.log(`   Server: ${conn.serverName}`)
      console.log(`   能力: ${conn.capabilities.join(', ')}`)
      console.log(`   工具: ${conn.tools.map((t: any) => t.name).join(', ')}`)
    }
  } catch (err) {
    console.error('❌ MCP 连接失败:', (err as Error).message)
    console.log('   (请确保已安装对应的 MCP server)')
    process.exit(1)
  }

  // ── 5. 注册 MCP 工具到 ToolRegistry ──────────────────
  //
  // MCP 工具会自动包装为 SDK Tool 接口，可正常被 ask() 调用。
  const registeredCount = mcpManager.registerAllTools(registry)
  console.log(`✅ 已注册 ${registeredCount} 个 MCP 工具到 ToolRegistry`)

  // ── 6. 让 LLM 调用 MCP 工具 ──────────────────────────
  //
  // ask() 会自动执行 LLM 请求的工具调用（包括 MCP 工具）。
  // 此处让 LLM 读取 /tmp/hello.txt（如果存在）。
  const result = await ask(llm, {
    systemPrompt:
      '你是一个文件系统助手。使用可用的工具来帮助用户。',
    messages: [
      {
        id: 'msg-1',
        role: 'user',
        content: '请列出 /tmp 目录中的文件',
        createdAt: new Date().toISOString(),
      },
    ],
    tools: registry,
  })

  // ── 7. 输出结果 ───────────────────────────────────────
  console.log('\n🎯 最终回复:')
  console.log(result.text)

  if (result.toolCalls.length > 0) {
    console.log('\n🔧 工具调用记录:')
    for (const tc of result.toolCalls) {
      console.log(`  - ${tc.name}: ${tc.isError ? '❌' : '✅'}`)
    }
  }

  console.log(`\n📊 Token 用量: 输入=${result.usage.inputTokens} 输出=${result.usage.outputTokens}`)

  // ── 8. 清理 ───────────────────────────────────────────
  await mcpManager.disconnectAll()
  console.log('👋 已断开所有 MCP 连接')
}

main().catch((err) => {
  console.error('程序异常:', err)
  process.exit(1)
})
