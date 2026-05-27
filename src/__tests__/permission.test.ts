import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { PermissionManager } from '../permission/manager.js'
import type { PermissionMode, PermissionRule } from '../types/permission.js'
import type { Tool } from '../types/tool.js'

// ─── PermissionManager Tests ────────────────────────────

describe('PermissionManager', () => {
  it('should start with default auto mode', () => {
    const pm = new PermissionManager()
    expect(pm.getMode()).toBe('auto')
  })

  it('should set and get permission mode', () => {
    const pm = new PermissionManager()
    pm.setMode('manual')
    expect(pm.getMode()).toBe('manual')
    pm.setMode('plan')
    expect(pm.getMode()).toBe('plan')
    pm.setMode('bypass')
    expect(pm.getMode()).toBe('bypass')
  })

  it('should allow in auto mode', async () => {
    const pm = new PermissionManager('auto')
    const decision = await pm.check({
      toolName: 'bash',
      input: {},
      mode: 'auto',
    })
    expect(decision.type).toBe('allow')
  })

  it('should deny in plan mode', async () => {
    const pm = new PermissionManager('plan')
    const decision = await pm.check({
      toolName: 'bash',
      input: {},
      mode: 'plan',
    })
    expect(decision.type).toBe('deny')
  })

  it('should ask in manual mode', async () => {
    const pm = new PermissionManager('manual')
    const decision = await pm.check({
      toolName: 'bash',
      input: {},
      mode: 'manual',
    })
    expect(decision.type).toBe('ask')
  })

  it('should allow in bypass mode', async () => {
    const pm = new PermissionManager('bypass')
    const decision = await pm.check({
      toolName: 'bash',
      input: {},
      mode: 'bypass',
    })
    expect(decision.type).toBe('allow')
  })

  it('should respect allow rules', async () => {
    const pm = new PermissionManager('manual', [{ pattern: 'bash', behavior: 'allow', source: 'user' }])
    const decision = await pm.check({
      toolName: 'bash',
      input: {},
      mode: 'manual',
    })
    expect(decision.type).toBe('allow')
  })

  it('should respect deny rules', async () => {
    const pm = new PermissionManager('auto', [{ pattern: 'dangerous_tool', behavior: 'deny', source: 'user' }])
    const decision = await pm.check({
      toolName: 'dangerous_tool',
      input: {},
      mode: 'auto',
    })
    expect(decision.type).toBe('deny')
    expect(decision.reason).toContain('dangerous_tool')
  })

  it('should respect ask rules', async () => {
    const pm = new PermissionManager('auto', [{ pattern: 'sensitive_tool', behavior: 'ask', source: 'user' }])
    const decision = await pm.check({
      toolName: 'sensitive_tool',
      input: {},
      mode: 'auto',
    })
    expect(decision.type).toBe('ask')
  })

  it('should add rules dynamically', () => {
    const pm = new PermissionManager()
    pm.addRule({ pattern: 'test', behavior: 'deny', source: 'user' })
    pm.addRules([{ pattern: 'test2', behavior: 'allow', source: 'user' }])
    expect(pm.getRules()).toHaveLength(2)
  })

  it('should validate paths', () => {
    const pm = new PermissionManager()
    expect(pm.validatePath('/home/user/project/file.ts', ['/home/user/project']).valid).toBe(true)
    expect(pm.validatePath('/tmp/evil', ['/home/user/project']).valid).toBe(false)
  })

  it('should check if a tool is read-only', () => {
    const pm = new PermissionManager()
    const readOnlyTool: Tool = {
      name: 'read_tool',
      description: 'Reads files',
      inputSchema: z.object({}),
      isReadOnly: () => true,
      async execute() {
        return { data: null, content: 'read' }
      },
    }
    const writeTool: Tool = {
      name: 'write_tool',
      description: 'Writes files',
      inputSchema: z.object({}),
      async execute() {
        return { data: null, content: 'write' }
      },
    }
    expect(pm.isToolReadOnly(readOnlyTool, {})).toBe(true)
    expect(pm.isToolReadOnly(writeTool, {})).toBe(false)
  })

  it('should match rule patterns with arguments', async () => {
    const pm = new PermissionManager('manual', [{ pattern: 'Bash(git *)', behavior: 'allow', source: 'user' }])
    const gitDecision = await pm.check({
      toolName: 'Bash',
      input: { command: 'git status' },
      mode: 'manual',
    })
    expect(gitDecision.type).toBe('allow')

    const rmDecision = await pm.check({
      toolName: 'Bash',
      input: { command: 'rm -rf /' },
      mode: 'manual',
    })
    expect(rmDecision.type).toBe('ask')
  })
})
