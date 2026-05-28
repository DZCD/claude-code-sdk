# TEST-BUGS.md — 测试发现的问题记录

> 记录通过 E2E/集成测试发现的 SDK 缺陷。
> 格式: `[BUG-编号]` — 严重度 — 描述

---

## 当前发现

## [BUG-001] — P2 — MicroCompactor.compactMessage 不支持 content 为 null 的消息
- **发现时间**: 2026-05-28
- **发现测试**: `src/conversation/__tests__/edge-cases.test.ts` — "should handle null/undefined content gracefully"
- **现象**: 当消息的 content 属性为 null 时，compactMessage 方法尝试在 null 上调用 `.map()`，抛出 `TypeError: Cannot read properties of null (reading 'map')`
- **根因推测**: compactMessage 方法先判断 `typeof msg.content === 'string'`，走 else 分支后直接将其断言为 ContentBlock[] 并调用 .map()，未处理 null/undefined 的情况
- **是否已修复**: 否
- **备注**: 边缘情况，SDK 运行时通常不会产生 content 为 null 的消息

---

## 排查记录模板

```
## [BUG-001] — P0 — 标题
- **发现时间**: YYYY-MM-DD
- **发现测试**: `src/__tests__/e2e/<test-file>.test.ts`
- **现象**: 
- **根因推测**: 
- **是否已修复**: 否
- **备注**: 
```

### 严重度定义

| 级别 | 说明 |
|------|------|
| P0 | 阻塞发版 — 核心功能不可用 |
| P1 | 高优先级 — 影响用户体验但可绕过 |
| P2 | 中优先级 — 边缘 case 问题 |
| P3 | 低优先级 — 文档/代码风格问题 |

---

*最近更新: 2026-05-28*
