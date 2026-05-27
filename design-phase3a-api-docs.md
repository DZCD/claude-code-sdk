# Phase 3A — API 文档方案设计

> **任务**: W1-A1: API 文档方案设计  
> **状态**: Design Doc (Superpowers Phase 2)  
> **日期**: 2026-05-27  
> **项目**: claude-code-sdk v0.2.0

---

## 1. 背景与目标

claude-code-sdk 是一个 standalone TypeScript SDK，目前有 **105 个源文件**、**11 个模块入口 (index.ts)**、全量测试 776+ 通过。当前缺少：

- 公开 API vs 内部实现的区分标注
- 自动生成的可浏览 API 文档
- CI 流水线中的文档构建步骤

**目标**: 引入 TypeDoc 并配合 `@public`/`@internal` 标签，输出 Markdown/HTML API 文档，集成到 `npm run docs` 和 CI。

---

## 2. 方案对比评估

### 方案 A: TypeDoc (推荐)

| 维度 | 评价 |
|------|------|
| **成熟度** | TypeScript 社区标准，5k+ GitHub Stars，维护活跃 |
| **标签支持** | 原生支持 `@public`、`@internal`、`@alpha`、`@beta`、`@deprecated` 等 |
| **输出格式** | HTML (默认)、Markdown (插件)、JSON |
| **配置复杂度** | 低 — 1 个 typedoc.json 即可 |
| **与 tsconfig 集成** | 天然继承 TypeScript 编译配置 |
| **插件生态** | `typedoc-plugin-markdown`、`typedoc-plugin-merge-modules` 等 |
| **CI 集成** | 简单 — 一行 npx typedoc 命令 |
| **缺点** | Markdown 输出需插件；大型项目首次运行较慢 |

### 方案 B: @microsoft/api-extractor + api-documenter

| 维度 | 评价 |
|------|------|
| **成熟度** | Microsoft RushStack 生态，但配置重 |
| **标签支持** | 支持 `@public`、`@internal`、`@beta`、`@preapproved` |
| **输出格式** | 生成 `.api.md` 暂存文件，再通过 api-documenter 转 Markdown/ Yaml |
| **配置复杂度** | 高 — 需要 `api-extractor.json`、`tsdoc-metadata.json` |
| **与 tsconfig 集成** | 需要额外配置 `exportConfig` |
| **插件生态** | 较封闭，扩展性差 |
| **CI 集成** | 可行但繁琐（两步构建） |
| **缺点** | 配置量大，学习曲线陡；对 monorepo/多入口项目支持弱 |

### 方案 C: 手写 API 文档

| 维度 | 评价 |
|------|------|
| **人工成本** | 极高 — 每个 API 变更都需手动同步 |
| **维护性** | 极易过期，不可持续 |
| **标签支持** | 无自动化标签机制 |
| **推荐度** | ❌ 不推荐 |

### 结论

**采用方案 A (TypeDoc)**，理由：
1. 零配置即可工作，与现有 `tsconfig.json` 兼容
2. `@public`/`@internal` 标签原生支持
3. 社区活跃，插件生态可扩展
4. CI 集成仅需 1 行命令
5. 当前 SDK 是单一 package，非 monorepo，TypeDoc 天然适合

---

## 3. TypeDoc 配置方案

### 3.1 安装依赖

```bash
npm install --save-dev typedoc typedoc-plugin-markdown
```

| 包 | 用途 |
|------|------|
| `typedoc` | 核心文档生成器 |
| `typedoc-plugin-markdown` | 输出 Markdown 格式（可选，默认 HTML 也可） |

### 3.2 typedoc.json

在项目根目录创建 `typedoc.json`：

```json
{
  "$schema": "https://typedoc.org/schema.json",
  "entryPoints": [
    "src/index.ts"
  ],
  "out": "docs",
  "plugin": ["typedoc-plugin-markdown"],
  "exclude": [
    "**/__tests__/**",
    "**/*.test.ts",
    "**/node_modules/**"
  ],
  "excludePrivate": true,
  "excludeProtected": true,
  "excludeExternals": true,
  "includeVersion": true,
  "cleanOutputDir": true,
  "tsconfig": "tsconfig.json",
  "sort": ["source-order"],
  "categorizeByGroup": true,
  "defaultCategory": "Internal",
  "categoryOrder": ["Session Engine", "Tool System", "LLM Layer", "Conversation", "Context", "Permission", "Config", "MCP", "Core Types", "Internal", "*"],
  "visibilityFilters": {
    "@public": true,
    "@protected": false,
    "@private": false,
    "@internal": false
  },
  "namedAnchors": true,
  "hideGenerator": true,
  "githubPages": true,
  "readme": "README.md"
}
```

**关键配置说明**：

| 配置项 | 作用 |
|--------|------|
| `entryPoints` | 单一入口 `src/index.ts`，符合当前 package.json 的 `exports` 结构 |
| `exclude` | 跳过测试文件，确保文档只包含生产代码 |
| `excludePrivate` | 不输出 `private` 成员 |
| `visibilityFilters` | 默认只显示 `@public` 标注的 API；`@internal` 默认隐藏 |
| `categorizeByGroup` | 按模块分组展示 |
| `defaultCategory` | 无标签的导出归为 "Internal" |
| `cleanOutputDir` | 每次构建前清理，避免残留 |

### 3.3 生成脚本 (package.json)

在 `scripts` 中新增：

```json
"scripts": {
  "docs": "typedoc",
  "docs:html": "typedoc --plugin none --out docs/html",
  "docs:serve": "typedoc --watch",
  "predocs": "npm run build"
}
```

说明：
- `npm run docs` — 默认 Markdown 输出（适合 GitHub 渲染和 CI 差异检查）
- `npm run docs:html` — 可选 HTML 输出，适合 GitHub Pages 部署
- `npm run predocs` — 构建前置检查，确保类型正确

### 3.4 输出格式选择

| 格式 | 适用场景 | 配置 |
|------|----------|------|
| Markdown (推荐) | GitHub 直接渲染；CI 可 diff | 默认（安装 `typedoc-plugin-markdown`） |
| HTML | GitHub Pages 托管 | `--plugin none --out docs/html` |
| JSON | 二次处理/自定义渲染 | `--json docs/api.json` |

**建议**: 默认输出 Markdown 到 `docs/`，同时可选 `docs:html` 用于 GitHub Pages 部署。

---

## 4. @public/@internal 标注规范

### 4.1 通用规则

```
@public     — 外部 SDK 用户可直接使用的 API（稳定承诺）
@internal   — 内部实现细节，不对外暴露（可随时变更）
无标签       — 默认视为 internal，在文档中归入 "Internal" 类别
```

### 4.2 标签格式

使用标准 JSDoc/TSDoc 行内注释：

```typescript
/**
 * 创建 LLM 连接器
 * @param provider - 提供商名称 ('anthropic' | 'bedrock' | 'vertex' | 'foundry')
 * @returns LLMConnector 实例
 * @public
 */
export function createLLMConnector(provider: string): LLMConnector
```

```typescript
/**
 * 内部重试逻辑 — 不对外暴露
 * @internal
 */
export function calculateRetryDelay(attempt: number): number
```

### 4.3 各模块标注计划

| 模块 | @public 导出 | @internal 导出 |
|------|-------------|----------------|
| **src/index.ts** (顶层) | `VERSION`、`ClaudeCodeSDK`、所有功能类 | — |
| **Session** | `ClaudeCodeSDK`、`AttributionManager`、`SessionPersistence`、所有类型 | `engine.ts` 内辅助函数 |
| **Tool System** | `BaseTool`、`createTool`、`ToolRegistry`、`Tool`、`ToolResult` 等 | 工具内部状态类 |
| **LLM Layer** | `createLLMConnector`、`AnthropicConnector` 等、所有配置类型 | `retry.ts`、`preconnect.ts`（内部重试逻辑） |
| **Conversation** | `ConversationManager`、`conversationLoop`、`CircularBuffer`、`TokenTracker` 等 | `MicroCompactor`、`AutoCompactor`（可降级为内部，或用 `@beta`） |
| **Context** | `ContextBuilder`、`findGitRoot`、`getGitState` 等 | 辅助类型、`MemoryFileLoader` 细节 |
| **Permission** | `PermissionManager` | `YOLOClassifier`、`pathValidation` 等内部分类器 |
| **Config** | `ConfigManager` | `JSONConfigSource`、`EnvConfigSource` 等 |
| **MCP** | `MCPServerManager` | `ToolAdapter` 等适配器类 |
| **Core Types** | `Message`、`SDKConfig`、`PermissionMode` 等 | 无 — 全部为公开类型 |

### 4.4 现有代码批量标注策略

分为 3 批完成（不阻塞主线）：

1. **Batch 1**: `src/index.ts` + 各模块 `index.ts` — 顶层导出全部加 `@public`
2. **Batch 2**: 各模块源文件 — 功能类加 `@public`，辅助函数/内部类加 `@internal`
3. **Batch 3**: 验证 — `npm run docs` 确认只有预期的 `@public` API 出现

### 4.5 注释风格约定

- 所有 `@public` 导出必须写描述性 JSDoc（至少一句话 + 参数说明）
- `@internal` 可以简写或省略描述
- 类型定义（type/interface）如果被 `@public` 函数引用，自动继承可见性
- 使用 `@deprecated` 标记废弃 API，并说明替代方案

---

## 5. 与 CI 集成方案

### 5.1 CI 步骤

在 CI 配置（如 GitHub Actions `.github/workflows/ci.yml`）中增加文档步骤：

```yaml
- name: Generate API docs
  run: npm run docs
- name: Check docs diff
  run: |
    if ! git diff --stat --exit-code docs/; then
      echo "❌ API docs out of date. Run 'npm run docs' and commit the changes."
      exit 1
    fi
```

**设计思路**: docs diff 检查作为 CI 的一步，确保每次 PR 提交都同步更新文档。如果文档与代码不一致，CI 失败。

### 5.2 自动部署到 GitHub Pages

可选步骤（在 main 分支合并后触发）：

```yaml
- name: Deploy to GitHub Pages
  if: github.ref == 'refs/heads/main'
  uses: peaceiris/actions-gh-pages@v4
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    publish_dir: ./docs/html
```

如果需要：

1. 先执行 `npm run docs:html` 生成 HTML
2. 再用 `actions-gh-pages` 发布到 `gh-pages` 分支

### 5.3 推荐 CI 策略

| 事件 | 操作 |
|------|------|
| PR (任何分支) | `npm run docs` → diff check → 要求提交者更新文档 |
| main 合并 | 同上，diff 通过后合并 |
| 发布 tag (v*) | `npm run docs:html` → 部署 GitHub Pages |
| 日常开发 | 本地 `npm run docs` 预览 |

### 5.4 package.json 最终 scripts

```json
{
  "scripts": {
    "build": "tsc",
    "docs": "typedoc",
    "docs:html": "typedoc --plugin none --out docs/html",
    "docs:serve": "typedoc --watch",
    "docs:check": "npm run docs && git diff --stat --exit-code docs/",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

---

## 6. 实施步骤 (Roadmap)

### Step 1: 安装依赖 & 配置文件
- `npm install --save-dev typedoc typedoc-plugin-markdown`
- 创建 `typedoc.json`
- 更新 `package.json` 的 `scripts`

### Step 2: 首次生成 & 验证
- `npm run docs` — 成功生成 docs/
- 检查输出的 API 页面是否涵盖所有模块
- 调整配置（分组、排序、visibilityFilters）

### Step 3: 批量标注 @public/@internal
- 按 4.4 的 Batch 1→2→3 顺序标注
- 每次 Batch 后重新生成验证

### Step 4: CI 集成
- 更新 GitHub Actions workflow
- 添加 `npm run docs:check` 步骤
- 可选：配置 GitHub Pages 部署

### Step 5: 文档审查
- 检查是否有遗漏的 @public 导出
- 确认 @internal 导出在文档中不可见
- 合并到主分支

---

## 7. 风险与缓解

| 风险 | 缓解 |
|------|------|
| TypeDoc 版本更新导致配置 Change | 锁定 typedoc 版本，定期更新 |
| 标注工作量较大（105 文件） | 分 3 批执行，每批约 35 文件 |
| 文档 diff 在 CI 中过于严格 | 初始阶段设 warning，稳定后转 error |
| 部分内部类型被意外暴露 | 使用 `@internal` + TypeDoc `visibilityFilters` 双重保护 |

---

## 附录 A: 参考链接

- [TypeDoc 官方文档](https://typedoc.org/)
- [typedoc-plugin-markdown](https://www.npmjs.com/package/typedoc-plugin-markdown)
- [TSDoc 标签规范](https://tsdoc.org/)
- [API Extractor](https://api-extractor.com/) (方案 B 参考)
