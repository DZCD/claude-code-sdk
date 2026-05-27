# Phase 3A — CI 流水线设计

> 作者：SDK-配置开发
> 日期：2026-05-27
> 状态：草案

---

## 1. 概述

为 claude-code-sdk 项目建立 GitHub Actions CI 流水线，实现自动测试、类型检查、代码规范检查与构建验证，为后续 API 稳定性保障和发布自动化奠定基础。

**项目概况：**
- 183 个测试文件，约 12K 行 TypeScript 源码
- 当前 Node.js 运行时 v22.22.2，目标编译 `ES2022`
- 工具栈：Vitest 3.2.4 / Biome 1.9.4 / TypeScript 5.5.4
- GitHub 远程仓库已配置（`github.com/DZCD/claude-code-sdk`）

---

## 2. GitHub Actions 工作流方案

### 2.1 触发器设计

```yaml
on:
  push:
    branches: [main]
    paths-ignore:
      - '*.md'
      - 'docs/**'
  pull_request:
    branches: [main]
    paths-ignore:
      - '*.md'
      - 'docs/**'
  # 手动触发（方便调试）
  workflow_dispatch:
```

| 触发器 | 说明 |
|--------|------|
| `push main` | 主线合并后全量验证 |
| `pull_request` | PR 预检，拦截问题提前 |
| `paths-ignore` | 纯文档变更跳过 CI |

**Tag 触发**在 Release 小节单独定义。

### 2.2 Node.js 版本矩阵

建议最低支持 **Node 18.x**（ES2022 所需最低版本），矩阵策略：

```yaml
strategy:
  matrix:
    node-version: [18.x, 20.x, 22.x]
```

理由：
- **18.x**：ES2022 完整支持，是最低兼容保障
- **20.x**：当前 LTS，主要运行时
- **22.x**：运行时当前版本，前瞻验证

如果考虑到 CI 成本，可精简为最低 18.x + 当前 22.x 两个版本，PR 阶段只跑最快版本。

### 2.3 步骤编排

```
install → lint → type-check → test → build
```

每步说明：

| 步骤 | 命令 | 目的 |
|------|------|------|
| `install` | `npm ci` | 锁定依赖，确保可复现 |
| `lint` | `npm run lint` | Biome 静态检查，提前拦截代码风格问题 |
| `type-check` | `npm run type-check` | tsc `--noEmit` 类型检查 |
| `test` | `npm test` | Vitest 运行全部单元测试 |
| `build` | `npm run build` | tsc 编译为 dist，验证产物可构建 |

---

## 3. 工具链配置

### 3.1 Biome (lint)

当前配置验证：
```bash
npm run lint   # biome check src/
npm run lint:fix  # biome check --apply src/
```

CI 中建议使用 `npm run lint`，若 lint 失败则标记为 ❌。

> 注：目前项目中无 `biome.json` 配置文件，Biome 使用默认规则运行。建议在 Phase 3A 后续迭代中落地 `biome.json` 显式配置。

### 3.2 Vitest (test)

当前配置（`vitest.config.ts`）已启用 v8 coverage，CI 中增加：

- Coverage 门槛建议：`branches: 70%`，`functions: 75%`，`lines: 75%`，`statements: 75%`
- 当前实测覆盖率 ~80%+（参照 Phase 2 完成报告），门槛可设定为**不低于当前值 5% 以内**

```ts
// vitest.config.ts 中补充
coverage: {
  thresholds: {
    branches: 70,
    functions: 75,
    lines: 75,
    statements: 75,
  },
}
```

### 3.3 TypeScript (type-check)

```bash
npm run type-check   # tsc --noEmit
```

无特殊配置，`tsconfig.json` 中 `strict: true` 已确保类型安全。

---

## 4. 缓存策略

### 4.1 node_modules 缓存

使用 `actions/cache` 缓存 `node_modules` 减少安装时间：

```yaml
- uses: actions/cache@v4
  with:
    path: node_modules
    key: ${{ runner.os }}-node-${{ matrix.node-version }}-modules-${{ hashFiles('package-lock.json') }}
```

- 缓存 key 包含 OS + Node 版本 + lock 文件哈希
- 命中率约 90%+（package-lock.json 变更不频繁）

### 4.2 npm cache 增强（可选）

```yaml
- name: Cache npm
  uses: actions/cache@v4
  with:
    path: ~/.npm
    key: ${{ runner.os }}-npm-${{ hashFiles('package-lock.json') }}
```

### 4.3 安装优化

使用 `npm ci` 而非 `npm install`，因为：
- 严格按 `package-lock.json` 安装，保证可复现
- 速度比 `npm install` 快（跳过解析版本范围）
- CI/CD 环境的标准最佳实践

---

## 5. 完整工作流 YAML

### 文件位置

`.github/workflows/ci.yml`

### YAML 草案

```yaml
name: CI

on:
  push:
    branches: [main]
    paths-ignore:
      - '*.md'
      - 'docs/**'
  pull_request:
    branches: [main]
    paths-ignore:
      - '*.md'
      - 'docs/**'
  workflow_dispatch:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  ci:
    name: CI (${{ matrix.node-version }})
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18.x, 20.x, 22.x]
      fail-fast: false

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'

      - name: Cache node_modules
        uses: actions/cache@v4
        with:
          path: node_modules
          key: ${{ runner.os }}-node-${{ matrix.node-version }}-modules-${{ hashFiles('package-lock.json') }}

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Type check
        run: npm run type-check

      - name: Test with coverage
        run: npm test
        env:
          CI: true

      - name: Build
        run: npm run build

      - name: Upload coverage report
        if: ${{ matrix.node-version == '22.x' }}
        uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: coverage/
          retention-days: 7
```

---

## 6. 可选增强

### 6.1 Release 自动发布

建议独立文件 `.github/workflows/release.yml`：

```yaml
name: Release

on:
  push:
    tags:
      - 'v*.*.*'

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      id-token: write

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 22.x
          registry-url: 'https://registry.npmjs.org'

      - run: npm ci
      - run: npm run build

      - name: Verify version
        run: |
          TAG_VERSION=${GITHUB_REF_NAME#v}
          PKG_VERSION=$(node -p "require('./package.json').version")
          if [ "$TAG_VERSION" != "$PKG_VERSION" ]; then
            echo "Tag ($TAG_VERSION) does not match package.json ($PKG_VERSION)"
            exit 1
          fi

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
          body_path: CHANGELOG.md

      - name: Publish to npm
        run: npm publish --provenance
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

关键设计：
- **版本一致性检查**：git tag vs package.json version 必须一致
- **provenance**：npm `--provenance` 确保发布可追溯
- **独立的发布工作流**：与 CI 分离，降低误触发风险

### 6.2 自动 CHANGELOG 生成

推荐使用 `conventional-changelog` 方案：

```bash
npm install -D conventional-changelog-cli conventional-changelog-conventionalcommits
```

在 `package.json` 中添加：
```json
{
  "scripts": {
    "changelog": "conventional-changelog -p conventionalcommits -i CHANGELOG.md -s"
  }
}
```

然后在 release 工作流中发布前执行 `npm run changelog`。

### 6.3 自动化版本 bump 检查

在 PR 中验证 `package.json` version 是否已更新：

```yaml
- name: Check version bump
  run: |
    git fetch origin main --depth=50
    MAIN_VERSION=$(git show origin/main:package.json | node -p "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).version")
    PR_VERSION=$(node -p "require('./package.json').version")
    if [ "$MAIN_VERSION" == "$PR_VERSION" ]; then
      echo "⚠️ Package version unchanged ($MAIN_VERSION). Bump before merging."
      exit 1
    fi
    echo "✅ Version bumped: $MAIN_VERSION → $PR_VERSION"
```

---

## 7. 实施路线图

| 波次 | 内容 | 预计工时 |
|------|------|----------|
| **Wave 1** | 基础 CI 工作流（ci.yml） | 1 人天 |
| **Wave 2** | coverage 门槛 + CI 试运行调优 | 0.5 人天 |
| **Wave 3** | Release 工作流 + CHANGELOG | 0.5 人天 |

---

## 8. 风险与注意事项

1. **Biome 配置缺失**：当前无 `biome.json`，lint 使用默认规则。建议 Phase 3A 中同时补充 `biome.json`。
2. **CI 执行时间**：183 个测试文件 + 3 版本矩阵，完整流水线约 3-5 分钟。如果 PR 阶段觉得慢，可只在 PR 跑 22.x 单版本，merge 后跑全矩阵。
3. **GitHub Token**：当前 remote URL 包含 PAT token（`ghp_...`），建议轮换为 GitHub Actions 内置的 `GITHUB_TOKEN`。
4. **npm publish**：需要配置 `NPM_TOKEN` 到 GitHub Secrets 中。
