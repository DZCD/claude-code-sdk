# SDK 测试体系审查报告

> 审查日期：2026-05-28
> 审查人：SDK 测试架构设计与质量保障负责人

---

## 一、现有测试概况

| 指标 | 数值 |
|------|------|
| 测试文件数 | 51（含 `src/` 下子目录中的 `__tests__`） |
| 测试用例数 | 986 |
| Statements 覆盖率 | 84.66% |
| Branches 覆盖率 | 79.69% |
| Functions 覆盖率 | 86.92% |
| Lines 覆盖率 | 84.66% |

### 测试文件分类

| 分类 | 数量 | 说明 |
|------|------|------|
| 纯单元测试（全 mock） | ~46 | 使用 `vi.fn()` 或 mock connector，无真实 API 调用 |
| 假集成测试（多模块拼装 + mock LLM） | ~5 | 如 `conversation-manager.integration.test.ts`、`session-engine.integration.test.ts` 等，虽名为 integration，但 LLM 层仍用 mock |
| 真实 E2E（调真实 API） | **0** | ❌ 所有测试均未调用过真实 API |

---

## 二、现有测试分布

### src/__tests__/ 目录（31 个文件）

```
src/__tests__/
├── types.test.ts                    # 类型系统测试
├── tools.test.ts                    # 工具注册/执行测试
├── permission.test.ts               # 权限管理测试
├── config.test.ts                   # 配置管理测试
├── config-phase2.test.ts            # Phase 2 配置扩展
├── config-validation.test.ts        # 配置验证测试
├── conversation-manager.integration.test.ts  # 对话管理（mock）
├── session-engine.integration.test.ts        # 会话引擎（mock）
├── session-engine-phase2.test.ts    # Phase 2 会话扩展
├── tool-permission.integration.test.ts       # 工具权限（mock）
├── config-manager.integration.test.ts        # 配置管理器（mock）
├── context-builder.integration.test.ts       # 上下文构建（mock）
├── loop-edge-cases.test.ts          # 循环边缘情况
├── mcp.test.ts                      # MCP 协议测试
├── mcp-phase2.test.ts               # Phase 2 MCP 扩展
├── attribution.test.ts              # 归因系统测试
├── persistence.test.ts              # 持久化测试
├── dangerous-patterns.test.ts       # 危险模式检测
├── bash-classifier.test.ts          # Bash 命令分类器
├── path-validation.test.ts          # 路径验证测试
├── permission-extensions.test.ts    # 权限扩展测试
├── feedback.test.ts                 # 反馈注入测试
├── ask.test.ts                      # Ask 循环测试
├── hooks.test.ts                    # 钩子系统测试
├── built-in/
│   ├── built-in.test.ts             # 内置工具测试
│   └── web-search-d3.test.ts       # Web Search 测试
└── bash-security-utils/
    ├── types.test.ts
    ├── bashSecurity.test.ts
    ├── pathValidation.test.ts
    ├── bashPermissions.test.ts
    └── sedAndMode.test.ts
```

### src/**/__tests__/ 目录（20 个文件）

```
src/context/__tests__/
├── builder-extensions.test.ts
├── git-diff.test.ts
├── git.test.ts
└── memory-file.test.ts

src/conversation/__tests__/
├── auto-compact.test.ts
├── circular-buffer.test.ts
├── manager-extensions.test.ts
├── micro-compact.test.ts
├── token-budget.test.ts
└── token-tracker.test.ts

src/llm/__tests__/
├── bedrock.test.ts
├── client.test.ts
├── foundry.test.ts
├── preconnect.test.ts
├── retry.test.ts
└── vertex.test.ts

src/logging/__tests__/
├── debugFilter.test.ts
└── index.test.ts

src/rate-limit/__tests__/
└── cooldown.test.ts

src/streaming/__tests__/
└── consumer.test.ts
```

---

## 三、覆盖率漏洞分析

### 3.1 零覆盖率的模块

| 文件 | Statements | 风险说明 |
|------|-----------|---------|
| `src/types/config.ts` | 0% | 纯类型定义（通常无需覆盖） |
| `src/types/tool.ts` | 0% | 纯类型定义 |
| `src/types/index.ts` | 0% | 仅 re-export，可忽略 |
| `src/tools/built-in/index.ts` | 45% | re-export 集中，行数少 |

➡ **结论：零覆盖率的文件均为纯类型/导出文件，不构成实际风险。**

### 3.2 低覆盖率的模块（需关注）

| 文件 | Statements | 风险说明 |
|------|-----------|---------|
| `src/tools/built-in/glob.ts` | 68.62% | 文件搜索工具，边界 case（权限错误、符号链接）未覆盖 |
| `src/tools/built-in/grep.ts` | 67.26% | 内容搜索工具，多种搜索模式边缘 case 缺覆盖 |
| `src/tools/built-in/web_fetch.ts` | 69.23% | HTTP 请求工具，错误处理和重试逻辑覆盖率低 |
| `src/tools/built-in/file_edit.ts` | 74.66% | 文件编辑工具，sed 解析边缘 case |
| `src/tools/built-in/file_write.ts` | 76% | 文件写入工具，权限错误处理 |
| `src/tools/built-in/web_search.ts` | 81.03% | Web Search，分支覆盖率仅 55.26%，大量错误路径未测 |
| `src/permission/bashSecurity.ts` | 88.84% | Bash 安全检查，分支覆盖率 87.06%（尚可但可补充） |
| `src/tools/built-in/bash-security-utils/sedEditParser.ts` | 78.72% | sed 编辑解析，分支覆盖率 75% |

### 3.3 缺少的测试场景

1. **网络错误处理** — 所有 LLM 连接的 retry/error 逻辑只用 mock 验证，未在真实网络条件下测试
2. **工具执行失败恢复** — 工具抛出异常时，ConversationManager 的行为未充分测试
3. **流式中断恢复** — stream 中途断开后 SDK 行为
4. **并发安全** — 同时调用 `send()` 的行为未定义
5. **大消息/长上下文** — ContextBuilder 在大量文件时的行为
6. **MCP 连接失败** — MCP Server 连接超时/失败时的降级行为

---

## 四、测试架构评估

### 当前架构问题

```
┌──────────────────────────────────────────────────────┐
│                   当前测试架构                          │
├──────────────────────────────────────────────────────┤
│  Unit Tests (986)                                    │
│  └── 全部使用 mock/fake LLMConnector                  │
│  └── 无真实 API 调用                                  │
│  └── 无法验证实际 Anthropic API 兼容性                  │
├──────────────────────────────────────────────────────┤
│  缺失层                                              │
│  ❌ 真实 API 集成测试                                  │
│  ❌ 端到端场景测试                                     │
│  ❌ CI 质量门禁                                        │
└──────────────────────────────────────────────────────┘
```

### 目标架构

```
┌──────────────────────────────────────────────────────────┐
│                   三层测试架构（目标）                       │
├──────────────────────────────────────────────────────────┤
│  第 1 层: Unit Tests (≥90%)                              │
│  ├── 全 mock 外部依赖                                    │
│  ├── 覆盖逻辑正确性、边界 case                            │
│  └── 运行 < 30s                                         │
├──────────────────────────────────────────────────────────┤
│  第 2 层: Integration Tests (真实 API)                    │
│  ├── 调 DeepSeek API (Anthropic 兼容)                    │
│  ├── send/stream 全流程                                  │
│  ├── 工具调用注册与执行                                   │
│  ├── 多轮对话上下文保持                                   │
│  └── 运行 < 120s                                        │
├──────────────────────────────────────────────────────────┤
│  第 3 层: E2E Scenarios (真实 API)                       │
│  ├── 模拟用户完整使用流程                                 │
│  ├── 错误恢复测试                                        │
│  ├── 可独立运行脚本                                      │
│  └── 运行 < 300s                                        │
└──────────────────────────────────────────────────────────┘
```

---

## 五、改进建议

### 高优先级

1. **立即添加真实 API E2E 测试** ✅（本任务已完成）
   - `llm-connection.test.ts` — API 连通性
   - `tool-call.test.ts` — 工具调用
   - `conversation.test.ts` — 多轮对话
   - `streaming.test.ts` — 流式输出

2. **提高覆盖率阈值**
   - 当前: Statements 75%, Branches 70%, Functions 75%, Lines 75%
   - 目标: Statements ≥ 90%, Branches ≥ 80%, Functions ≥ 90%, Lines ≥ 90%

3. **补全低覆盖率模块的单元测试**
   - `glob.ts` (68.62%) — 符号链接、权限拒绝、空结果
   - `grep.ts` (67.26%) — 大文件、二进制文件、权限错误
   - `web_fetch.ts` (69.23%) — 超时、重定向、DNS 错误
   - `web_search.ts` (81.03%) — 搜索失败、空结果、速率限制

### 中优先级

4. 集成 E2E 测试到 CI pipeline，使用 `--runInBand` 避免 API 限流
5. 设置 `test.concurrent.skip` 标记依赖 API 的测试，在无 API key 环境跳过
6. 为 E2E 测试添加 `--test-timeout=60000` 超时配置

---

## 六、当前覆盖率阈值配置

```typescript
// vitest.config.ts (当前)
thresholds: {
  branches: 70,
  functions: 75,
  lines: 75,
  statements: 75,
}
```

### 建议更新

```typescript
// vitest.config.ts (目标)
thresholds: {
  branches: 80,
  functions: 90,
  lines: 90,
  statements: 90,
}
```

---

*报告结束*
