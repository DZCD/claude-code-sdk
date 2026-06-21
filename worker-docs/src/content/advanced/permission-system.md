# 权限系统

SDK 的权限系统控制工具的执行权限，支持四种模式。

## 权限模式

| 模式 | 说明 | 适用场景 |
|------|------|---------|
| `auto` | 自动执行低风险操作，高风险请求确认 | 日常开发 |
| `manual` | 所有工具调用都需要用户确认 | 生产环境 |
| `bypass` | 跳过所有权限检查 | 自动化脚本 |
| `plan` | 仅做风险评估，不执行 | 预览模式 |

## 配置权限模式

```typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: { /* ... */ },
  permissionMode: 'manual', // 所有工具调用都需要确认
})
```

## 权限模式的设计背景

四种模式的设计体现了**最小权限原则（Principle of Least Privilege）**和安全与效率的权衡：

### `auto` 模式（日常开发首选）
- **设计背景**：开发中最常见的场景——AI 执行 `ls`、`cat`、`grep` 等低风险命令，开发者不需要每次都确认
- **安全策略**：基于风险分类器自动判断（读操作为低风险，写操作为中风险，删除为高风险）
- **适用场景**：个人开发环境、本地调试

### `manual` 模式（生产环境）
- **设计背景**：在 CI/CD 或生成服务器上，必须确保每个操作都经过人工审批
- **安全策略**：所有工调用都暂停并请求用户确认，不自动执行任何操作
- **适用场景**：生产部署、敏感数据操作

### `bypass` 模式（自动化脚本）
- **设计背景**：彻夜运行的批量任务、定时执行的维护脚本——不需要人看
- **安全策略**：跳过所有检查，完全信任 AI 的工具调用
- **适用场景**：受控环境的自动化、预验证过的脚本

### `plan` 模式（预览/审计）
- **设计背景**：在真正执行前，让 AI 先「规划」出需要执行哪些工具调用，用户审查后再执行
- **安全策略**：AI 可以调用工具但结果不写入环境，仅做风险评估报告
- **适用场景**：审查复杂工具链、安全审计、培训 AI 理解执行边界

## 自定义权限规则

```typescript
import { ClaudeCodeSDK } from 'claude-code-sdk-ts'

const sdk = new ClaudeCodeSDK({
  llm: { /* ... */ },
  permissionMode: 'auto',
  permissionRules: [
    {
      tool: 'BashTool',
      allowPatterns: ['ls', 'cat', 'echo'],  // 这些命令自动允许
      denyPatterns: ['rm', 'sudo', 'chmod'],  // 这些命令自动拒绝
    },
    {
      tool: 'FileWriteTool',
      allowPaths: ['./src/**'],               // 只允许写入 src 目录
      denyPaths: ['./node_modules/**'],        // 禁止修改 node_modules
    },
  ],
})
```

## 运行时权限控制

```typescript
import { PermissionManager } from 'claude-code-sdk-ts'

const pm = new PermissionManager()

// 检查工具是否允许执行
const request = {
  tool: 'BashTool',
  input: { command: 'ls -la' },
  riskLevel: 'low',
}

const decision = pm.evaluate(request)
if (decision.allowed) {
  console.log('允许执行')
} else {
  console.log(`拒绝: ${decision.reason}`)
}
```
