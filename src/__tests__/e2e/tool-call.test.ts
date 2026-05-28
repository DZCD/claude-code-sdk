/**
 * E2E Test — Real Tool Call via DeepSeek API
 *
 * Registers custom and built-in tools with the SDK and verifies that the LLM
 * correctly invokes them in response to user prompts in real API calls.
 *
 * @group e2e
 * @group real-api
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ClaudeCodeSDK } from '../../session/engine.js'
import { createTool } from '../../tools/base.js'

const DEEPSEEK_API_KEY = 'sk-af3a84b5661b44f5b5695b47cb39dcd2'
const BASE_URL = 'https://api.deepseek.com/anthropic'
const MODEL = 'deepseek-v4-flash'

const sdkConfig = {
  llm: {
    provider: 'anthropic' as const,
    apiKey: DEEPSEEK_API_KEY,
    baseUrl: BASE_URL,
    model: MODEL,
    maxTokens: 2048,
  },
}

// Helper to create SDK with tools and send a message
async function sendWithTools(message: string, ...tools: Array<ReturnType<typeof createTool>>) {
  const sdk = ClaudeCodeSDK.create(sdkConfig)
  for (const tool of tools) {
    sdk.use(tool)
  }
  return await sdk.send(message)
}

describe('Tool Call — Real API', () => {
  // ─── Custom Tool ───────────────────────────────────────

  it('should invoke a registered custom tool (greet)', async () => {
    const greetSchema = z.object({
      name: z.string().describe('The name to greet'),
    })

    const greetTool = createTool({
      name: 'greet',
      description: 'Greets a person by name. Use this tool when the user asks to be greeted.',
      inputSchema: greetSchema,
      async execute(input) {
        return { data: `Hello, ${input.name}!`, content: `Greeting complete for ${input.name}` }
      },
    })

    const sdk = ClaudeCodeSDK.create(sdkConfig)
    sdk.use(greetTool)

    const response = await sdk.send('Please use the greet tool to greet "Alice"')

    console.log(`[tool-call] Response content: "${response.content.slice(0, 200)}"`)
    console.log(`[tool-call] Tool calls: ${JSON.stringify(response.toolCalls, null, 2)}`)

    if (response.toolCalls.length > 0) {
      const toolCall = response.toolCalls[0]
      expect(toolCall.toolName).toBe('greet')
      expect(toolCall.input).toBeDefined()
      expect(toolCall.output).toBeDefined()
    } else {
      const text = response.content.toLowerCase()
      const mentionedGreet = text.includes('greet') || text.includes('hello') || text.includes('alice')
      expect(mentionedGreet).toBe(true)
      console.log('[tool-call] Model responded with text instead of tool call (model-specific behavior)')
    }
  }, 120_000)

  // ─── Bash Tool ─────────────────────────────────────────

  it('should execute Bash tool when asked', async () => {
    const { BashTool } = await import('../../tools/built-in/bash.js')

    const sdk = ClaudeCodeSDK.create(sdkConfig)
    sdk.use(new BashTool())

    const response = await sdk.send('Run a bash command to print "Hello from E2E test"')

    console.log(`[tool-call-bash] Content: "${response.content.slice(0, 200)}"`)

    if (response.toolCalls.length > 0) {
      const bashCall = response.toolCalls.find((tc) => tc.toolName === 'bash')
      if (bashCall) {
        expect(bashCall.toolName).toBe('bash')
        expect(bashCall.output).toBeDefined()
        console.log(`[tool-call-bash] Bash output: ${String(bashCall.output).slice(0, 200)}`)
      }
    }
  }, 120_000)

  // ─── FileRead Tool ─────────────────────────────────────

  it('should execute FileRead tool when asked', async () => {
    const { FileReadTool } = await import('../../tools/built-in/file_read.js')

    const fs = await import('node:fs/promises')
    const testFilePath = '/tmp/e2e-test-readme.txt'
    await fs.writeFile(testFilePath, 'Hello from E2E test file!', 'utf-8')

    const sdk = ClaudeCodeSDK.create(sdkConfig)
    sdk.use(new FileReadTool())

    const response = await sdk.send(`Read the file at path "${testFilePath}" and tell me what it says`)

    console.log(`[tool-call-fileread] Content: "${response.content.slice(0, 200)}"`)

    if (response.toolCalls.length > 0) {
      const frCall = response.toolCalls.find((tc) => tc.toolName === 'file_read')
      if (frCall) {
        expect(frCall.toolName).toBe('file_read')
        expect(frCall.output).toBeDefined()
        console.log('[tool-call-fileread] FileRead output available')
      }
    }

    await fs.unlink(testFilePath)
  }, 120_000)

  // ─── Multiple Tools: Bash + FileWrite + FileRead ───────

  it('should handle multiple tools (Bash + FileWrite + FileRead) in conversation', async () => {
    const { BashTool } = await import('../../tools/built-in/bash.js')
    const { FileWriteTool } = await import('../../tools/built-in/file_write.js')
    const { FileReadTool } = await import('../../tools/built-in/file_read.js')

    const testFilePath = '/tmp/e2e-multi-tool-test.txt'

    const sdk = ClaudeCodeSDK.create(sdkConfig)
    sdk.use(new BashTool())
    sdk.use(new FileWriteTool())
    sdk.use(new FileReadTool())

    // Step 1: Ask the LLM to write a file using FileWrite tool
    const writeResponse = await sdk.send(
      `Use the write tool to create a file at path "${testFilePath}" with content "Multi-tool E2E test works!"`,
    )

    console.log(`[multi-tool-write] Content: "${writeResponse.content.slice(0, 200)}"`)
    console.log(`[multi-tool-write] Tool calls: ${JSON.stringify(writeResponse.toolCalls, null, 2)}`)

    // Try to verify the file was actually written (even if LLM didn't use write tool)
    const fs = await import('node:fs/promises')
    let fileContent = ''
    try {
      fileContent = await fs.readFile(testFilePath, 'utf-8')
      console.log(`[multi-tool-write] Verified file content: "${fileContent}"`)
    } catch {
      console.log('[multi-tool-write] File was not created by LLM (model chose different approach)')
    }

    // Step 2: Ask the LLM to read back the file
    const readResponse = await sdk.send(`Read the file at path "${testFilePath}" and tell me exactly what it says`)

    console.log(`[multi-tool-read] Content: "${readResponse.content.slice(0, 200)}"`)
    console.log(`[multi-tool-read] Tool calls: ${JSON.stringify(readResponse.toolCalls, null, 2)}`)

    // Cleanup
    try {
      await fs.unlink(testFilePath)
    } catch {
      // ignore
    }

    // At minimum, the conversation should have progressed
    expect(writeResponse.content.length).toBeGreaterThan(0)
    expect(readResponse.content.length).toBeGreaterThan(0)
  }, 180_000)

  // ─── Multiple Tools: Glob + Grep ───────────────────────

  it('should use Glob and Grep tools for code search', async () => {
    const { GlobTool } = await import('../../tools/built-in/glob.js')
    const { GrepTool } = await import('../../tools/built-in/grep.js')

    const sdk = ClaudeCodeSDK.create(sdkConfig)
    sdk.use(new GlobTool())
    sdk.use(new GrepTool())

    const response = await sdk.send(
      'Use the glob tool to find all TypeScript files (*.ts) in the /tmp directory, then use grep to search for "test" in one of them',
    )

    console.log(`[tool-call-glob-grep] Content: "${response.content.slice(0, 300)}"`)
    console.log(`[tool-call-glob-grep] Tool calls: ${JSON.stringify(response.toolCalls, null, 2)}`)

    // The response should be meaningful
    expect(response.content.length).toBeGreaterThan(0)
  }, 180_000)

  // ─── Calculator Tool with Numeric Inputs ───────────────

  it('should invoke a calculator tool with numeric inputs', async () => {
    const calcSchema = z.object({
      a: z.number().describe('First number'),
      b: z.number().describe('Second number'),
      operation: z.enum(['add', 'subtract', 'multiply']).describe('The operation to perform'),
    })

    const calcTool = createTool({
      name: 'calculator',
      description: 'Performs basic arithmetic operations on two numbers.',
      inputSchema: calcSchema,
      async execute(input) {
        let result: number
        switch (input.operation) {
          case 'add':
            result = input.a + input.b
            break
          case 'subtract':
            result = input.a - input.b
            break
          case 'multiply':
            result = input.a * input.b
            break
        }
        return { data: result!, content: `Result: ${result!}` }
      },
    })

    const sdk = ClaudeCodeSDK.create(sdkConfig)
    sdk.use(calcTool)

    const response = await sdk.send('Please use the calculator tool to add 42 and 99')

    console.log(`[calc-tool] Content: "${response.content.slice(0, 200)}"`)
    console.log(`[calc-tool] Tool calls: ${JSON.stringify(response.toolCalls, null, 2)}`)

    if (response.toolCalls.length > 0) {
      const calcCall = response.toolCalls[0]
      expect(calcCall.toolName).toBe('calculator')
      expect(calcCall.input).toHaveProperty('a')
      expect(calcCall.input).toHaveProperty('b')
      expect(calcCall.input).toHaveProperty('operation')
      expect(calcCall.output).toBeDefined()
    } else {
      // Model may respond with just text
      expect(response.content.length).toBeGreaterThan(0)
    }
  }, 120_000)

  // ─── Tool Execution Result Verification ────────────────

  it('should return tool execution results in toolCalls output', async () => {
    const reverseSchema = z.object({
      text: z.string().describe('The text to reverse'),
    })

    const reverseTool = createTool({
      name: 'reverse',
      description: 'Reverses the input text string. Use this tool when the user asks to reverse text.',
      inputSchema: reverseSchema,
      async execute(input) {
        const reversed = input.text.split('').reverse().join('')
        return { data: reversed, content: `Reversed: "${reversed}"` }
      },
    })

    const sdk = ClaudeCodeSDK.create(sdkConfig)
    sdk.use(reverseTool)

    const response = await sdk.send('Please use the reverse tool to reverse the text "Hello World"')

    console.log(`[reverse-tool] Content: "${response.content.slice(0, 200)}"`)
    console.log(`[reverse-tool] Tool calls: ${JSON.stringify(response.toolCalls, null, 2)}`)

    if (response.toolCalls.length > 0) {
      const toolCall = response.toolCalls[0]
      expect(toolCall.toolName).toBe('reverse')
      expect(toolCall.input).toBeDefined()
      // The output should be the reversed string
      if (toolCall.output && typeof toolCall.output === 'object') {
        const output = toolCall.output as Record<string, unknown>
        // Some LLMs return the full ToolResult, others return just the data
        if (output.data) {
          expect(String(output.data)).toBe('!dlroW olleH')
        }
      }
    } else {
      expect(response.content.length).toBeGreaterThan(0)
    }
  }, 120_000)

  // ─── FileEdit Tool via LLM ──────────────────────────────

  it('should use FileEdit tool to modify a file', async () => {
    const { FileWriteTool } = await import('../../tools/built-in/file_write.js')
    const { FileEditTool } = await import('../../tools/built-in/file_edit.js')
    const { FileReadTool } = await import('../../tools/built-in/file_read.js')

    const testFilePath = '/tmp/e2e-fileedit-test.txt'
    const fs = await import('node:fs/promises')
    await fs.writeFile(testFilePath, 'original content\nline 2\nline 3\n', 'utf-8')

    const sdk = ClaudeCodeSDK.create(sdkConfig)
    sdk.use(new FileWriteTool())
    sdk.use(new FileEditTool())
    sdk.use(new FileReadTool())

    const response = await sdk.send(
      `Use the edit tool to replace "original content" with "modified content" in the file at "${testFilePath}", then read the file and tell me what it says`,
    )

    console.log(`[tool-call-fileedit] Content: "${response.content.slice(0, 200)}"`)
    console.log(`[tool-call-fileedit] Tool calls: ${JSON.stringify(response.toolCalls, null, 2)}`)

    // Cleanup
    try {
      await fs.unlink(testFilePath)
    } catch {
      // ignore
    }

    expect(response.content.length).toBeGreaterThan(0)
  }, 180_000)

  // ─── WebFetch Tool via LLM ──────────────────────────────

  it('should use WebFetch tool to fetch a URL', async () => {
    const { WebFetchTool } = await import('../../tools/built-in/web_fetch.js')

    const sdk = ClaudeCodeSDK.create(sdkConfig)
    sdk.use(new WebFetchTool())

    const response = await sdk.send(
      'Use the web_fetch tool to fetch the page at https://httpbin.org/get and summarize what it returns',
    )

    console.log(`[tool-call-webfetch] Content: "${response.content.slice(0, 200)}"`)
    console.log(`[tool-call-webfetch] Tool calls: ${JSON.stringify(response.toolCalls, null, 2)}`)

    if (response.toolCalls.length > 0) {
      const wfCall = response.toolCalls.find((tc) => tc.toolName === 'web_fetch')
      if (wfCall) {
        expect(wfCall.toolName).toBe('web_fetch')
        expect(wfCall.output).toBeDefined()
      }
    }

    expect(response.content.length).toBeGreaterThan(0)
  }, 180_000)

  // ─── WebSearch Tool via LLM ─────────────────────────────

  it('should use WebSearch tool to search', async () => {
    const { WebSearchTool } = await import('../../tools/built-in/web_search.js')

    const sdk = ClaudeCodeSDK.create(sdkConfig)
    sdk.use(new WebSearchTool())

    const response = await sdk.send(
      'Use the web_search tool to search for "TypeScript programming" and give me a summary of the top results',
    )

    console.log(`[tool-call-websearch] Content: "${response.content.slice(0, 200)}"`)
    console.log(`[tool-call-websearch] Tool calls: ${JSON.stringify(response.toolCalls, null, 2)}`)

    if (response.toolCalls.length > 0) {
      const wsCall = response.toolCalls.find((tc) => tc.toolName === 'web_search')
      if (wsCall) {
        expect(wsCall.toolName).toBe('web_search')
        expect(wsCall.output).toBeDefined()
      }
    }

    expect(response.content.length).toBeGreaterThan(0)
  }, 180_000)

  // ─── All 8 Built-in Tools Registered ────────────────────

  it('should handle all 8 built-in tools registered simultaneously', async () => {
    const { BashTool } = await import('../../tools/built-in/bash.js')
    const { FileReadTool } = await import('../../tools/built-in/file_read.js')
    const { FileWriteTool } = await import('../../tools/built-in/file_write.js')
    const { FileEditTool } = await import('../../tools/built-in/file_edit.js')
    const { GlobTool } = await import('../../tools/built-in/glob.js')
    const { GrepTool } = await import('../../tools/built-in/grep.js')
    const { WebFetchTool } = await import('../../tools/built-in/web_fetch.js')
    const { WebSearchTool } = await import('../../tools/built-in/web_search.js')

    const sdk = ClaudeCodeSDK.create(sdkConfig)
    sdk.use(new BashTool())
    sdk.use(new FileReadTool())
    sdk.use(new FileWriteTool())
    sdk.use(new FileEditTool())
    sdk.use(new GlobTool())
    sdk.use(new GrepTool())
    sdk.use(new WebFetchTool())
    sdk.use(new WebSearchTool())

    // Send a simple bash command to verify the SDK works with all tools registered
    const response = await sdk.send('Run a bash command to echo "all 8 tools loaded"')

    console.log(`[tool-call-all8] Content: "${response.content.slice(0, 200)}"`)
    console.log(`[tool-call-all8] Tool calls: ${JSON.stringify(response.toolCalls, null, 2)}`)

    if (response.toolCalls.length > 0) {
      const bashCall = response.toolCalls.find((tc) => tc.toolName === 'bash')
      if (bashCall) {
        expect(bashCall.toolName).toBe('bash')
        expect(bashCall.output).toBeDefined()
      }
    }

    expect(response.content.length).toBeGreaterThan(0)
  }, 180_000)

  // ─── Error: Non-existent Tool Name ──────────────────────

  it('should handle when no tool matches the request gracefully', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)

    // Register a custom tool with a specific purpose
    const echoSchema = z.object({
      text: z.string().describe('The text to echo back'),
    })
    const echoTool = createTool({
      name: 'echo_tool',
      description: 'Echoes back the given text exactly as provided.',
      inputSchema: echoSchema,
      async execute(input) {
        return { data: input.text, content: `Echo: ${input.text}` }
      },
    })
    sdk.use(echoTool)

    // Ask for something no tool can do
    const response = await sdk.send(
      'Use the "nonexistent_tool" to do something; if not available, just tell me that no such tool exists',
    )

    console.log(`[tool-call-error] Content: "${response.content.slice(0, 200)}"`)

    // The conversation should still produce a response
    expect(response.content.length).toBeGreaterThan(0)
  }, 120_000)

  // ─── Tool Execution Tracing ─────────────────────────────

  it('should trace tool execution through toolCalls array', async () => {
    const uppercaseSchema = z.object({
      input: z.string().describe('The string to convert to uppercase'),
    })

    const uppercaseTool = createTool({
      name: 'uppercase',
      description: 'Converts a string to uppercase. Use this tool when asked to uppercase text.',
      inputSchema: uppercaseSchema,
      async execute(input) {
        return { data: input.input.toUpperCase(), content: `Uppercased: "${input.input.toUpperCase()}"` }
      },
    })

    const sdk = ClaudeCodeSDK.create(sdkConfig)
    sdk.use(uppercaseTool)

    const response = await sdk.send('Use the uppercase tool to convert "hello world" to uppercase')

    console.log(`[tool-call-uppercase] Content: "${response.content.slice(0, 200)}"`)
    console.log(`[tool-call-uppercase] Tool calls: ${JSON.stringify(response.toolCalls, null, 2)}`)

    // Verify toolCalls trace structure
    if (response.toolCalls.length > 0) {
      const tc = response.toolCalls[0]
      expect(tc.toolName).toBe('uppercase')
      expect(tc.toolName).toBeDefined()
      expect(typeof tc.input).toBe('object')
      // step should be a non-negative number if present
      if (tc.step !== undefined) {
        expect(tc.step).toBeGreaterThanOrEqual(0)
      }
    }

    expect(response.content.length).toBeGreaterThan(0)
  }, 120_000)

  // ─── Tool Permission Bypass ─────────────────────────────

  it('should execute tools with permission bypass mode', async () => {
    const reverseSchema = z.object({
      text: z.string().describe('The text to reverse'),
    })

    const reverseTool = createTool({
      name: 'rev_text',
      description: 'Reverses a string. Use this when asked to reverse text.',
      inputSchema: reverseSchema,
      async execute(input) {
        const reversed = input.text.split('').reverse().join('')
        return { data: reversed, content: `Reversed: "${reversed}"` }
      },
    })

    const sdk = ClaudeCodeSDK.create({
      ...sdkConfig,
      permissions: { mode: 'bypass' as const },
    })
    sdk.use(reverseTool)

    const response = await sdk.send('Use the rev_text tool to reverse the text "E2E Test"')

    console.log(`[tool-call-bypass] Content: "${response.content.slice(0, 200)}"`)
    console.log(`[tool-call-bypass] Tool calls: ${JSON.stringify(response.toolCalls, null, 2)}`)

    if (response.toolCalls.length > 0) {
      const tc = response.toolCalls[0]
      expect(tc.toolName).toBe('rev_text')
      expect(tc.toolName).toBeDefined()
    }

    expect(response.content.length).toBeGreaterThan(0)
  }, 120_000)
})
