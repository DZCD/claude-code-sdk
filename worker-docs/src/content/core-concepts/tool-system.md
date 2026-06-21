# 工具系统

工具系统是 SDK 的核心能力之一，允许 Claude 调用外部工具来完成任务。

## 工具注册

```typescript
import { ToolRegistry, createTool, BaseTool } from 'claude-code-sdk-ts'
import { z } from 'zod'

// 通过工厂函数创建工具
const myTool = createTool({
  name: 'my_tool',
  description: '我的自定义工具',
  inputSchema: z.object({
    input: z.string().describe('输入参数'),
  }),
  execute: async (input) => {
    return { result: `处理: ${input.input}` }
  },
})

// 注册到注册表
const registry = new ToolRegistry()
registry.register(myTool)
```

## 继承 BaseTool

更复杂的工具可以通过继承 `BaseTool` 实现：

```typescript
import { BaseTool } from 'claude-code-sdk-ts'
import { z } from 'zod'

class CalculatorTool extends BaseTool {
  name = 'calculator'
  description = '执行数学计算'
  inputSchema = z.object({
    expression: z.string().describe('数学表达式'),
  })

  async execute(input: { expression: string }) {
    try {
      const result = Function(`'use strict'; return (${input.expression})`)()
      return { result: String(result) }
    } catch (err) {
      return { error: `计算失败: ${(err as Error).message}` }
    }
  }
}

// 注册
registry.register(new CalculatorTool())
```

## 内置工具

SDK 提供 8 个内置工具，通过 `registerAllBuiltInTools()` 批量注册：

```typescript
import { registerAllBuiltInTools } from 'claude-code-sdk-ts'

const registry = new ToolRegistry()
registerAllBuiltInTools(registry)
// 注册: BashTool, FileReadTool, FileWriteTool, FileEditTool,
//       GlobTool, GrepTool, WebFetchTool, WebSearchTool
```

## 工具调用流程

```
用户请求
    │
    ▼
LLM 分析 → 决定调用工具
    │
    ▼
权限系统检查 (auto/manual/bypass/plan)
    │
    ▼
工具执行
    │
    ▼
结果返回给 LLM
    │
    ▼
LLM 生成最终回复
```

## 设计理念：插件化工具系统

工具系统的设计借鉴了**插件架构（Plugin Architecture）**的思想：

1. **统一接口** — 每个工具实现 `BaseTool` 抽象类，SDK 不关心工具内部实现，只通过 `name`/`description`/`schema`/`execute` 四个接口交互
2. **即插即用** — 工具通过 `ToolRegistry` 注册/注销，无需修改 SDK 核心代码即可增减功能
3. **MCP 协议** — 外部工具通过 MCP（Model Context Protocol）标准化协议接入，进一步放宽了工具的来源
4. **权限解耦** — 工具的「执行逻辑」与「安全策略」分离：工具只关心「怎么做」，权限系统决定「能不能做」

这种设计带来的实际好处：
- 社区可以贡献新的内置工具，无需修改核心库
- 企业可以开发内部工具并通过 MCP 服务器暴露
- 测试时可以直接 mock 工具的行为

## MCP 协议工具

通过 MCP 协议集成外部工具服务器：

```typescript
import { MCPServerManager, adaptMCPTool } from 'claude-code-sdk-ts'

const manager = new MCPServerManager()

// 添加 MCP 服务器
await manager.addServer({
  name: 'my-server',
  transport: 'stdio',
  command: 'node',
  args: ['./mcp-server.js'],
})

// 获取所有可用的 MCP 工具
const mcpTools = manager.getTools()
for (const mcpTool of mcpTools) {
  const adapted = adaptMCPTool(mcpTool)
  registry.register(adapted)
}
```
