# claude-code-sdk 发布路线图

> 版本策略：SemVer 2.0 — 0.4.x 为预发布，1.0.0 为正式版

---

## 当前版本：v0.4.0 (Phase 3B — Developer Experience)

SDK 核心框架、8 个内置工具、3 个 LLM Provider、MCP 协议、流式消费 API、
ask() 自动循环、开发者示例 — 基本完备。

---

## 1.0.0 正式版路线

### v0.4.x — Bugfix & Polish（当前阶段）

| 版本 | 内容 |
|:---|:---|
| v0.4.1 | 紧急 bug 修复 |
| v0.4.2 | 安全补丁、依赖升级 |

- 只修 bug 和文档，不新增 feature
- 持续集成验证
- 社区反馈收集

### v0.5.0 — Phase 3C: 发布就绪

| 任务 | 内容 |
|:---|:---|
| A4 | npm 发布准备（CHANGELOG.md、.npmignore、发布脚本）— ✅ 已完成 |
| A5 | 版本策略 + ROADMAP.md |
| D1 | Hook System — 工具/对话事件钩子 |
| D2 | Feedback Loop — 用户反馈注入与重试 |
| D3 | WebSearch 增强 — 搜索结果结构化、多引擎 |

### v0.6.0 — Phase 3D: 运营就绪

| 任务 | 内容 |
|:---|:---|
| E2 | Logging & 可观测性（结构化日志、OpenTelemetry） |
| E3 | Rate Limiting & Backpressure |
| E4 | 配置验证增强（JSON Schema 完整校验） |

### v0.7.0 — Phase 3E: 文档 & 测试完备

| 任务 | 内容 |
|:---|:---|
| F1 | 集成测试覆盖率 >90%（当前 ~70%） |
| F2 | 端到端测试（含真实 API 调用） |
| F3 | API 文档自动发布（GitHub Pages / npm docs） |

### v1.0.0 — 正式版

**标准：**
1. ✅ 所有 Phase 1~3 任务完成
2. ✅ 全量测试 ≥ 1000 个
3. ✅ 代码覆盖率 Statements ≥ 85%，Branches ≥ 80%
4. ✅ API 完全文档化（JSDoc + TypeDoc）
5. ✅ npm publish 可用
6. ✅ CI 全绿色
7. ✅ 至少 3 个外部试用反馈关闭

---

## 版本兼容性承诺

| 领域 | 策略 |
|:---|:---|
| **Node.js** | ≥ 18.x（LTS） |
| **TypeScript** | ≥ 5.0 |
| **ESM** | 仅 ES Module（`"type": "module"`） |
| **API 稳定性** | v0.x 阶段 `@internal` 不保证稳定 |
| **破坏性变更** | v1.0 前：minor 版本可含 break；v1.0 后：仅 major |

## 发布流程

```bash
# 补丁发布
npm run release:patch

# 小版本发布  
npm run release:minor

# 大版本发布
npm run release:major
```

环境变量 `NPM_TOKEN` 需预先设置。
