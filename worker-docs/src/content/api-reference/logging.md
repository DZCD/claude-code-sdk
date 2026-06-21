# 日志系统

SDK 的调试日志系统，用于诊断和排查问题。

## 基本用法

```typescript
import { logForDebugging, enableDebugLogging } from 'claude-code-sdk-ts'

logForDebugging('LLM 请求开始', { level: 'debug' })
logForDebugging('工具执行完成', { level: 'info' })
```

## 日志级别

5 个级别，从低到高：

| 级别 | 说明 | 默认是否输出 |
|------|------|-------------|
| `verbose` | 详细诊断 | ❌ |
| `debug` | 调试信息 | ✅（默认） |
| `info` | 一般信息 | ✅ |
| `warn` | 警告 | ✅ |
| `error` | 错误 | ✅ |

## 启用方式

```bash
# 环境变量
DEBUG_SDK=true node app.js

# 命令行标志
node app.js --debug

# 程序化启用
import { enableDebugLogging } from 'claude-code-sdk-ts'
enableDebugLogging()
```

## 分类过滤

使用 `--debug=分类` 语法过滤特定类别的日志：

```bash
node app.js --debug=api,hooks
node app.js --debug=!1p,!file   # 排除特定类别
```

## 输出目标

默认写入 `./debug/<sessionId>.txt` 文件：

```bash
# 输出到 stderr
node app.js --debug-to-stderr

# 自定义日志文件路径
DEBUG_SDK_LOG_FILE=/var/log/sdk.log node app.js
```

## 环境变量

| 变量 | 说明 |
|------|------|
| `DEBUG_SDK` | 启用调试日志 |
| `DEBUG_SDK_LOG_LEVEL` | 最低日志级别（默认 debug） |
| `DEBUG_SDK_LOG_FILE` | 日志文件路径 |
| `DEBUG_SDK_LOGS_DIR` | 日志目录 |
