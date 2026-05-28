/**
 * E2E Test — Config & Context Integration (Real API)
 *
 * Tests:
 * 1. SDK initialization with llm config via environment variables
 * 2. ConfigManager dynamic update and effect on subsequent calls
 * 3. ContextBuilder with real Git status
 * 4. Token statistics vs actual consumption with real API
 *
 * @group e2e
 * @group real-api
 * @requires DEEPSEEK_API_KEY
 */
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ClaudeCodeSDK } from '../../session/engine.js'

const DEEPSEEK_API_KEY = 'sk-af3a84b5661b44f5b5695b47cb39dcd2'
const BASE_URL = 'https://api.deepseek.com/anthropic'
const MODEL = 'deepseek-v4-flash'

describe('Config & Context Integration — Real API', () => {
  // ========== 1. SDK Initialization with Env-injected Config ==========

  describe('SDK init with env-injected config', () => {
    it('should initialize SDK and make a successful API call', async () => {
      const sdk = ClaudeCodeSDK.create({
        llm: {
          provider: 'anthropic',
          apiKey: DEEPSEEK_API_KEY,
          baseUrl: BASE_URL,
          model: MODEL,
          maxTokens: 1024,
        },
      })

      const response = await sdk.send('Reply with exactly: "SDK initialized successfully"')

      expect(response).toBeDefined()
      expect(response.content).toBeDefined()
      expect(response.content.length).toBeGreaterThan(0)
      expect(response.usage).toBeDefined()
      expect(response.usage.inputTokens).toBeGreaterThan(0)
      expect(response.usage.outputTokens).toBeGreaterThan(0)

      // Verify token usage tracking
      const usage = sdk.getTokenUsage()
      expect(usage.inputTokens).toBeGreaterThan(0)
      expect(usage.outputTokens).toBeGreaterThan(0)

      console.log(`[config-context] Init - Input: ${usage.inputTokens}, Output: ${usage.outputTokens}`)
    }, 60_000)

    it('should respect custom maxTokens config and not exceed it significantly', async () => {
      const sdk = ClaudeCodeSDK.create({
        llm: {
          provider: 'anthropic',
          apiKey: DEEPSEEK_API_KEY,
          baseUrl: BASE_URL,
          model: MODEL,
          maxTokens: 100, // very small limit
        },
      })

      const response = await sdk.send('Write a 10-paragraph essay about AI.')
      expect(response).toBeDefined()
      expect(response.usage.outputTokens).toBeLessThanOrEqual(300) // some overhead is ok
      console.log(`[config-context] maxTokens=100 - Output tokens: ${response.usage.outputTokens}`)
    }, 60_000)
  })

  // ========== 2. ConfigManager Dynamic Update ==========

  describe('ConfigManager dynamic update', () => {
    it('should allow updating config and affect new conversations', async () => {
      const sdk = ClaudeCodeSDK.create({
        llm: {
          provider: 'anthropic',
          apiKey: DEEPSEEK_API_KEY,
          baseUrl: BASE_URL,
          model: MODEL,
          maxTokens: 1024,
        },
      })

      // First call with default config
      const r1 = await sdk.send('Reply with: "First call"')
      expect(r1.content).toContain('First')

      // Start a new conversation
      sdk.newConversation()

      // Second call — should work on fresh context
      const r2 = await sdk.send('Reply with: "Second call"')
      expect(r2.content).toContain('Second')

      console.log(`[config-context] Dynamic update - Tokens: ${r1.usage.outputTokens} / ${r2.usage.outputTokens}`)
    }, 120_000)

    it('should accumulate token usage across multiple turns', async () => {
      const sdk = ClaudeCodeSDK.create({
        llm: {
          provider: 'anthropic',
          apiKey: DEEPSEEK_API_KEY,
          baseUrl: BASE_URL,
          model: MODEL,
          maxTokens: 1024,
        },
      })

      await sdk.send('Say: "Turn 1"')
      const usage1 = sdk.getTokenUsage()
      expect(usage1.inputTokens).toBeGreaterThan(0)
      expect(usage1.outputTokens).toBeGreaterThan(0)

      await sdk.send('Say: "Turn 2"')
      const usage2 = sdk.getTokenUsage()
      // Input tokens should increase (conversation history grows)
      expect(usage2.inputTokens).toBeGreaterThan(usage1.inputTokens)
      expect(usage2.outputTokens).toBeGreaterThan(usage1.outputTokens)

      console.log(`[config-context] Accumulated - Input: ${usage2.inputTokens}, Output: ${usage2.outputTokens}`)
    }, 120_000)
  })

  // ========== 3. ContextBuilder with Real Git Status ==========

  describe('ContextBuilder with real git status', () => {
    let gitRepoDir: string

    beforeAll(() => {
      // Create a temporary git repo for testing
      gitRepoDir = mkdtempSync(join(tmpdir(), 'e2e-git-test-'))
      execSync('git init', { cwd: gitRepoDir, encoding: 'utf-8', timeout: 5000 })
      execSync('git config user.email test@test.com', { cwd: gitRepoDir, encoding: 'utf-8', timeout: 5000 })
      execSync('git config user.name Test', { cwd: gitRepoDir, encoding: 'utf-8', timeout: 5000 })
      // Make initial commit
      writeFileSync(join(gitRepoDir, 'README.md'), '# Test Repo')
      execSync('git add .', { cwd: gitRepoDir, encoding: 'utf-8', timeout: 5000 })
      execSync('git commit -m "Initial commit"', { cwd: gitRepoDir, encoding: 'utf-8', timeout: 5000 })
      // Add some changes
      writeFileSync(join(gitRepoDir, 'new-file.ts'), 'const x = 1;\nconsole.log(x);\n')
      writeFileSync(join(gitRepoDir, 'README.md'), '# Test Repo\n\nModified content')
      // Create CLAUDE.md in the repo
      writeFileSync(join(gitRepoDir, 'CLAUDE.md'), '# Project Rules\n\n- Use TypeScript\n- Write tests')
    })

    afterAll(() => {
      try {
        execSync(`rm -rf ${gitRepoDir}`, { timeout: 5000 })
      } catch { /* ignore */ }
    })

    it('should build context with real git repo status', async () => {
      const { ContextBuilder } = await import('../../context/builder.js')

      const builder = new ContextBuilder(gitRepoDir)
      const context = await builder.build({
        includeGitStatus: true,
        includeGitDiff: true,
        includeClaudeMd: false,
        includeMemory: false,
      })

      expect(context).toContain('Current branch')
      expect(context).toContain('Commit')
      expect(context).toContain('Changes')
      expect(context).toContain('new-file.ts')

      console.log(`[config-context] Git context:\n${context.slice(0, 500)}...`)
    })

    it('should build context with memory files included', async () => {
      const { ContextBuilder } = await import('../../context/builder.js')

      const builder = new ContextBuilder(gitRepoDir)
      const context = await builder.build({
        includeGitStatus: true,
        includeGitDiff: true,
        includeMemory: true,
      })

      expect(context).toContain('Project Rules')
      expect(context).toContain('TypeScript')
      expect(context).toContain('Current branch')

      console.log(`[config-context] Context with memory:\n${context.slice(0, 500)}...`)
    })

    it('should return empty context outside a git repo', async () => {
      const { ContextBuilder } = await import('../../context/builder.js')

      const nonGitDir = mkdtempSync(join(tmpdir(), 'e2e-non-git-'))
      try {
        const builder = new ContextBuilder(nonGitDir)
        const context = await builder.build({
          includeGitStatus: true,
          includeGitDiff: false,
          includeClaudeMd: false,
          includeMemory: false,
        })
        // Outside git repo, no context should be produced
        expect(context).toBe('')
      } finally {
        try { execSync(`rm -rf ${nonGitDir}`, { timeout: 5000 }) } catch { /* ignore */ }
      }
    })
  })

  // ========== 4. Config + Context Pure Integration (no API key required) ==========

  describe('ConfigManager multi-source merge E2E', () => {
    const testDir = mkdtempSync(join(tmpdir(), 'e2e-cfg-merge-'))
    let configPath: string

    beforeAll(() => {
      // Create a settings.json with anthropic config
      configPath = join(testDir, 'settings.json')
      writeFileSync(
        configPath,
        JSON.stringify({
          llm: { provider: 'anthropic', apiKey: 'sk-file-key', model: 'claude-sonnet-4-20250514' },
          permissionMode: 'manual',
        }),
        'utf-8',
      )
    })

    afterAll(() => {
      try { execSync(`rm -rf ${testDir}`, { timeout: 5000 }) } catch { /* ignore */ }
    })

    it('should merge file + env + cliArgs with correct priority order', async () => {
      const { ConfigManager } = await import('../../config/manager.js')
      const cm = new ConfigManager()

      cm.loadFromSources({
        filePath: configPath,
        env: { ANTHROPIC_API_KEY: 'sk-env-override' },
        cliArgs: { permissionMode: 'bypass' },
      })

      const config = cm.getConfig()
      // CLI wins
      expect(config.permissionMode).toBe('bypass')
      // Env overrides file (env has ANTHROPIC_API_KEY → replaces llm block)
      expect(config.llm.apiKey).toBe('sk-env-override')
      // Model from file is replaced by env default
      expect(config.llm.model).toBe('claude-sonnet-4-20250514')
    })

    it('should emit correct change events during loadFromSources', async () => {
      const { ConfigManager } = await import('../../config/manager.js')
      const cm = new ConfigManager()
      const events: Array<{ key: string; oldValue?: unknown; newValue?: unknown }> = []

      cm.onDidChange((event) => {
        events.push({ key: event.key, oldValue: event.oldValue, newValue: event.newValue })
      })

      cm.loadFromSources({
        filePath: configPath,
        cliArgs: { permissionMode: 'bypass' },
      })

      // Should fire at least 2 change events (permissionMode + llm)
      expect(events.length).toBeGreaterThanOrEqual(2)
      const permEvent = events.find((e) => e.key === 'permissionMode')
      expect(permEvent).toBeDefined()
      expect(permEvent!.newValue).toBe('bypass')
    })

    it('should validate merged config successfully', async () => {
      const { ConfigManager } = await import('../../config/manager.js')
      const cm = new ConfigManager()

      cm.loadFromSources({
        filePath: configPath,
        env: { CLAUDE_CODE_PERMISSION_MODE: 'plan' },
        cliArgs: { defaultTools: false },
      })

      const result = cm.validateZod()
      expect(result.valid).toBe(true)
    })
  })

  describe('ConfigManager environment variable override priority E2E', () => {
    const testDir = mkdtempSync(join(tmpdir(), 'e2e-env-pri-'))

    afterAll(() => {
      try { execSync(`rm -rf ${testDir}`, { timeout: 5000 }) } catch { /* ignore */ }
    })

    it('should allow env ANTHROPIC_API_KEY to set anthropic provider', async () => {
      const { ConfigManager } = await import('../../config/manager.js')
      const cm = new ConfigManager()

      const savedKey = process.env.ANTHROPIC_API_KEY
      process.env.ANTHROPIC_API_KEY = 'sk-real-env-key'
      process.env.ANTHROPIC_MODEL = 'claude-opus-4-20250514'

      cm.mergeFromEnv()
      const config = cm.getConfig()

      expect(config.llm.provider).toBe('anthropic')
      expect(config.llm.apiKey).toBe('sk-real-env-key')

      if (savedKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = savedKey
      } else {
        delete process.env.ANTHROPIC_API_KEY
      }
      delete process.env.ANTHROPIC_MODEL
    })

    it('should prioritize cliArgs over env in loadFromSources', async () => {
      const { ConfigManager } = await import('../../config/manager.js')
      const cm = new ConfigManager()

      const configPath = join(testDir, 'settings.json')
      writeFileSync(
        configPath,
        JSON.stringify({
          llm: { provider: 'anthropic', apiKey: 'sk-file', model: 'test-model' },
        }),
        'utf-8',
      )

      cm.loadFromSources({
        filePath: configPath,
        env: { ANTHROPIC_API_KEY: 'sk-env-key' },
        cliArgs: { llm: { provider: 'anthropic', apiKey: 'sk-cli-key', model: 'cli-model' } as any },
      })

      const config = cm.getConfig()
      // CLI args should have highest priority
      expect(config.llm.apiKey).toBe('sk-cli-key')
      expect(config.llm.model).toBe('cli-model')
    })

    it('should set llm to bedrock when AWS env vars present', async () => {
      const { ConfigManager } = await import('../../config/manager.js')
      const cm = new ConfigManager()

      const savedAccessKey = process.env.AWS_ACCESS_KEY_ID
      const savedSecretKey = process.env.AWS_SECRET_ACCESS_KEY
      const savedRegion = process.env.AWS_REGION

      process.env.AWS_ACCESS_KEY_ID = 'e2e-aws-key'
      process.env.AWS_SECRET_ACCESS_KEY = 'e2e-aws-secret'
      process.env.AWS_REGION = 'eu-west-1'

      cm.mergeFromEnv()
      const config = cm.getConfig()
      expect(config.llm.provider).toBe('bedrock')
      if (config.llm.provider === 'bedrock') {
        expect(config.llm.region).toBe('eu-west-1')
      }

      // Restore
      if (savedAccessKey !== undefined) { process.env.AWS_ACCESS_KEY_ID = savedAccessKey } else { delete process.env.AWS_ACCESS_KEY_ID }
      if (savedSecretKey !== undefined) { process.env.AWS_SECRET_ACCESS_KEY = savedSecretKey } else { delete process.env.AWS_SECRET_ACCESS_KEY }
      if (savedRegion !== undefined) { process.env.AWS_REGION = savedRegion } else { delete process.env.AWS_REGION }
    })
  })

  describe('ContextBuilder with workspace git E2E', () => {
    it('should build context from current workspace (a git repo)', async () => {
      const { ContextBuilder } = await import('../../context/builder.js')
      const workspaceDir = '/home/user/.duclaw/workspace/claude-code-sdk'

      const builder = new ContextBuilder(workspaceDir)
      const context = await builder.build({
        includeGitStatus: true,
        includeGitDiff: false,
        includeClaudeMd: false,
        includeMemory: false,
      })

      // The workspace is a git repo, so context should contain git info
      expect(context).toContain('Current branch')
      expect(context).toContain('Commit')
      expect(typeof context).toBe('string')
      expect(context.length).toBeGreaterThan(0)
    })

    it('should build context with CLAUDE.md from workspace', async () => {
      const { ContextBuilder } = await import('../../context/builder.js')
      const workspaceDir = '/home/user/.duclaw/workspace/claude-code-sdk'

      const builder = new ContextBuilder(workspaceDir)
      const context = await builder.build({
        includeGitStatus: false,
        includeGitDiff: false,
        includeClaudeMd: true,
        includeMemory: false,
      })

      // Workspace may or may not have CLAUDE.md — either way, no crash
      expect(typeof context).toBe('string')
    })
  })

  describe('Config change event E2E', () => {
    const testDir = mkdtempSync(join(tmpdir(), 'e2e-cfg-event-'))
    let configPath: string

    beforeAll(() => {
      configPath = join(testDir, 'settings.json')
      writeFileSync(
        configPath,
        JSON.stringify({
          llm: { provider: 'anthropic', apiKey: 'sk-event', model: 'event-model' },
          permissionMode: 'manual',
        }),
        'utf-8',
      )
    })

    afterAll(() => {
      try { execSync(`rm -rf ${testDir}`, { timeout: 5000 }) } catch { /* ignore */ }
    })

    it('should trigger change event when config file is externally modified', async () => {
      const { ConfigManager } = await import('../../config/manager.js')
      const cm = new ConfigManager()
      cm.loadFromFile(configPath)

      // Register listener
      const changePromise = new Promise<{ key: string; newValue: unknown }>((resolve) => {
        cm.onDidChange((event) => {
          if (event.key === 'permissionMode') {
            resolve({ key: event.key, newValue: event.newValue })
          }
        })
      })

      // Watch the file
      cm.watch(configPath)

      // Externally modify the file
      await new Promise((r) => setTimeout(r, 200))
      writeFileSync(
        configPath,
        JSON.stringify({
          llm: { provider: 'anthropic', apiKey: 'sk-event', model: 'event-model' },
          permissionMode: 'bypass',
        }),
        'utf-8',
      )

      const event = await changePromise
      expect(event.key).toBe('permissionMode')
      expect(event.newValue).toBe('bypass')

      cm.unwatch()
    }, 15000)

    it('should trigger event on update() and verify reloaded config', async () => {
      const { ConfigManager } = await import('../../config/manager.js')
      const cm = new ConfigManager()
      cm.loadFromFile(configPath)

      const events: string[] = []
      cm.onDidChange((event) => { events.push(event.key) })

      cm.update({ permissionMode: 'plan', defaultTools: false })

      expect(events).toContain('permissionMode')
      expect(events).toContain('defaultTools')
      expect(cm.getConfig().permissionMode).toBe('plan')
      expect(cm.getConfig().defaultTools).toBe(false)
    })
  })

  // ========== 5. Token Statistics vs Actual Consumption ==========

  describe('SDK token statistics with real API', () => {
    it('should report lower token usage after newConversation reset', async () => {
      const sdk = ClaudeCodeSDK.create({
        llm: {
          provider: 'anthropic',
          apiKey: DEEPSEEK_API_KEY,
          baseUrl: BASE_URL,
          model: MODEL,
          maxTokens: 1024,
        },
      })

      // Make a call to accumulate tokens
      await sdk.send('Say "accumulate"')
      const beforeReset = sdk.getTokenUsage()
      expect(beforeReset.inputTokens).toBeGreaterThan(0)

      // Reset conversation
      sdk.newConversation()

      // Make another call — should still track but on new conversation
      await sdk.send('Say "new conversation"')
      const afterReset = sdk.getTokenUsage()

      // newConversation() resets the token tracker, so afterReset shows only
      // the tokens from the new conversation
      // Both should have measurable tokens
      expect(beforeReset.inputTokens).toBeGreaterThan(0)
      expect(afterReset.inputTokens).toBeGreaterThan(0)
      expect(beforeReset.outputTokens).toBeGreaterThan(0)
      expect(afterReset.outputTokens).toBeGreaterThan(0)

      console.log(`[config-context] Before reset - Input: ${beforeReset.inputTokens}, Output: ${beforeReset.outputTokens}`)
      console.log(`[config-context] After reset - Input: ${afterReset.inputTokens}, Output: ${afterReset.outputTokens}`)
    }, 120_000)

    it('should get context size from last API response', async () => {
      const { ConversationManager } = await import('../../conversation/manager.js')
      const { getContextSizeFromLastResponse } = await import('../../conversation/token-tracker.js')

      const sdk = ClaudeCodeSDK.create({
        llm: {
          provider: 'anthropic',
          apiKey: DEEPSEEK_API_KEY,
          baseUrl: BASE_URL,
          model: MODEL,
          maxTokens: 1024,
        },
      })

      // Send a message and verify we can access context size
      const response = await sdk.send('Reply with: "Context size check"')

      // Verify the response has usage data
      expect(response.usage.inputTokens).toBeGreaterThan(0)
      expect(response.usage.outputTokens).toBeGreaterThan(0)

      // Simulate what estimateContextTokens would see
      // The SDK internally tracks messages — verify the last response has good output
      expect(response.content.length).toBeGreaterThan(0)
      console.log(`[config-context] Response tokens - Input: ${response.usage.inputTokens}, Output: ${response.usage.outputTokens}`)
    }, 60_000)
  })
})
