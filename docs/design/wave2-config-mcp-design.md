# Phase 2 补齐设计：配置管理 + MCP 资源/提示模板支持

## 概述

本设计文档涵盖两个子模块的 Phase 2 补齐工作。严格遵循 Superpowers TDD 流程：先提交设计审查 → TDD（测试先行）→ 实现 → 审查。

---

## Phase 2-Ha: 配置管理补齐

### 1. 差距分析

| 功能 | 参考源码 (config.ts 1818行) | 当前 SDK (134行) | 差距 |
|------|---------------------------|------------------|------|
| settings.json 读写 | `saveGlobalConfig`, `getGlobalConfig`, `saveConfigWithLock`, 锁机制、备份、归约存储 | 无 | ❌ 缺失 |
| 多源合并 | 默认 → 文件 → 环境变量 → 程序化覆盖，嵌套深度合并 | 仅有 `_merge` 基础合并 | ⚠️ 部分 |
| 配置验证 | `ConfigParseError`、JSON schema 校验 | 无 | ❌ 缺失 |
| 配置变更通知 | `fs.watchFile` 轮询 + freshness watcher | 无 | ❌ 缺失 |
| 配置持久化 | 原子写入 + 锁 + 备份 + 损坏恢复 | 无 | ❌ 缺失 |

### 2. 核心接口设计

#### 2.1 `ConfigManager` 增强（src/config/manager.ts）

```typescript
export class ConfigManager {
  // 已有方法保持不变
  private _config: SDKConfig
  constructor(config?: Partial<SDKConfig>)
  getConfig(): SDKConfig
  getLLMConfig(): LLMConfig
  update(partial: Partial<SDKConfig>): void
  loadFromEnv(): Partial<SDKConfig>
  mergeFromEnv(): void
  reset(): void

  // ==== 新增方法 ====

  // 2.1.1 配置文件读写
  loadFromFile(path: string): void
  saveToFile(path: string): void

  // 2.1.2 多源合并（优先级：默认 < 文件 < 环境变量 < CLI参数）
  loadFromSources(options: ConfigSources): void
  getEffectiveConfig(): SDKConfig

  // 2.1.3 配置验证
  validate(schema?: ConfigSchema): ConfigValidationResult
  validateRequired(): string[]

  // 2.1.4 配置变更通知
  onDidChange(callback: ConfigChangeCallback): () => void
  watch(path: string): void
  unwatch(): void
}

export interface ConfigSources {
  filePath?: string           // settings.json 路径
  env?: Record<string, string> // 环境变量覆盖
  cliArgs?: Record<string, unknown> // CLI 参数覆盖
}

export interface ConfigChangeEvent {
  key: string
  oldValue?: unknown
  newValue?: unknown
}

export interface ConfigSchema {
  required?: string[]
  properties?: Record<string, {
    type: string
    required?: boolean
    default?: unknown
  }>
}

export type ConfigChangeCallback = (event: ConfigChangeEvent) => void
```

#### 2.2 多源合并优先级模型

```
优先级排序（低 → 高）:
1. 默认配置 (SDKConfig defaults)
2. settings.json 文件配置
3. 环境变量 (process.env)
4. 程序化 API 调用 (update / CLI args)
```

合并策略：
- 顶层字段直接覆盖
- 嵌套对象（llm、context、conversation、global）使用浅合并
- 数组字段（permissionRules、mcpServers）整体替换

#### 2.3 配置持久化

参考 `saveConfigWithLock` 的原子写入模式：
1. 创建 `.json.lock` 锁防止并发写入
2. 反序列化时过滤掉与默认值相同的字段（归约存储）
3. 写前创建时间戳备份（`~/.claude/backups/`）
4. 文件权限 `0o600`
5. 损坏检测与备份恢复提示

#### 2.4 配置验证

- `validate()`: 检查配置结构完整性
  - 必填字段检查（apiKey 对 Anthropic provider 必填）
  - 类型校验（字符串、数字、布尔等）
  - 枚举值校验（provider、permissionMode）
- `validateRequired()`: 返回缺失的必填字段列表

#### 2.5 变更通知

- `onDidChange()`: 注册回调，返回取消函数
- `watch(path)`: 使用 `fs.watchFile` 轮询文件变更
- 变更事件包含变更键、旧值、新值

### 3. 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| src/config/manager.ts | 修改 | 增强 ConfigManager 类 |
| src/config/index.ts | 修改 | 导出新类型 |
| src/config/constants.ts | 新增 | 配置常量与模式定义 |
| src/__tests__/config-phase2.test.ts | 新增 | Phase 2 测试 |
| src/__tests__/config-manager.integration.test.ts | 修改 | 补充集成测试 |

---

## Phase 2-Hb: MCP 资源/提示模板支持

### 1. 差距分析

| 功能 | 参考源码 (ListMcpResourcesTool + ReadMcpResourceTool) | 当前 SDK | 差距 |
|------|------------------------------------------------------|----------|------|
| 资源列出 | `fetchResourcesForClient()`, `client.request({ method: 'resources/list' })` | 无 | ❌ 缺失 |
| 资源读取 | `client.request({ method: 'resources/read', params: { uri } })`, 二进制 blob 处理 | 无 | ❌ 缺失 |
| 提示模板列出 | `client.request({ method: 'prompts/list' })` | 无 | ❌ 缺失 |
| 提示模板获取 | `client.getPrompt({ name, arguments })` | 无 | ❌ 缺失 |
| 能力检测 | `client.getServerCapabilities()` 检查 resources/prompts 支持 | 仅检测 tools | ⚠️ 部分 |

### 2. 核心接口设计

#### 2.1 `MCPServerManager` 增强（src/mcp/manager.ts）

资源操作：
```typescript
export class MCPServerManager {
  // 已有方法保持不变

  // ==== 新增：资源支持 ====
  listResources(serverName?: string): Promise<MCPResourceDefinition[]>
  readResource(serverName: string, uri: string): Promise<MCPResourceContent[]>

  // ==== 新增：提示模板支持 ====
  listPrompts(serverName?: string): Promise<MCPPromptDefinition[]>
  getPrompt(serverName: string, name: string, args?: Record<string, string>): Promise<MCPGetPromptResult>
}
```

#### 2.2 新增类型（src/mcp/types.ts）

```typescript
// ==== 资源类型 ====
export interface MCPResourceDefinition {
  uri: string
  name: string
  description?: string
  mimeType?: string
  server: string  // 来源服务器
}

export interface MCPResourceContent {
  uri: string
  mimeType?: string
  text?: string
  blob?: string
}

export interface MCPPromptDefinition {
  name: string
  description?: string
  arguments?: MCPPromptArgument[]
}

export interface MCPPromptArgument {
  name: string
  description?: string
  required?: boolean
}

export interface MCPGetPromptResult {
  description?: string
  messages: Array<{
    role: string
    content: unknown
  }>
}
```

#### 2.3 实现细节

**资源列出 (`listResources`)**:
1. 检查服务器 capabilities.resources
2. 使用 `client.request({ method: 'resources/list' }, ListResourcesResultSchema)`
3. 为每个资源添加 `server` 字段
4. 支持按 serverName 过滤
5. 单服务器失败不阻断其他服务器

**资源读取 (`readResource`)**:
1. 查找指定服务器连接
2. 检查 `capabilities.resources`
3. 使用 `client.request({ method: 'resources/read', params: { uri } }, ReadResourceResultSchema)`
4. 返回资源内容（text/blob）

**提示模板列出 (`listPrompts`)**:
1. 检查 capabilities.prompts
2. 使用 `client.request({ method: 'prompts/list' }, ListPromptsResultSchema)`
3. 支持按 serverName 过滤

**提示模板获取 (`getPrompt`)**:
1. 查找指定服务器
2. 检查 capabilities.prompts
3. 使用 `client.getPrompt({ name, arguments: args })`
4. 返回消息列表

### 3. 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| src/mcp/types.ts | 修改 | 新增资源/提示模板类型 |
| src/mcp/manager.ts | 修改 | 新增资源/提示模板方法 |
| src/mcp/index.ts | 修改 | 导出新类型 |
| src/__tests__/mcp-phase2.test.ts | 新增 | Phase 2 MCP 测试 |

---

## 4. 优先级顺序

1. **Wave 1**: 配置管理 — settings.json 读写 + 多源合并（核心基础）
2. **Wave 2**: 配置管理 — 验证 + 变更通知
3. **Wave 3**: MCP — 资源支持（list + read）
4. **Wave 4**: MCP — 提示模板支持（list + get）

---

## 5. 测试策略

每个功能模块遵循 TDD 流程：
1. 先写测试（测试先行）
2. 再写实现代码
3. 验证所有测试通过
4. 运行全量测试确保无回归

**测试覆盖率目标**:
- Config Phase 2: 新增功能 > 90% 分支覆盖率
- MCP Phase 2: 新增功能 > 85% 分支覆盖率
- 全量测试无回归
