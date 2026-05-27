import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { BaseTool, createTool } from '../tools/base.js'
import { ToolRegistry } from '../tools/registry.js'

// ─── Test Fixtures ───────────────────────────────────────

const echoSchema = z.object({
  message: z.string(),
})

class EchoTool extends BaseTool<typeof echoSchema, string> {
  name = 'echo'
  description = 'Echoes back the input'
  inputSchema = echoSchema

  async execute(input: { message: string }, _context: { signal: AbortSignal }) {
    return {
      data: input.message,
      content: `Echo: ${input.message}`,
    }
  }
}

const failingSchema = z.object({
  shouldFail: z.boolean(),
})

class FailingTool extends BaseTool<typeof failingSchema, string> {
  name = 'failing'
  description = 'Always fails'
  inputSchema = failingSchema

  async execute() {
    throw new Error('Expected failure')
  }
}

const addSchema = z.object({
  a: z.number(),
  b: z.number(),
})

const echoTool = createTool({
  name: 'echo',
  description: 'Echoes back the input',
  inputSchema: echoSchema,
  async execute(input) {
    return { data: input.message, content: `Echo: ${input.message}` }
  },
})

const addTool = createTool({
  name: 'add',
  description: 'Adds two numbers',
  inputSchema: addSchema,
  async execute(input) {
    const result = input.a + input.b
    return { data: result, content: `Result: ${result}` }
  },
})

// ─── ToolRegistry Tests ──────────────────────────────────

describe('ToolRegistry', () => {
  it('should register and retrieve a tool', () => {
    const registry = new ToolRegistry()
    registry.register(echoTool)
    expect(registry.get('echo')).toBe(echoTool)
    expect(registry.has('echo')).toBe(true)
  })

  it('should throw when registering duplicate tools', () => {
    const registry = new ToolRegistry()
    registry.register(echoTool)
    expect(() => registry.register(echoTool)).toThrow(/already registered/)
  })

  it('should get all registered tools', () => {
    const registry = new ToolRegistry()
    registry.register(echoTool, addTool)
    const all = registry.getAll()
    expect(all).toHaveLength(2)
    expect(all.map((t) => t.name)).toContain('echo')
    expect(all.map((t) => t.name)).toContain('add')
  })

  it('should unregister a tool', () => {
    const registry = new ToolRegistry()
    registry.register(echoTool)
    expect(registry.unregister('echo')).toBe(true)
    expect(registry.has('echo')).toBe(false)
  })

  it('should return false when unregistering non-existent tool', () => {
    const registry = new ToolRegistry()
    expect(registry.unregister('nonexistent')).toBe(false)
  })

  it('should clear all tools', () => {
    const registry = new ToolRegistry()
    registry.register(echoTool, addTool)
    registry.clear()
    expect(registry.size).toBe(0)
  })

  it('should execute a tool by name', async () => {
    const registry = new ToolRegistry()
    registry.register(echoTool)
    const result = await registry.execute(
      'echo',
      { message: 'hello' },
      {
        signal: new AbortController().signal,
      },
    )
    expect(result.content).toBe('Echo: hello')
    expect(result.isError).toBeFalsy()
  })

  it('should return error for unknown tool', async () => {
    const registry = new ToolRegistry()
    const result = await registry.execute(
      'unknown',
      {},
      {
        signal: new AbortController().signal,
      },
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Unknown tool')
  })

  it('should return error for invalid input', async () => {
    const registry = new ToolRegistry()
    registry.register(echoTool)
    const result = await registry.execute(
      'echo',
      { wrong: 'field' },
      {
        signal: new AbortController().signal,
      },
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Invalid input')
  })

  it('should return error when tool throws', async () => {
    const registry = new ToolRegistry()
    const errorTool = createTool({
      name: 'error_tool',
      description: 'Always throws',
      inputSchema: z.object({}),
      async execute() {
        throw new Error('Something went wrong')
      },
    })
    registry.register(errorTool)
    const result = await registry.execute(
      'error_tool',
      {},
      {
        signal: new AbortController().signal,
      },
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Something went wrong')
  })

  it('should convert tools to API schemas', () => {
    const registry = new ToolRegistry()
    registry.register(echoTool)
    const schemas = registry.toAPISchemas()
    expect(schemas).toHaveLength(1)
    expect(schemas[0]?.name).toBe('echo')
    expect(schemas[0]?.input_schema.type).toBe('object')
  })

  it('should return frozen tool list', () => {
    const registry = new ToolRegistry()
    registry.register(echoTool)
    const tools = registry.getTools()
    expect(Object.isFrozen(tools)).toBe(true)
  })
})

// ─── BaseTool Tests ─────────────────────────────────────

describe('BaseTool', () => {
  it('should create a tool from class', async () => {
    const tool = new EchoTool()
    expect(tool.name).toBe('echo')
    expect(tool.description).toBe('Echoes back the input')
    expect(tool.isReadOnly({ message: 'test' })).toBe(false)
    expect(tool.isConcurrencySafe()).toBe(false)
    expect(tool.userFacingName()).toBe('echo')

    const result = await tool.execute(
      { message: 'hi' },
      {
        signal: new AbortController().signal,
      },
    )
    expect(result.content).toBe('Echo: hi')
    expect(result.data).toBe('hi')
  })

  it('should convert to Tool interface via toTool()', async () => {
    const tool = new EchoTool()
    const toolInterface = tool.toTool()
    expect(toolInterface.name).toBe('echo')

    const result = await toolInterface.execute(
      { message: 'test' },
      {
        signal: new AbortController().signal,
      },
    )
    expect(result.content).toBe('Echo: test')
  })
})

// ─── createTool Tests ────────────────────────────────────

describe('createTool', () => {
  it('should create a tool from object definition', async () => {
    const result = await echoTool.execute(
      { message: 'world' },
      {
        signal: new AbortController().signal,
      },
    )
    expect(result.content).toBe('Echo: world')
    expect(result.data).toBe('world')
  })

  it('should handle numeric inputs', async () => {
    const result = await addTool.execute(
      { a: 3, b: 4 },
      {
        signal: new AbortController().signal,
      },
    )
    expect(result.data).toBe(7)
    expect(result.content).toBe('Result: 7')
  })
})
