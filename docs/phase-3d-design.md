# Phase 3D Design Document (Revised)

> Based on CEO review — follow Claude Code reference source, no over-engineering
> Date: 2026-05-28

---

## E2: Logging — `logForDebugging()` + `debugFilter.ts`

### Source Reference
`/home/user/.duclaw/workspace/claude-code-source-code/src/utils/debug.ts`
`/home/user/.duclaw/workspace/claude-code-source-code/src/utils/debugFilter.ts`

### Approach
Single function `logForDebugging(message, { level })` — **no Logger interface, no DI, no OpenTelemetry**.

### Scope

| File | Content |
|------|---------|
| `src/logging/index.ts` | Export `logForDebugging()` + `DebugLogLevel` |
| `src/logging/debugFilter.ts` | Port from reference: `parseDebugFilter`, `extractDebugCategories`, `shouldShowDebugMessage` |

### API

```typescript
// No import prefix needed — just import { logForDebugging }

export type DebugLogLevel = 'verbose' | 'debug' | 'info' | 'warn' | 'error'

export function logForDebugging(
  message: string,
  options?: { level?: DebugLogLevel }
): void

export function getMinDebugLogLevel(): DebugLogLevel
export function isDebugMode(): boolean
export function enableDebugLogging(): boolean
```

### Activation
- Environment variable `DEBUG_SDK=true` or `--debug` flag
- `CLAUDE_CODE_DEBUG_LOG_LEVEL` controls minimum level (default: `debug`, filters out `verbose`)
- Output: `debug/<sessionId>.txt` (using SDK config dir) or `--debug-to-stderr`
- `--debug=api,hooks` category filtering via debugFilter

### Testing
- Port relevant tests from reference source
- 15-20 unit tests covering: level filtering, debug mode detection, filter parsing, category extraction

---

## E3: Rate Limiting — Header parsing + cooldown (minimal)

### Source Reference
`/home/user/.duclaw/workspace/claude-code-source-code/src/utils/fastMode.ts` (cooldown pattern)

### Approach
No client-side token bucket. Parse `anthropic-ratelimit-*` headers from API responses and trigger cooldown.

### Scope

| File | Content |
|------|---------|
| `src/rate-limit/types.ts` | RateLimitState, CooldownReason |
| `src/rate-limit/cooldown.ts` | Cooldown state manager (reference fastMode.ts) |

### API

```typescript
export type CooldownReason = 'rate_limit' | 'overloaded'

export interface RateLimitState {
  isCooldown: boolean
  resetAt: number | null
  reason: CooldownReason | null
}

export function parseRateLimitHeaders(headers: Record<string, string>): {
  requestsRemaining: number | null
  requestsReset: number | null
  tokensRemaining: number | null
  tokensReset: number | null
}

export function isInCooldown(): boolean
export function triggerCooldown(resetAt: number, reason: CooldownReason): void
export function getRateLimitState(): RateLimitState
```

### Integration
- LLM Client's `withRetry` checks cooldown state before sending
- On 429 response → `triggerCooldown(resetTimestamp, 'rate_limit')`
- Cooldown auto-expires when `Date.now() >= resetAt`

### Testing
- 15-20 tests: header parsing, cooldown state machine, auto-expiry

---

## E4: Config Validation — Zod `.safeParse()` in ConfigManager

### Source Reference
Zod (already `zod@3.25.0` in package.json)

### Approach
No JSON Schema, no validator module. Use Zod `.safeParse()` directly in `ConfigManager.validate()`.

### Scope

| File | Content |
|------|---------|
| `src/config/config-schema.ts` | Zod schema for SDKConfig (new file) |
| `src/config/manager.ts` | Enhanced `validate()` method (existing, updated) |

### API (already exists, enhanced)

```typescript
// ConfigManager.validate() returns structured errors:
interface ValidationError {
  path: string
  message: string
  expected: string
  actual: unknown
}

interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
}
```

### Integration
- `ConfigManager.validate()` uses Zod `.safeParse()` internally
- Called on `update()` and `loadFromFile()` to provide early warnings
- Error format: field path + expected type + actual value

### Testing
- 15-20 tests: valid config, invalid provider, missing apiKey, wrong types

---

## Directory Structure (Final)

```
src/
  logging/
    ├── index.ts        # logForDebugging + level control + mode detection
    └── debugFilter.ts  # Category filter (port from reference)
  rate-limit/
    ├── types.ts        # Types
    └── cooldown.ts     # Cooldown state machine
  config/
    ├── config-schema.ts  # NEW: Zod schema for SDKConfig
    ├── manager.ts        # ENHANCED: validate() → Zod safeParse
    └── ... (existing)
```

## Wave Plan

### Wave 1 — 3 parallel executors
| Executor | Module | Files | Target Tests |
|----------|--------|-------|-------------|
| SDK-Logging开发 (new) | E2 Logging | `src/logging/*.ts` (2 files) | 15-20 |
| SDK-RateLimit开发 (new) | E3 Rate Limit | `src/rate-limit/*.ts` (2 files) | 15-20 |
| SDK-配置开发 (existing) | E4 Validation | `src/config/*.ts` (1 new + 1 updated) | 15-20 |

### Wave 2 — Integration + regression
- Update `src/index.ts` exports
- Run full test suite (verify 880 existing tests still pass)
- TypeScript compilation check
- Biome lint check
