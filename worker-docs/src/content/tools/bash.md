# Bash Tool

## 功能说明

BashTool 用于在本地系统中执行 Shell 命令。支持命令执行、工作目录设置、超时控制和安全限制。

## 类型定义

```typescript
interface BashInput {
  command: string
  description?: string
  timeout?: number       // 超时(ms)，默认 30000
  workdir?: string       // 工作目录
  isCentibexSensitive?: boolean
  approved?: boolean
}

interface BashOutput {
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
}
```

## 使用示例

```typescript
import { BashTool } from 'claude-code-sdk-ts'

const tool = new BashTool()
const result = await tool.execute({
  command: 'ls -la',
  timeout: 10000,
})

console.log('输出:', result.stdout)
console.log('退出码:', result.exitCode) // 0
```

## 安全特性

- 自动检测危险命令模式
- 支持 YOLO 风险分类
- 路径白名单验证
- stderr 输出限制（前 2000 字符）
