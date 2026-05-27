import { describe, it, expect } from 'vitest'
import {
  generateId,
  createUserMessage,
  createAssistantMessage,
  createToolResultMessage,
  createSystemMessage,
  toContentBlocks,
} from '../types/message.js'
import type { Tool, ToolContext, ToolResult } from '../types/tool.js'
import type { PermissionMode } from '../types/permission.js'
import type { LLMConfig, SDKConfig } from '../types/config.js'

// ─── Message Tests ───────────────────────────────────────

describe('Message types', () => {
  it('should generate unique IDs', () => {
    const id1 = generateId()
    const id2 = generateId()
    expect(id1).not.toBe(id2)
  })

  it('should create a user message from text', () => {
    const msg = createUserMessage('Hello')
    expect(msg.role).toBe('user')
    expect(msg.content).toBe('Hello')
    expect(msg.id).toBeTruthy()
    expect(msg.createdAt).toBeTruthy()
  })

  it('should create an assistant message', () => {
    const msg = createAssistantMessage('Hi')
    expect(msg.role).toBe('assistant')
    expect(msg.content).toBe('Hi')
  })

  it('should create an assistant message with content blocks', () => {
    const blocks = [{ type: 'text' as const, text: 'Hello' }]
    const msg = createAssistantMessage(blocks)
    expect(msg.role).toBe('assistant')
    expect(Array.isArray(msg.content)).toBe(true)
  })

  it('should create a tool result message', () => {
    const results = [
      {
        type: 'tool_result' as const,
        toolUseId: '123',
        content: 'result',
      },
    ]
    const msg = createToolResultMessage(results)
    expect(msg.role).toBe('user')
    expect(msg.content).toHaveLength(1)
    expect(msg.content[0]?.type).toBe('tool_result')
  })

  it('should create a system message', () => {
    const msg = createSystemMessage('You are helpful.')
    expect(msg.role).toBe('system')
    expect(msg.content).toBe('You are helpful.')
  })

  it('should convert text to content blocks', () => {
    const blocks = toContentBlocks('Hello')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toEqual({ type: 'text', text: 'Hello' })
  })
})

// ─── TypeScript Compile Checks ───────────────────────────

describe('TypeScript type checks', () => {
  it('should allow Tool type to be defined', () => {
    const tool: Tool = {
      name: 'test_tool',
      description: 'A test tool',
      inputSchema: undefined as unknown as Tool['inputSchema'],
      async execute(_input, _context) {
        return { data: 'ok', content: 'Done' }
      },
    }
    expect(tool.name).toBe('test_tool')
  })

  it('should allow ToolContext with AbortSignal', () => {
    const controller = new AbortController()
    const context: ToolContext = {
      signal: controller.signal,
    }
    expect(context.signal).toBe(controller.signal)
  })

  it('should allow PermissionMode values', () => {
    const modes: PermissionMode[] = ['auto', 'manual', 'plan', 'bypass']
    expect(modes).toHaveLength(4)
  })

  it('should allow LLMConfig discrimination', () => {
    const config: LLMConfig = {
      provider: 'anthropic',
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-20250514',
    }
    if (config.provider === 'anthropic') {
      expect(config.apiKey).toBe('sk-test')
    }
  })

  it('should allow SDKConfig', () => {
    const config: SDKConfig = {
      llm: {
        provider: 'anthropic',
        apiKey: 'sk-test',
        model: 'claude-sonnet-4-20250514',
      },
      permissionMode: 'auto',
    }
    expect(config.llm.provider).toBe('anthropic')
    expect(config.permissionMode).toBe('auto')
  })
})
