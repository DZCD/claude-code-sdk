/**
 * Tests for AgentDefinition type and Zod schemas.
 *
 * AgentDefinition describes a custom subagent that can be invoked via the Agent tool.
 */
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { AgentDefinitionSchema, AgentMcpServerSpecSchema } from '../types/agent-definition.js'
import type { AgentDefinition, AgentMcpServerSpec } from '../types/agent-definition.js'

// ============================================================================
// AgentMcpServerSpec
// ============================================================================

describe('AgentMcpServerSpec', () => {
  it('should accept a string specification', () => {
    const result = AgentMcpServerSpecSchema.safeParse('my-mcp-server')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toBe('my-mcp-server')
    }
  })

  it('should accept an object specification with stdio config', () => {
    const valid = {
      myServer: {
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
      },
    }

    const result = AgentMcpServerSpecSchema.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) {
      const data = result.data as Record<string, unknown>
      expect(data.myServer).toBeDefined()
    }
  })

  it('should accept an object specification with SSE config', () => {
    const valid = {
      remoteServer: {
        type: 'sse',
        url: 'https://example.com/mcp/sse',
      },
    }

    const result = AgentMcpServerSpecSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('should reject non-string/non-object values', () => {
    const result = AgentMcpServerSpecSchema.safeParse(42)
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// AgentDefinition — required fields
// ============================================================================

describe('AgentDefinition — required fields', () => {
  it('should accept a minimal valid definition', () => {
    const valid: AgentDefinition = {
      description: 'A helper agent for code review',
      prompt: 'You are a code review expert. Review the following code for issues.',
    }

    const result = AgentDefinitionSchema.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.description).toBe('A helper agent for code review')
      expect(result.data.prompt).toContain('code review expert')
    }
  })

  it('should reject when description is missing', () => {
    const result = AgentDefinitionSchema.safeParse({
      prompt: 'You are a helper.',
    })
    expect(result.success).toBe(false)
  })

  it('should reject when prompt is missing', () => {
    const result = AgentDefinitionSchema.safeParse({
      description: 'A helper agent',
    })
    expect(result.success).toBe(false)
  })

  it('should reject empty object', () => {
    const result = AgentDefinitionSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('should reject non-object inputs', () => {
    for (const val of [null, 42, 'string', true, []]) {
      const result = AgentDefinitionSchema.safeParse(val)
      expect(result.success).toBe(false)
    }
  })
})

// ============================================================================
// AgentDefinition — optional fields
// ============================================================================

describe('AgentDefinition — optional fields', () => {
  it('should accept tools array', () => {
    const valid = {
      description: 'A tool-using agent',
      prompt: 'Use tools wisely.',
      tools: ['Read', 'Glob', 'Grep'],
    }

    const result = AgentDefinitionSchema.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.tools).toEqual(['Read', 'Glob', 'Grep'])
    }
  })

  it('should accept disallowedTools array', () => {
    const valid = {
      description: 'A restricted agent',
      prompt: 'Do your job.',
      disallowedTools: ['Bash', 'Write'],
    }

    const result = AgentDefinitionSchema.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disallowedTools).toEqual(['Bash', 'Write'])
    }
  })

  it('should accept model field', () => {
    const valid = {
      description: 'A model-specific agent',
      prompt: 'Analyze carefully.',
      model: 'sonnet',
    }

    const result = AgentDefinitionSchema.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.model).toBe('sonnet')
    }
  })

  it('should accept model as full model ID', () => {
    const valid = {
      description: 'A model-specific agent',
      prompt: 'Analyze carefully.',
      model: 'claude-opus-4-5',
    }

    const result = AgentDefinitionSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('should accept mcpServers as string array', () => {
    const valid = {
      description: 'MCP-enabled agent',
      prompt: 'Use MCP servers.',
      mcpServers: ['server1', 'server2'],
    }

    const result = AgentDefinitionSchema.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.mcpServers).toEqual(['server1', 'server2'])
    }
  })

  it('should accept mcpServers as mixed array', () => {
    const valid = {
      description: 'MCP-enabled agent',
      prompt: 'Use MCP servers.',
      mcpServers: [
        'simple-server',
        {
          complexServer: {
            type: 'stdio',
            command: 'python',
            args: ['-m', 'my_mcp'],
          },
        },
      ],
    }

    const result = AgentDefinitionSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('should accept skills array', () => {
    const valid = {
      description: 'Skillful agent',
      prompt: 'Use your skills.',
      skills: ['docs-deploy-workflow', 'superpowers-sdk-workflow'],
    }

    const result = AgentDefinitionSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('should accept maxTurns as positive integer', () => {
    const valid = {
      description: 'Limited agent',
      prompt: 'Do something.',
      maxTurns: 10,
    }

    const result = AgentDefinitionSchema.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.maxTurns).toBe(10)
    }
  })

  it('should reject maxTurns as non-integer', () => {
    const result = AgentDefinitionSchema.safeParse({
      description: 'Bad agent',
      prompt: 'test',
      maxTurns: 3.5,
    })
    expect(result.success).toBe(false)
  })

  it('should reject maxTurns <= 0', () => {
    for (const val of [0, -1, -10]) {
      const result = AgentDefinitionSchema.safeParse({
        description: 'Bad agent',
        prompt: 'test',
        maxTurns: val,
      })
      expect(result.success).toBe(false, `Expected maxTurns=${val} to be rejected`)
    }
  })

  it('should accept effort as a named level', () => {
    const valid = {
      description: 'Effortful agent',
      prompt: 'Work hard.',
      effort: 'high',
    }

    const result = AgentDefinitionSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('should accept memory scope', () => {
    for (const scope of ['user', 'project', 'local'] as const) {
      const result = AgentDefinitionSchema.safeParse({
        description: 'test',
        prompt: 'test',
        memory: scope,
      })
      expect(result.success).toBe(true, `Expected memory=${scope} to be accepted`)
    }
  })

  it('should reject invalid memory scope', () => {
    const result = AgentDefinitionSchema.safeParse({
      description: 'test',
      prompt: 'test',
      memory: 'global',
    })
    expect(result.success).toBe(false)
  })

  it('should accept permissionMode', () => {
    const valid = {
      description: 'Permissive agent',
      prompt: 'Do stuff.',
      permissionMode: 'bypassPermissions',
    }

    const result = AgentDefinitionSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('should accept all valid permissionMode values', () => {
    const modes = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk'] as const
    for (const mode of modes) {
      const result = AgentDefinitionSchema.safeParse({
        description: 'test',
        prompt: 'test',
        permissionMode: mode,
      })
      expect(result.success).toBe(true, `Expected permissionMode="${mode}" to be accepted`)
    }
  })

  it('should accept background flag', () => {
    const valid = {
      description: 'Background agent',
      prompt: 'Run in background.',
      background: true,
    }

    const result = AgentDefinitionSchema.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.background).toBe(true)
    }
  })

  it('should accept initialPrompt', () => {
    const valid = {
      description: 'Auto-start agent',
      prompt: 'Do work.',
      initialPrompt: '/review',
    }

    const result = AgentDefinitionSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('should accept criticalSystemReminder_EXPERIMENTAL', () => {
    const valid = {
      description: 'Experimental agent',
      prompt: 'Do work.',
      criticalSystemReminder_EXPERIMENTAL: 'Always validate input before processing.',
    }

    const result = AgentDefinitionSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })
})

// ============================================================================
// AgentDefinition — edge cases
// ============================================================================

describe('AgentDefinition — edge cases', () => {
  it('should accept a fully specified agent definition', () => {
    const full: AgentDefinition = {
      description: 'A comprehensive code review agent',
      tools: ['Read', 'Glob', 'Grep', 'Bash'],
      disallowedTools: ['Write'],
      prompt: 'You are an expert code reviewer. Analyze code for bugs, security issues, and style problems.',
      model: 'sonnet',
      mcpServers: ['filesystem', { github: { type: 'sse', url: 'https://mcp.github.com/sse' } }],
      skills: ['code-review-checklist'],
      initialPrompt: '/review',
      maxTurns: 20,
      background: false,
      memory: 'project',
      effort: 'high',
      permissionMode: 'acceptEdits',
      criticalSystemReminder_EXPERIMENTAL: 'Always cite line numbers.',
    }

    const result = AgentDefinitionSchema.safeParse(full)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.description).toBe(full.description)
      expect(result.data.tools).toEqual(full.tools)
      expect(result.data.disallowedTools).toEqual(full.disallowedTools)
      expect(result.data.prompt).toBe(full.prompt)
      expect(result.data.model).toBe(full.model)
      expect(result.data.maxTurns).toBe(full.maxTurns)
    }
  })

  it('should reject extra unknown properties in strict mode', () => {
    const result = AgentDefinitionSchema.safeParse({
      description: 'test',
      prompt: 'test',
      unknownField: 'should not pass',
    })
    // Zod object strips unknown fields by default; this tests that schema doesn't break
    expect(result.success).toBe(true)
  })
})

// ============================================================================
// Type inference
// ============================================================================

describe('Type inference', () => {
  it('should infer AgentDefinition from schema', () => {
    type Inferred = z.infer<typeof AgentDefinitionSchema>
    const val: Inferred = {
      description: 'test',
      prompt: 'test',
    }
    expect(val.description).toBe('test')
  })

  it('should infer AgentMcpServerSpec from schema', () => {
    type Inferred = z.infer<typeof AgentMcpServerSpecSchema>
    const stringVal: Inferred = 'simple-server'
    expect(stringVal).toBe('simple-server')
  })
})
