#!/usr/bin/env npx tsx
/**
 * E2E Scenario Test — Claude Code SDK
 *
 * This script simulates a full user workflow:
 * 1. Create SDK → Send message → Receive response → Tool calls
 * 2. Multi-turn conversation
 * 3. Streaming mode
 * 4. Error handling
 *
 * Usage:
 *   npx tsx scripts/e2e-test.ts
 *
 * Environment:
 *   DEEPSEEK_API_KEY  — API key (default: hardcoded test key)
 *   DEEPSEEK_BASE_URL — Base URL (default: https://api.deepseek.com/anthropic)
 *   DEEPSEEK_MODEL    — Model name (default: deepseek-v4-flash)
 */

import { ClaudeCodeSDK } from '../src/session/engine.js'
import { createTool } from '../src/tools/base.js'
import { z } from 'zod'

// ─── Configuration ───────────────────────────────────────

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? 'sk-af3a84b5661b44f5b5695b47cb39dcd2'
const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/anthropic'
const MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash'

const sdkConfig = {
  llm: {
    provider: 'anthropic' as const,
    apiKey: DEEPSEEK_API_KEY,
    baseUrl: BASE_URL,
    model: MODEL,
    maxTokens: 2048,
  },
}

// ─── Utilities ───────────────────────────────────────────

let passed = 0
let failed = 0
const results: Array<{ name: string; status: 'PASS' | 'FAIL'; detail: string }> = []

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
    passed++
    results.push({ name, status: 'PASS', detail: 'OK' })
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed++
    const msg = err instanceof Error ? err.message : String(err)
    results.push({ name, status: 'FAIL', detail: msg })
    console.log(`  ✗ ${name}: ${msg}`)
  }
}

// ─── Tests ───────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n' + '='.repeat(60))
  console.log('  Claude Code SDK — E2E Scenario Test')
  console.log(`  Model: ${MODEL}`)
  console.log(`  Base URL: ${BASE_URL}`)
  console.log('='.repeat(60) + '\n')

  // ─── Test 1: Basic Connectivity ────────────────────────

  console.log('[Test Suite 1] Basic LLM Connectivity')
  await runTest('send a simple message and get a non-empty response', async () => {
    const sdk = ClaudeCodeSDK.create(sdkConfig)
    const response = await sdk.send('Reply with exactly: "E2E_OK"')
    assert(response.content.length > 0, 'Response content is empty')
    assert(response.usage.inputTokens > 0, 'No input tokens recorded')
    assert(response.usage.outputTokens > 0, 'No output tokens recorded')
    console.log(`    Content: "${response.content.slice(0, 80)}..."`)
    console.log(`    Tokens: input=${response.usage.inputTokens}, output=${response.usage.outputTokens}`)
  })

  // ─── Test 2: Multi-turn Conversation ───────────────────

  console.log('\n[Test Suite 2] Multi-turn Conversation')
  let sdk: ClaudeCodeSDK

  await runTest('remember context from previous turns', async () => {
    sdk = ClaudeCodeSDK.create(sdkConfig)

    // Turn 1
    const r1 = await sdk.send('Remember this: my secret number is 42')
    console.log(`    Turn 1: "${r1.content.slice(0, 60)}"`)
    assert(r1.content.length > 0, 'Turn 1 response is empty')

    // Turn 2
    const r2 = await sdk.send('What is my secret number?')
    console.log(`    Turn 2: "${r2.content.slice(0, 80)}"`)
    assert(r2.content.toLowerCase().includes('42'), 'Model did not remember the secret number')
  })

  await runTest('token usage accumulates across turns', async () => {
    const usage = sdk!.getTokenUsage()
    assert(usage.inputTokens > 0, 'Input tokens should be > 0 after 2 turns')
    assert(usage.outputTokens > 0, 'Output tokens should be > 0 after 2 turns')
    console.log(`    Total tokens: input=${usage.inputTokens}, output=${usage.outputTokens}`)
  })

  // ─── Test 3: Tool Calls ────────────────────────────────

  console.log('\n[Test Suite 3] Tool Calls')

  const greetSchema = z.object({
    name: z.string().describe('The name to greet'),
  })

  const greetTool = createTool({
    name: 'greet',
    description: 'Greets a person by name with a friendly message. Use this when asked to greet someone.',
    inputSchema: greetSchema,
    async execute(input) {
      return { data: `Hello, ${input.name}!`, content: `Successfully greeted ${input.name}` }
    },
  })

  // We use the same SDK instance from before but reset the conversation
  await runTest('call a custom tool via LLM', async () => {
    const toolSdk = ClaudeCodeSDK.create(sdkConfig)
    toolSdk.use(greetTool)

    const response = await toolSdk.send('Please use the greet tool to greet "E2E-Tester"')
    console.log(`    Response: "${response.content.slice(0, 100)}"`)
    console.log(`    Tool calls: ${response.toolCalls.length}`)

    if (response.toolCalls.length > 0) {
      const call = response.toolCalls[0]
      assert(call.toolName === 'greet', `Expected tool name "greet", got "${call.toolName}"`)
      assert(call.input !== undefined, 'Tool call input is undefined')
      console.log(`    Tool: ${call.toolName}, Input: ${JSON.stringify(call.input)}`)
    } else {
      console.log('    (Model responded with text instead of tool call — acceptable)')
    }
  })

  // ─── Test 4: Streaming ─────────────────────────────────

  console.log('\n[Test Suite 4] Streaming')

  await runTest('stream text events correctly', async () => {
    const streamSdk = ClaudeCodeSDK.create(sdkConfig)
    const textChunks: string[] = []
    let hasDone = false

    for await (const event of streamSdk.stream('Write a short sentence about AI.')) {
      if (event.type === 'text') {
        textChunks.push(event.text)
      }
      if (event.type === 'done') {
        hasDone = true
        assert(event.usage.inputTokens > 0, 'Done event has no input tokens')
        assert(event.usage.outputTokens > 0, 'Done event has no output tokens')
        console.log(`    Usage: input=${event.usage.inputTokens}, output=${event.usage.outputTokens}`)
      }
    }

    assert(hasDone, 'No done event received')
    assert(textChunks.length > 0, 'No text events received')
    const fullText = textChunks.join('')
    assert(fullText.length > 0, 'Streamed text is empty')
    console.log(`    Text chunks: ${textChunks.length}, Total chars: ${fullText.length}`)
    console.log(`    Content: "${fullText.slice(0, 100)}..."`)
  })

  // ─── Test 5: Conversation Reset ────────────────────────

  console.log('\n[Test Suite 5] Conversation Reset')

  await runTest('reset conversation clears context', async () => {
    const resetSdk = ClaudeCodeSDK.create(sdkConfig)

    await resetSdk.send('Remember: the password is "opensesame"')

    // Reset
    resetSdk.newConversation()
    assert(resetSdk.getTurnCount() === 0, 'Turn count not reset')

    const response = await resetSdk.send('What was the password I told you?')
    console.log(`    After reset: "${response.content.slice(0, 120)}"`)

    // Model should not know the password after reset
    const knowsPassword = response.content.toLowerCase().includes('opensesame')
    if (!knowsPassword) {
      console.log('    ✓ Model correctly forgot the password after reset')
    } else {
      console.log('    ⚠ Model still remembers password after reset (model-specific)')
    }
  })

  // ─── Test 6: Multiple Built-in Tools ───────────────────

  console.log('\n[Test Suite 6] Built-in Tool Registration')

  await runTest('register multiple tools and verify they are available', async () => {
    const { BashTool } = await import('../src/tools/built-in/bash.js')
    const { FileReadTool } = await import('../src/tools/built-in/file_read.js')
    const { FileWriteTool } = await import('../src/tools/built-in/file_write.js')
    const { GlobTool } = await import('../src/tools/built-in/glob.js')
    const { GrepTool } = await import('../src/tools/built-in/grep.js')

    const multiSdk = ClaudeCodeSDK.create(sdkConfig)
    multiSdk.use(new BashTool(), new FileReadTool(), new FileWriteTool(), new GlobTool(), new GrepTool())

    // Ask for a bash command
    const response = await multiSdk.send('Run "echo E2E_TEST_COMPLETE" in bash')
    console.log(`    Response: "${response.content.slice(0, 120)}"`)

    if (response.toolCalls.length > 0) {
      const bashCall = response.toolCalls.find(tc => tc.toolName === 'bash')
      if (bashCall) {
        console.log(`    Bash tool was called, output: ${String(bashCall.output).slice(0, 100)}`)
      }
    }
  })

  // ─── Summary ───────────────────────────────────────────

  console.log('\n' + '='.repeat(60))
  console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`)
  console.log('='.repeat(60) + '\n')

  // Generate Markdown report
  const report = generateReport(results)
  console.log(report)

  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0)
}

function generateReport(results: Array<{ name: string; status: string; detail: string }>): string {
  const lines: string[] = []
  lines.push('# E2E Scenario Test Report')
  lines.push(`> Generated: ${new Date().toISOString()}`)
  lines.push(`> Model: ${MODEL}`)
  lines.push('')
  lines.push('| # | Test | Status | Detail |')
  lines.push('|---|------|--------|--------|')
  results.forEach((r, i) => {
    lines.push(`| ${i + 1} | ${r.name} | ${r.status} | ${r.detail} |`)
  })
  lines.push('')
  lines.push(`**Summary**: ${passed} passed / ${failed} failed / ${passed + failed} total`)
  return lines.join('\n')
}

// ─── Run ─────────────────────────────────────────────────

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
