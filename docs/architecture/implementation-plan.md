# Implementation Plan — ClaudeCode SDK for TypeScript

> Phase 3 of Superpowers Methodology  
> Status: Final  
> Last Updated: 2026-05-26

---

## Overview

SDK v0.1.0 targets **Phase 1A: Foundation**. This includes:
1. Core type definitions
2. Base Tool class + ToolRegistry
3. LLMClient + Anthropic connector
4. Conversation loop with streaming

## Task Dependency Graph

```
types (T1: Core Types)
  ├──> T2: Base Tool + ToolRegistry
  │      └──> T4: Built-in Tools (v0.2.0)
  ├──> T5: LLM Types + Client
  │      └──> T6: Anthropic Connector
  │             └──> T7: Conversation Loop
  │                    └──> T8: Session Engine (v0.3.0)
  └──> T3: Permission Types + Config Types
```

---

## Task Breakdown

### T1: Core Type Definitions
**Files**: `src/types/message.ts`, `src/types/tool.ts`, `src/types/permission.ts`, `src/types/config.ts`, `src/types/index.ts`

**Acceptance Criteria**:
- All message types defined (User, Assistant, ToolResult, System, ContentBlock variants)
- Tool type system defined (Tool interface, ToolResult, ToolExecutionContext)
- Permission types defined (PermissionMode, PermissionRequest, PermissionRule, PermissionDecision)
- Config types defined (SDKConfig, LLMConfig variants)
- All types exported from `src/types/index.ts`
- TypeScript compiles without errors

**Test File**: `src/types/__tests__/types.test.ts`
- Verify type assignments compile correctly
- Test message creation helpers

---

### T2: Base Tool + ToolRegistry
**Files**: `src/tools/base.ts`, `src/tools/registry.ts`, `src/tools/index.ts`

**Acceptance Criteria**:
- `BaseTool` abstract class with execute, description, inputSchema
- `ToolRegistry` with register, get, getAll, execute methods
- Tool input validated against Zod schema before execution
- Registry converts tools to API schema format (ToolDefinition)
- TypeScript compiles without errors

**Test File**: `src/tools/__tests__/registry.test.ts`
- Register and retrieve tools
- Execute tool by name
- Tool not found error
- Input validation rejects invalid input

---

### T3: Permission + Config Types (bundled with T1 for v0.1.0)
**Files**: Defined in T1 type files, implementation stubs

**Acceptance Criteria**:
- PermissionManager class with check(), setMode()
- ConfigManager class with loadFromEnv(), merge()
- Basic path validation

---

### T5: LLM Client (Types + Interface)
**Files**: `src/llm/types.ts`, `src/llm/client.ts`, `src/llm/index.ts`

**Acceptance Criteria**:
- `LLMConnector` interface defined
- `LLMClient` facade implementing stream() and countTokens()
- `StreamEvent` types correctly defined
- Factory function `createLLMClient(config)` returns appropriate connector
- TypeScript compiles without errors

**Test File**: `src/llm/__tests__/client.test.ts`
- Factory returns correct connector type
- Error on unsupported provider

---

### T6: Anthropic Connector
**Files**: `src/llm/anthropic.ts`

**Dependencies**: `@anthropic-ai/sdk`

**Acceptance Criteria**:
- Implements `LLMConnector` interface
- `send()` method streams events correctly (text, tool_use_start/end, done)
- Tool definitions converted to API format
- Message format converted to Anthropic API format
- Error handling for API errors, auth errors, rate limits
- Token counting via `client.countTokens()` (beta endpoint)

**Tests**: `src/llm/__tests__/anthropic.test.ts`
- Mock API responses for streaming
- Error handling tests
- Message format conversion tests

---

### T7: Conversation Loop
**Files**: `src/conversation/manager.ts`, `src/conversation/loop.ts`, `src/conversation/stream.ts`, `src/conversation/index.ts`

**Dependencies**: T2, T5, T6

**Acceptance Criteria**:
- `ConversationManager.send()` streams StreamEvent
- Multi-turn tool call loop (LLM → tool → LLM → tool → ...)
- Max tool call depth (default 50, configurable)
- Auto-compact detection (placeholder for v0.1.0)
- Token usage tracking
- History management (getHistory, reset)
- Error handling for tool execution failures

**Tests**: `src/conversation/__tests__/`
- Single-turn text response
- Multi-turn tool calling
- Tool execution error recovery
- Max depth exceeded
- Token counting

---

## Implementation Order

For v0.1.0, implement in this order:

```
Week 1: T1 (Types) → T2 (Tools) → T3 (Permission stubs)
Week 2: T5 (LLM Client) → T6 (Anthropic Connector) 
Week 3: T7 (Conversation Loop) → Integration tests
```

## Sub-Agent Assignments

| Sub-Agent | Tasks | Description |
|-----------|-------|-------------|
| Executor 1 | T1 | Core type definitions with tests |
| Executor 2 | T2 + T5 | Tool system + LLM client with tests |
| Executor 3 | T6 + T7 | Anthropic connector + conversation loop with tests |

## Definition of Done

- All TypeScript compiles with `--noEmit`
- All tests pass (`vitest run`)
- Test coverage > 80% for implemented modules
- Public API exported from `src/index.ts`
- Integration test demonstrates end-to-end flow
