# Phase 2-E: Session Engine 补齐 — 设计文档

## 1. 差距分析

### 1.1 当前 SDK 状态 (Phase 1)

| 模块 | 状态 | 行数 |
|------|------|------|
| `src/session/engine.ts` (ClaudeCodeSDK) | 基础 session 管理 | 236 行 |
| `src/conversation/manager.ts` | Phase 2 已扩展 compact/token | 191 行 |
| 消息类型 | 基础 message types | 123 行 |
| 配置类型 | 基础 SDKConfig | 64 行 |

### 1.2 参考源码关键功能

| 参考文件 | 功能 | 行数 | SDK 差距 |
|----------|------|------|----------|
| `attribution.ts` | 归因文本生成、prompt 计数、增强 PR attribution | 394 行 | ❌ 无 |
| `attributionHooks.ts` | 归因 hooks | 5 行 | ❌ 无 |
| `attributionTrailer.ts` | 归因 trailer | 4 行 | ❌ 无 |
| `conversationRecovery.ts` | 会话反序列化、恢复、session 加载 | 601 行 | ❌ 无 |
| `fileHistory.ts` | 文件历史管理 | 大型 | ❌ 无 |

### 1.3 SDK 差异化设计原则

参考源码深度耦合 Claude Code 运行时 (AppState、transcript 文件、settings、Bun 特定 API)。
SDK 需做以下适配:
- ✅ **移除** Bun 特定 API (`bun:bundle/feature`, `process.env.USER_TYPE` 等)
- ✅ **移除** 对 `AppState` 的直接依赖 — 用轻量 `SessionMetadata` 替代
- ✅ **简化** 会话持久化 — 使用 JSON 文件而非 transcript jsonl 格式
- ✅ **适配** 消息类型 — 使用 SDK 自身的 `Message` 类型而非 `NormalizedMessage`
- ✅ **适配** 模型命名 — 移除 Claude Code 内部模型识别逻辑，使用用户配置的 model name

---

## 2. 架构设计

### 2.1 新增文件结构

```
src/session/
  ├── engine.ts          # 扩展 ClaudeCodeSDK
  ├── index.ts           # 更新导出
  ├── attribution.ts     # [NEW] 对话归因系统
  └── persistence.ts     # [NEW] 会话持久化/恢复
```

### 2.2 依赖关系

```
ClaudeCodeSDK (engine.ts)
  ├── AttributionManager (attribution.ts)
  │     └── 依赖: types/message.ts, types/config.ts
  └── SessionPersistence (persistence.ts)
        └── 依赖: types/message.ts, conversation/manager.ts
```

---

## 3. 详细设计

### 3.1 Attribution 系统 (`src/session/attribution.ts`)

#### 类型定义

```typescript
/** 消息来源类型 — 对话归因核心 */
export type MessageSource = 'user' | 'assistant' | 'tool' | 'system'

/** 归因模式 */
export type AttributionMode = 'none' | 'simple' | 'full'

/** 单条消息的归因元数据 */
export interface AttributionMetadata {
  source: MessageSource
  turnNumber: number          // 对话轮次编号 (从 1 开始)
  timestamp: string           // ISO 时间戳
  sourceLabel?: string        // 可选来源标签 (如工具名、模型名)
}

/** 归因统计 */
export interface AttributionStats {
  totalTurns: number
  userMessageCount: number
  assistantMessageCount: number
  toolCallCount: number
  uniqueTools: string[]
  startTime: string
  lastActivityTime: string
}

/** 归因文本(用于 commit/PR attribution) */
export interface AttributionTexts {
  commit: string    // "Co-Authored-By: claude-sonnet-4-20250514 <noreply@anthropic.com>"
  pr: string        // "🤖 Generated with Claude Code"
}
```

#### ATTRIBUTION_URL 常量

```typescript
export const PRODUCT_URL = 'https://claude.ai'
export const DEFAULT_ATTRIBUTION_TEXTS: AttributionTexts = {
  commit: '',
  pr: 'Generated with Claude Code SDK',
}
```

#### AttributionManager 类

```typescript
export class AttributionManager {
  constructor(config?: { mode?: AttributionMode; modelName?: string })

  // 消息来源标记 — 记录消息归属
  recordMessage(source: MessageSource, options?: { toolName?: string }): AttributionMetadata

  // 获取当前轮次编号
  getCurrentTurn(): number

  // 获取完整归因统计
  getStats(): AttributionStats

  // 生成归因文本 (commit/PR attribution)
  getAttributionTexts(): AttributionTexts

  // 重置归因状态
  reset(): void

  // 序列化/反序列化
  serialize(): AttributionSnapshot
  static deserialize(snapshot: AttributionSnapshot): AttributionManager
}
```

### 3.2 会话持久化/恢复 (`src/session/persistence.ts`)

#### 类型定义

```typescript
/** 会话状态快照 — 用于持久化 */
export interface SessionSnapshot {
  id: string
  createdAt: string
  updatedAt: string
  messageCount: number
  tokenUsage: { inputTokens: number; outputTokens: number }
  messages: Array<{
    id: string
    role: string
    content: string | unknown
    createdAt: string
    metadata?: Record<string, unknown>
  }>
  metadata: SessionMetadata
  attribution?: AttributionSnapshot
}

/** 会话元数据 */
export interface SessionMetadata {
  id: string
  label?: string
  tags?: string[]
  modelName?: string
  systemPrompt?: string
  customData?: Record<string, unknown>
}

/** 会话恢复结果 */
export interface SessionRestoreResult {
  session: SessionSnapshot
  messageCount: number
  totalTokens: number
}

/** 会话状态 */
export type SessionStatus = 'active' | 'paused' | 'completed' | 'archived'
```

#### SessionPersistence 类

```typescript
export class SessionPersistence {
  constructor(storageDir?: string)

  // 保存会话快照到文件
  async save(snapshot: SessionSnapshot): Promise<string>

  // 从文件加载会话
  async load(sessionId: string): Promise<SessionSnapshot | null>

  // 列出所有已保存的会话
  async listSessions(): Promise<Array<{ id: string; label?: string; createdAt: string; status: SessionStatus }>>

  // 删除会话
  async delete(sessionId: string): Promise<boolean>

  // 从 ConversationManager 构建快照
  buildSnapshot(messages: Message[], tokenUsage: TokenUsage, metadata?: Partial<SessionMetadata>): SessionSnapshot

  // 恢复消息到 ConversationManager
  restoreMessages(snapshot: SessionSnapshot): Message[]

  // 检查会话是否可恢复
  canRestore(snapshot: SessionSnapshot): boolean

  // 中断检测 — 参考 conversationRecovery.ts 的 detectTurnInterruption
  detectInterruption(messages: Message[]): { interrupted: boolean; lastTurnComplete: boolean }
}
```

### 3.3 SessionEngine 配置扩展 (`src/types/config.ts`)

```typescript
// 新增到 SDKConfig
export interface SDKConfig {
  // ... 现有字段

  session?: {
    maxTurns?: number                          // 最大对话轮次 (default: 0 = unlimited)
    timeout?: number                           // 会话超时 ms (default: 0 = no timeout)
    idleTimeout?: number                       // 空闲超时 ms (default: 0 = no timeout)
    attributionMode?: AttributionMode          // 归因模式 (default: 'simple')
    autoSave?: boolean                         // 自动保存 (default: false)
    autoSaveInterval?: number                  // 自动保存间隔 ms (default: 60000)
    storageDir?: string                        // 持久化存储目录
    modelName?: string                         // 归因使用的模型名
    sessionLabel?: string                      // 会话标签
    sessionTags?: string[]                     // 会话标签列表
  }
}
```

### 3.4 ClaudeCodeSDK 扩展 (`src/session/engine.ts`)

```typescript
export class ClaudeCodeSDK {
  // ... 现有属性和方法

  // [NEW] Attribution 集成
  private readonly _attribution?: AttributionManager

  // [NEW] 持久化集成
  private readonly _persistence?: SessionPersistence

  // [NEW] 扩展配置
  private _sessionStatus: SessionStatus
  private _turnCount: number
  private _lastActivityTime: number

  // 现有方法增强
  send(message: string): Promise<SessionResponse>  // 增加轮次计数和归因记录
  stream(message: string): AsyncIterable<StreamEvent>  // 增加归因元数据

  // [NEW] 归因相关 API
  getAttribution(): AttributionManager | undefined
  getAttributionTexts(): AttributionTexts
  getAttributionStats(): AttributionStats | undefined

  // [NEW] 持久化相关 API
  async saveSession(label?: string): Promise<string>
  static async loadSession(sessionId: string, config: SDKConfig): Promise<ClaudeCodeSDK | null>
  async deleteSession(sessionId: string): Promise<boolean>
  listSavedSessions(): Promise<Array<...>>

  // [NEW] 会话管理 API
  getSessionId(): string
  getSessionStatus(): SessionStatus
  getTurnCount(): number
  pauseSession(): void
  resumeSession(): void
  completeSession(): void
}
```

---

## 4. 与参考源码的关键映射

| 参考源码概念 | SDK 实现 | 差异说明 |
|-------------|----------|---------|
| `attribution.ts` 的 `getAttributionTexts()` | `AttributionManager.getAttributionTexts()` | 移除 AppState/transcript 依赖，使用简单计数 |
| `attribution.ts` 的 `countUserPromptsInMessages()` | `AttributionManager.getStats().userMessageCount` | 简化为按 source 过滤 |
| `attribution.ts` 的 `getEnhancedPRAttribution()` | 通过 getAttributionTexts() 二阶段增强 | SDK 版本更简洁 |
| `conversationRecovery.ts` 的 `loadConversationForResume()` | `SessionPersistence.load()` + `restoreMessages()` | 移除 transcript 链行走、sidechain 过滤 |
| `conversationRecovery.ts` 的 `deserializeMessages()` | `SessionPersistence.restoreMessages()` | 简化过滤逻辑 |
| `conversationRecovery.ts` 的 `detectTurnInterruption()` | `SessionPersistence.detectInterruption()` | 适配 SDK Message 类型 |
| `fileHistory.ts` | 不实现 (Phase 2 范围外) | Phase 2-E 专注归因 + 恢复 |

---

## 5. 测试策略

| 测试文件 | 测试内容 | 预计测试数 |
|----------|---------|-----------|
| `src/__tests__/attribution.test.ts` | AttributionManager: 来源标记、轮次计数、统计、文本生成、序列化 | ~12 个 |
| `src/__tests__/persistence.test.ts` | SessionPersistence: 快照构建、保存/加载、恢复、中断检测 | ~12 个 |
| `src/__tests__/session-engine-phase2.test.ts` | ClaudeCodeSDK 集成: 扩展配置、attribution 集成、persistence 集成 | ~12 个 |

---

## 6. 实施顺序

1. **Task 2+3 (并行)**: TDD → 实现 Attribution 系统
2. **Task 4+5 (并行)**: TDD → 实现 SessionPersistence
3. **Task 6+7 (串行)**: TDD → 实现 SessionEngine 配置扩展与集成
4. **Task 8**: 全量测试 + 审查 + 导出更新
