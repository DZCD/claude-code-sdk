# Phase 3C — D1: Hook System 设计文档

> **任务**: 在 SDK 中实现事件钩子系统  
> **日期**: 2026-05-27  
> **状态**: Design Doc (Superpowers Phase 2)

---

## 1. 背景与目标

当前 SDK 的工具调用和 LLM 交互流程是线性的，没有提供扩展点让外部代码在关键生命周期事件中插入自定义逻辑。

**目标**: 实现一个轻量、类型安全的事件钩子系统，支持：

- 工具执行前（可修改输入/阻止执行）
- 工具执行后
- LLM 请求前
- LLM 响应后

---

## 2. 设计

### 2.1 模块结构

```
src/hooks/
├── index.ts          # 公开 API 导出
├── types.ts          # 钩子类型定义
├── registry.ts       # 注册表核心实现
└── integration.ts    # 与 ask()/conversationLoop() 的集成层
```

### 2.2 钩子类型定义

```typescript
// types.ts

/** 钩子阶段 */
export type HookPhase = 'preTool' | 'postTool' | 'preTurn' | 'postTurn'

/** 工具执行前钩子签名 */
export type PreToolHook = (toolName: string, input: Record<string, unknown>) => 
  PreToolHookResult | Promise<PreToolHookResult>

export interface PreToolHookResult {
  /** true=继续执行, false=阻止执行 */
  allowed: boolean
  /** 当 allowed=false 时的错误消息 */
  error?: string
  /** 可选的修改后输入 */
  modifiedInput?: Record<string, unknown>
}

/** 工具执行后钩子签名 */
export type PostToolHook = (toolName: string, input: Record<string, unknown>, result: unknown) => 
  void | Promise<void>

/** LLM 请求前钩子签名 */
export type PreTurnHook = (messages: unknown[]) => 
  PreTurnHookResult | Promise<PreTurnHookResult>

export interface PreTurnHookResult {
  /** true=继续请求, false=跳过 */
  proceed: boolean
  /** 可选的修改后消息列表 */
  modifiedMessages?: unknown[]
}

/** LLM 响应后钩子签名 */
export type PostTurnHook = (messages: unknown[], responseText: string) => 
  void | Promise<void>

/** 任意钩子处理函数（类型联合） */
export type HookHandler = PreToolHook | PostToolHook | PreTurnHook | PostTurnHook

/** 钩子阶段到处理函数签名的映射 */
export interface HookHandlerMap {
  preTool: PreToolHook
  postTool: PostToolHook
  preTurn: PreTurnHook
  postTurn: PostTurnHook
}
```

### 2.3 注册表核心实现

```typescript
// registry.ts

export class HookRegistry {
  private hooks: Map<HookPhase, Map<string, HookHandler>> = new Map()

  /** 注册一个钩子 */
  register<P extends HookPhase>(
    phase: P,
    name: string,
    handler: HookHandlerMap[P]
  ): void {
    if (!this.hooks.has(phase)) {
      this.hooks.set(phase, new Map())
    }
    this.hooks.get(phase)!.set(name, handler)
  }

  /** 取消注册一个钩子 */
  unregister(phase: HookPhase, name: string): boolean {
    const phaseHooks = this.hooks.get(phase)
    if (!phaseHooks) return false
    return phaseHooks.delete(name)
  }

  /** 获取某阶段的所有钩子 */
  getHooks<P extends HookPhase>(phase: P): Map<string, HookHandlerMap[P]> {
    return (this.hooks.get(phase) ?? new Map()) as Map<string, HookHandlerMap[P]>
  }

  /** 清空所有钩子 */
  clear(): void {
    this.hooks.clear()
  }

  /** 获取所有已注册钩子的摘要 */
  getSummary(): Array<{ phase: HookPhase; name: string }> {
    const summary: Array<{ phase: HookPhase; name: string }> = []
    for (const [phase, handlers] of this.hooks) {
      for (const name of handlers.keys()) {
        summary.push({ phase, name })
      }
    }
    return summary
  }
}
```

### 2.4 执行引擎

执行引擎负责按顺序调用所有已注册的钩子：

```typescript
// 在 registry.ts 中新增

export async function executePreToolHooks(
  registry: HookRegistry,
  toolName: string,
  input: Record<string, unknown>
): Promise<PreToolHookResult> {
  const handlers = registry.getHooks('preTool')
  let currentInput = input
  for (const [, handler] of handlers) {
    const result = await (handler as PreToolHook)(toolName, currentInput)
    if (!result.allowed) {
      return { allowed: false, error: result.error ?? 'Blocked by hook' }
    }
    if (result.modifiedInput) {
      currentInput = result.modifiedInput
    }
  }
  return { allowed: true, modifiedInput: currentInput }
}

export async function executePostToolHooks(
  registry: HookRegistry,
  toolName: string,
  input: Record<string, unknown>,
  result: unknown
): Promise<void> {
  const handlers = registry.getHooks('postTool')
  for (const [, handler] of handlers) {
    await (handler as PostToolHook)(toolName, input, result)
  }
}

export async function executePreTurnHooks(
  registry: HookRegistry,
  messages: unknown[]
): Promise<PreTurnHookResult> {
  const handlers = registry.getHooks('preTurn')
  let currentMessages = messages
  for (const [, handler] of handlers) {
    const result = await (handler as PreTurnHook)(currentMessages)
    if (!result.proceed) {
      return { proceed: false }
    }
    if (result.modifiedMessages) {
      currentMessages = result.modifiedMessages
    }
  }
  return { proceed: true, modifiedMessages: currentMessages }
}

export async function executePostTurnHooks(
  registry: HookRegistry,
  messages: unknown[],
  responseText: string
): Promise<void> {
  const handlers = registry.getHooks('postTurn')
  for (const [, handler] of handlers) {
    await (handler as PostTurnHook)(messages, responseText)
  }
}
```

### 2.5 集成层 (`ask()` 和 `conversationLoop()`)

提供两种方式启用钩子：

**方式 1: 在 SessionEngine 中集成（推荐）**

```typescript
// integration.ts
import type { HookRegistry } from './registry.js'

export interface HookOptions {
  enabled?: boolean
  registry?: HookRegistry
}
```

在 `engine.ts` 中新增 `hooks` 配置项，在 `ask()` 流程中插入：

```typescript
// 在工具调用前
if (hooksEnabled && hookRegistry) {
  const result = await executePreToolHooks(hookRegistry, toolName, input)
  if (!result.allowed) {
    return { error: result.error ?? 'Blocked by hook' }
  }
  input = result.modifiedInput ?? input
}

// 在工具调用后
if (hooksEnabled && hookRegistry) {
  await executePostToolHooks(hookRegistry, toolName, input, toolResult)
}
```

**方式 2: 在 conversationLoop 中集成**

```typescript
// loop.ts 扩展
const loopHooks = options?.hooks
if (loopHooks?.enabled && loopHooks.registry) {
  const result = await executePreTurnHooks(loopHooks.registry, messages)
  if (!result.proceed) return
  messages = result.modifiedMessages ?? messages
}
```

### 2.6 HookSystem 门面（统一入口）

```typescript
// index.ts
export class HookSystem {
  readonly registry: HookRegistry

  constructor() {
    this.registry = new HookRegistry()
  }

  register<P extends HookPhase>(phase: P, name: string, handler: HookHandlerMap[P]): void {
    this.registry.register(phase, name, handler)
  }

  unregister(phase: HookPhase, name: string): boolean {
    return this.registry.unregister(phase, name)
  }

  clear(): void {
    this.registry.clear()
  }

  getSummary() {
    return this.registry.getSummary()
  }
}
```

---

## 3. 测试计划 (TDD)

### 3.1 单元测试

| # | 测试场景 | 断言 |
|---|---------|------|
| 1 | 注册 preTool 钩子 | 注册后可通过 getHooks 获取 |
| 2 | 注册 postTool 钩子 | 同上 |
| 3 | 注册 preTurn 钩子 | 同上 |
| 4 | 注册 postTurn 钩子 | 同上 |
| 5 | 取消注册 | unregister 返回 true，钩子不再存在 |
| 6 | 取消不存在的钩子 | unregister 返回 false |
| 7 | preTool 阻止执行 | executePreToolHooks 返回 allowed=false |
| 8 | preTool 修改输入 | executePreToolHooks 返回修改后的 input |
| 9 | preTool 链式执行 | 多个钩子按注册顺序依次执行 |
| 10 | preTurn 阻止请求 | executePreTurnHooks 返回 proceed=false |
| 11 | preTurn 修改消息 | executePreTurnHooks 返回修改后的 messages |
| 12 | postTool 执行 | 钩子被调用且收到正确参数 |
| 13 | postTurn 执行 | 钩子被调用且收到正确参数 |
| 14 | 清空所有钩子 | clear 后 getSummary 为空 |
| 15 | getSummary 返回注册摘要 | 包含 phase 和 name |
| 16 | 无钩子时 preTool 执行 | allowed=true，input 不变 |
| 17 | 无钩子时 preTurn 执行 | proceed=true，messages 不变 |

### 3.2 集成测试

| # | 测试场景 | 断言 |
|---|---------|------|
| 18 | HookSystem 门面类 | register/unregister/clear 工作正常 |
| 19 | 并发安全 | 多次 register 不冲突 |

---

## 4. 边界情况

| 场景 | 处理方式 |
|------|---------|
| 注册同名钩子 | 后者覆盖前者（Map 语义） |
| async 钩子 | 完全支持 Promise |
| 钩子抛出异常 | 异常向上传播，集成层 catch 可降级 |
| 空注册表 | 执行引擎返回默认值（allowed/proceed=true） |
| 钩子修改输入但返回空 | 使用原始输入 |

---

## 5. 文件产出清单

| 文件 | 说明 |
|------|------|
| `src/hooks/types.ts` | 钩子类型、签名接口定义 |
| `src/hooks/registry.ts` | HookRegistry 类 + 执行函数 |
| `src/hooks/index.ts` | HookSystem 门面 + 类型重导出 |
| `src/__tests__/hooks.test.ts` | 17+ 单元测试 + 集成测试 |
| `src/hooks/integration.ts` | （可选）集成配置类型，实际集成在 engine.ts/loop.ts 中 |
