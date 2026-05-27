/**
 * Integration Tests — ToolRegistry + Permission System
 *
 * Tests the integration between tool registration, execution,
 * and permission checking.
 * Covers: register/unregister workflows, permission modes
 * with tool execution, rule-based decisions.
 */
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { PermissionManager } from '../permission/manager.js'
import { createTool } from '../tools/base.js'
import { ToolRegistry } from '../tools/registry.js'

// ─── Test Tools ──────────────────────────────────────────

const readFileTool = createTool({
  name: 'read_file',
  description: 'Reads a file',
  inputSchema: z.object({
    path: z.string(),
    offset: z.number().optional(),
    limit: z.number().optional(),
  }),
  isReadOnly: () => true,
  async execute(input) {
    return { data: null, content: `Reading: ${input.path}` }
  },
})

const writeFileTool = createTool({
  name: 'write_file',
  description: 'Writes to a file',
  inputSchema: z.object({
    path: z.string(),
    content: z.string(),
  }),
  async execute(input) {
    return { data: null, content: `Wrote: ${input.path}` }
  },
})

const bashTool = createTool({
  name: 'bash',
  description: 'Executes a command',
  inputSchema: z.object({
    command: z.string(),
    timeout: z.number().optional(),
  }),
  isReadOnly: (input) => (input.command ?? '').startsWith('echo'),
  async execute(input) {
    return { data: null, content: `Exec: ${input.command}` }
  },
})

// ─── Tests ───────────────────────────────────────────────

describe('ToolRegistry + Permission Integration', () => {
  describe('tool registration and execution with permissions', () => {
    it('should register tools and execute with auto mode', async () => {
      const registry = new ToolRegistry()
      const permissions = new PermissionManager('auto')

      registry.register(readFileTool, writeFileTool)
      expect(registry.size).toBe(2)

      // Execute read_file — auto mode allows
      const readResult = await registry.execute(
        'read_file',
        { path: '/test/file.txt' },
        { signal: new AbortController().signal },
      )
      expect(readResult.isError).toBeFalsy()
      expect(readResult.content).toContain('Reading:')
    })

    it('should deny execution with plan mode', async () => {
      const registry = new ToolRegistry()
      const permissions = new PermissionManager('plan')

      registry.register(writeFileTool)
      expect(registry.size).toBe(1)

      // Permission check should deny
      const decision = await permissions.check({
        toolName: 'write_file',
        input: { path: '/test/file.txt', content: 'data' },
        mode: 'plan',
      })
      expect(decision.type).toBe('deny')
    })

    it('should ask in manual mode', async () => {
      const permissions = new PermissionManager('manual')

      const decision = await permissions.check({
        toolName: 'bash',
        input: { command: 'rm -rf /' },
        mode: 'manual',
      })
      expect(decision.type).toBe('ask')
    })

    it('should allow read-only tools in plan mode', async () => {
      const registry = new ToolRegistry()
      const permissions = new PermissionManager('plan')

      registry.register(readFileTool, writeFileTool)

      // read_file should be read-only
      expect(permissions.isToolReadOnly(readFileTool, { path: '/test/file.txt' })).toBe(true)
      // write_file should NOT be read-only
      expect(
        permissions.isToolReadOnly(writeFileTool, {
          path: '/test/file.txt',
          content: 'data',
        }),
      ).toBe(false)
    })
  })

  describe('dynamic registration and permission updates', () => {
    it('should allow adding tools after permission config', () => {
      const registry = new ToolRegistry()
      const permissions = new PermissionManager('auto', [{ pattern: 'bash', behavior: 'ask', source: 'user' }])

      registry.register(readFileTool)

      // Later add more tools
      registry.register(bashTool)
      expect(registry.size).toBe(2)
    })

    it('should unregister and re-register tools', () => {
      const registry = new ToolRegistry()
      registry.register(readFileTool)
      expect(registry.has('read_file')).toBe(true)

      registry.unregister('read_file')
      expect(registry.has('read_file')).toBe(false)

      // Re-register with updated version
      const updatedTool = createTool({
        name: 'read_file',
        description: 'Updated read file',
        inputSchema: z.object({ path: z.string() }),
        async execute(input) {
          return { data: null, content: `Updated read: ${input.path}` }
        },
      })
      registry.register(updatedTool)
      expect(registry.has('read_file')).toBe(true)
      expect(registry.get('read_file')?.description).toBe('Updated read file')
    })

    it('should deny with specific rule pattern', async () => {
      const permissions = new PermissionManager('auto', [{ pattern: 'bash(rm *)', behavior: 'deny', source: 'user' }])

      // Matching pattern — deny
      const rmDecision = await permissions.check({
        toolName: 'bash',
        input: { command: 'rm -rf /' },
        mode: 'auto',
      })
      expect(rmDecision.type).toBe('deny')

      // Non-matching pattern — allow
      const lsDecision = await permissions.check({
        toolName: 'bash',
        input: { command: 'ls -la' },
        mode: 'auto',
      })
      expect(lsDecision.type).toBe('allow')
    })
  })

  describe('tool schema validation with permissions', () => {
    it('should return error for invalid tool input', async () => {
      const registry = new ToolRegistry()
      registry.register(readFileTool)

      const result = await registry.execute(
        'read_file',
        { wrong_field: 'test' },
        { signal: new AbortController().signal },
      )
      expect(result.isError).toBe(true)
      expect(result.content).toContain('Invalid input')
    })

    it('should return error for unknown tool', async () => {
      const registry = new ToolRegistry()
      registry.register(readFileTool)

      const result = await registry.execute('nonexistent', {}, { signal: new AbortController().signal })
      expect(result.isError).toBe(true)
      expect(result.content).toContain('Unknown tool')
    })
  })

  describe('permission rule patterns', () => {
    it('should match wildcard patterns', async () => {
      const permissions = new PermissionManager('auto', [{ pattern: '*', behavior: 'deny', source: 'project' }])

      const decision = await permissions.check({
        toolName: 'any_tool',
        input: {},
        mode: 'auto',
      })
      expect(decision.type).toBe('deny')
    })

    it('should use the first matching rule', async () => {
      const permissions = new PermissionManager('auto', [
        { pattern: 'bash', behavior: 'deny', source: 'user' },
        { pattern: '*', behavior: 'allow', source: 'user' },
      ])

      // First rule matches bash — deny
      const bashDecision = await permissions.check({
        toolName: 'bash',
        input: {},
        mode: 'auto',
      })
      expect(bashDecision.type).toBe('deny')

      // Second rule matches everything else — allow
      const readDecision = await permissions.check({
        toolName: 'read_file',
        input: {},
        mode: 'auto',
      })
      expect(readDecision.type).toBe('allow')
    })

    it('should match rule patterns with argument wildcards', async () => {
      const permissions = new PermissionManager('auto', [{ pattern: 'bash(git *)', behavior: 'allow', source: 'user' }])

      const gitDecision = await permissions.check({
        toolName: 'bash',
        input: { command: 'git commit -m "test"' },
        mode: 'auto',
      })
      expect(gitDecision.type).toBe('allow')

      const rmDecision = await permissions.check({
        toolName: 'bash',
        input: { command: 'rm -rf /' },
        mode: 'auto',
      })
      expect(rmDecision.type).toBe('allow') // falls back to auto mode → allow
    })
  })

  describe('clear and reset flows', () => {
    it('should clear all tools from registry', () => {
      const registry = new ToolRegistry()
      registry.register(readFileTool, writeFileTool, bashTool)
      expect(registry.size).toBe(3)

      registry.clear()
      expect(registry.size).toBe(0)
      expect(registry.get('read_file')).toBeUndefined()
    })

    it('should reset permission manager state', () => {
      const permissions = new PermissionManager('manual', [{ pattern: 'bash', behavior: 'deny', source: 'user' }])
      expect(permissions.getMode()).toBe('manual')
      expect(permissions.getRules()).toHaveLength(1)

      permissions.setMode('auto')
      expect(permissions.getMode()).toBe('auto')
      // Rules persist after mode change
      expect(permissions.getRules()).toHaveLength(1)
    })
  })
})
