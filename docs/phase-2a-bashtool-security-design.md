# Phase 2-A: BashTool 安全/路径/权限层补齐方案

## 1. 差距摘要

| 模块 | 参考行数 | 当前行数 | 差距 | 优先级 |
|------|---------|---------|------|-------|
| bashSecurity.ts | 2592 | 0 | ∞ | 🔴 最高 |
| bashPermissions.ts | 2621 | 0 | ∞ | 🔴 最高 |
| pathValidation.ts (BashTool) | 1303 | 0 | ∞ | 🔴 最高 |
| readOnlyValidation.ts | 1990 | ~40 (部分) | ~50x | 🔴 最高 |
| sedValidation.ts | 684 | 0 | ∞ | 🟡 高 |
| sedEditParser.ts | 322 | 0 | ∞ | 🟡 高 |
| modeValidation.ts | 115 | 0 | ∞ | 🟢 中 |
| bashCommandHelpers.ts | 265 | 0 | ∞ | 🟢 中 |
| shouldUseSandbox.ts | 153 | 0 | ∞ | 🟢 中 |
| **总计** | **~10,045** | **~115** | **~87x** | |

## 2. SDK 化策略

参考源码紧密耦合于 Claude Code 应用内部依赖（React UI、Bun feature flags、tree-sitter AST、SandboxManager、analytics 等）。
SDK 版本需做以下适配：

1. **移除**：React JSX/UI、analytics/logEvent、growthbook feature flags、Bun 特有 API
2. **简化**：tree-sitter AST → 基于正则/shell-quote 的简化解析
3. **抽象**：SandboxManager → 可选 sandbox 回调接口
4. **保留精华**：所有安全验证逻辑、路径白名单/黑名单、权限结果类型
5. **独立**：定义 SDK 自己的 PermissionResult/PermissionContext 类型（不依赖 Claude Code 内部类型）

## 3. 架构设计

### 3.1 文件结构

```
src/tools/built-in/
  bash.ts                          # 现有入口，集成所有安全层
  bash-security-utils/
    bashSecurity.ts                # 命令安全性检查、模式检测
    bashPermissions.ts             # 权限校验、审批模式、规则匹配
    pathValidation.ts              # 路径安全验证、sandbox 边界
    readOnlyValidation.ts          # 只读命令验证
    sedEditParser.ts               # sed -i 命令解析
    sedValidation.ts               # sed 命令安全验证
    modeValidation.ts              # 权限模式下的行为限制
    types.ts                       # PermissionResult, PermissionContext 等类型
```

### 3.2 类型定义 (types.ts)

```typescript
// 权限模式
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk'

// 权限行为
export type PermissionBehavior = 'allow' | 'deny' | 'ask' | 'passthrough'

// 权限决策原因
export type PermissionDecisionReason = 
  | { type: 'mode'; mode: PermissionMode }
  | { type: 'rule'; rule: string }
  | { type: 'other'; reason: string }
  | { type: 'safetyCheck'; reason: string }

// 权限结果
export type PermissionResult = {
  behavior: PermissionBehavior
  message: string
  updatedInput?: { command: string }
  decisionReason?: PermissionDecisionReason
  suggestions?: string[]
}

// 权限上下文
export type PermissionContext = {
  mode: PermissionMode
  allowedDirectories: string[]
  deniedDirectories: string[]
  allowRules: string[]
  denyRules: string[]
}

// 安全检测结果
export type SafetyResult = {
  safe: boolean
  message?: string
  reason?: string
}
```

### 3.3 模块职责

#### bashSecurity.ts — 命令安全性检查
- 命令替换检测：$(), `${}`, backtick
- 进程替换检测：<(), >()
- 危险模式检测：IFS injection, git commit 替换
- Zsh 危险命令：zmodload, emulate, sysopen, zpty 等
- 引号/注释解同步检测
- 换行/控制字符检测
- Heredoc 安全性检查

#### bashPermissions.ts — 权限校验
- 用户定义的 allow/deny 规则匹配
- 环境变量剥离 (stripSafeWrappers)
- Shell 包装器识别
- 规则提取与建议
- cd+git 交叉段检测

#### pathValidation.ts — 路径验证
- 危险路径检测 (rm -rf / 等)
- Path extractor 函数族 (cd, ls, mkdir, rm, mv, cp, cat, 等~50个命令)
- `--` 结束选项标记正确处理
- Sandbox 写白名单检查
- 只读/写入路径判断

#### readOnlyValidation.ts — 只读命令验证
- 扩展只读命令集 (xargs, git, fd, grep, awk, sed 等)
- 基于 flag 的精细只读判断
- Docker 只读命令
- UNC 路径漏洞检测

#### sedEditParser.ts — sed 编辑命令解析
- 解析 sed -i 's/pattern/replacement/flags' file
- 支持 -E/-r 扩展正则
- 支持 -e 表达式
- BRE ↔ ERE 转换
- applySedSubstitution 应用替换

#### sedValidation.ts — sed 命令安全验证
- 模式1：行打印命令 (-n 'Np')
- 模式2：只读表达式 (-n 's///p')
- 模式3：文件重定向 (sed 's///' file)
- 模式4：写文件 (sed 'w file')
- 模式5：读取文件 (sed 'r file')
- 模式6：读写文件 (sed 'w/r' flag)

#### modeValidation.ts — 模式验证
- acceptEdits 模式下自动允许 filesystem 命令
- 其他模式传递处理

## 4. 实施路线 (TDD 流程)

### Wave 1 — 基础层 (3 天)
1. **类型定义**：types.ts（PermissionResult、PermissionContext 等）
2. **bashSecurity.ts**：核心安全验证器
3. **单元测试**：50+ 测试用例

### Wave 2 — 权限与路径层 (3 天)
4. **pathValidation.ts**：路径提取与验证
5. **bashPermissions.ts**：权限规则匹配
6. **readOnlyValidation.ts**：只读命令验证增强
7. **单元测试**：40+ 测试用例

### Wave 3 — sed 工具与主入口集成 (2 天)
8. **sedEditParser.ts**：sed 命令解析
9. **sedValidation.ts**：sed 安全验证
10. **modeValidation.ts**：模式验证
11. **bash.ts 主入口集成**：集成所有安全层
12. **单元测试**：30+ 测试用例

## 5. 安全考虑

- 所有用户输入路径必须经过归一化和解析后才能做权限判断
- `--` 结束选项标记必须正确处理，防止路径旁路
- 环境变量剥离必须支持安全变量白名单
- heredoc 内部的命令替换必须被检测
- 复合命令 (&&, ||, ;, |) 的各段必须独立安全校验
- 危险路径 (/, /etc, /System, 等) 必须始终要求人工审批
