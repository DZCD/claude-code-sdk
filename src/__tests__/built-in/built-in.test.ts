import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
/**
 * Built-in Tools — TDD Tests
 *
 * Tests for all 8 built-in tools: BashTool, FileReadTool, FileWriteTool,
 * FileEditTool, GlobTool, GrepTool, WebFetchTool, WebSearchTool.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createTool } from '../../tools/base.js'
import { BashTool } from '../../tools/built-in/bash.js'
import { FileEditTool } from '../../tools/built-in/file_edit.js'
import { FileReadTool } from '../../tools/built-in/file_read.js'
import { FileWriteTool } from '../../tools/built-in/file_write.js'
import { GlobTool } from '../../tools/built-in/glob.js'
import { GrepTool } from '../../tools/built-in/grep.js'
import { WebFetchTool } from '../../tools/built-in/web_fetch.js'
import { WebSearchTool } from '../../tools/built-in/web_search.js'
import { ToolRegistry } from '../../tools/registry.js'

// ─── Test Fixtures ───────────────────────────────────────

const makeContext = () => ({
  signal: new AbortController().signal,
})

let tmpDir: string
let testFilePath: string

// ─── BashTool Tests ──────────────────────────────────────

describe('BashTool', () => {
  const tool = new BashTool()

  it('should have correct metadata', () => {
    expect(tool.name).toBe('bash')
    expect(tool.description).toBeTruthy()
    expect(tool.inputSchema).toBeDefined()
  })

  it('should execute a simple echo command', async () => {
    const result = await tool.execute({ command: 'echo hello world' }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('hello world')
    expect(result.data).toBeDefined()
  })

  it('should capture stderr output', async () => {
    const result = await tool.execute({ command: 'echo "error msg" >&2' }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.stderr).toContain('error msg')
  })

  it('should return non-zero exit code as error', async () => {
    const result = await tool.execute({ command: 'exit 1' }, makeContext())
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Exit code 1')
  })

  it('should accept optional timeout parameter', async () => {
    const result = await tool.execute({ command: 'echo quick', timeout: 5000 }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('quick')
  })

  it('should report read-only status correctly', () => {
    expect(tool.isReadOnly({ command: 'ls -la' })).toBe(true)
    expect(tool.isReadOnly({ command: 'cat file.txt' })).toBe(true)
    expect(tool.isReadOnly({ command: 'rm file.txt' })).toBe(false)
    expect(tool.isReadOnly({ command: 'echo test' })).toBe(false)
  })

  it('should be concurrency-safe when read-only', () => {
    // isConcurrencySafe returns false by default (from BaseTool)
    expect(tool.isConcurrencySafe()).toBe(false)
  })

  it('should reject empty command via schema', () => {
    const result = tool.inputSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('should reject non-string command', () => {
    const result = tool.inputSchema.safeParse({ command: 123 })
    expect(result.success).toBe(false)
  })
})

// ─── FileReadTool Tests ──────────────────────────────────

describe('FileReadTool', () => {
  const tool = new FileReadTool()

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdk-test-'))
    testFilePath = join(tmpDir, 'test-file.txt')
    await writeFile(testFilePath, 'line 1\nline 2\nline 3\nline 4\nline 5\n')
  })

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('should have correct metadata', () => {
    expect(tool.name).toBe('read')
    expect(tool.description).toBeTruthy()
    expect(tool.inputSchema).toBeDefined()
  })

  it('should read a file and return its content', async () => {
    const result = await tool.execute({ file_path: testFilePath }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.content).toContain('line 1')
    expect(result.data.content).toContain('line 5')
    expect(result.data.totalLines).toBe(5)
  })

  it('should read with offset and limit parameters', async () => {
    const result = await tool.execute({ file_path: testFilePath, offset: 2, limit: 2 }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.content).toContain('line 2')
    expect(result.data.content).toContain('line 3')
    expect(result.data.content).not.toContain('line 1')
    expect(result.data.numLines).toBe(2)
  })

  it('should return error for non-existent file', async () => {
    const result = await tool.execute({ file_path: '/tmp/nonexistent-file-xyz-123.txt' }, makeContext())
    expect(result.isError).toBe(true)
    expect(result.content).toContain('does not exist')
  })

  it('should read 0-line file', async () => {
    const emptyFile = join(tmpDir, 'empty.txt')
    await writeFile(emptyFile, '', 'utf-8')
    const result = await tool.execute({ file_path: emptyFile }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.content).toBe('')
    expect(result.data.totalLines).toBe(0)
  })

  it('should be read-only', () => {
    expect(tool.isReadOnly({ file_path: '/tmp/test.txt' })).toBe(true)
  })

  it('should be concurrency-safe', () => {
    expect(tool.isConcurrencySafe()).toBe(true)
  })

  it('should reject missing file_path', () => {
    const result = tool.inputSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('should reject non-string file_path', () => {
    const result = tool.inputSchema.safeParse({ file_path: 123 })
    expect(result.success).toBe(false)
  })
})

// ─── FileWriteTool Tests ─────────────────────────────────

describe('FileWriteTool', () => {
  const tool = new FileWriteTool()

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdk-test-'))
  })

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('should have correct metadata', () => {
    expect(tool.name).toBe('write')
    expect(tool.description).toBeTruthy()
    expect(tool.inputSchema).toBeDefined()
  })

  it('should create a new file', async () => {
    const filePath = join(tmpDir, 'new-file.txt')
    const result = await tool.execute({ file_path: filePath, content: 'hello world' }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.type).toBe('create')
    expect(result.data.filePath).toBe(filePath)
  })

  it('should overwrite an existing file', async () => {
    const filePath = join(tmpDir, 'overwrite.txt')
    await writeFile(filePath, 'original content', 'utf-8')
    const result = await tool.execute({ file_path: filePath, content: 'updated content' }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.type).toBe('update')
  })

  it('should handle multiline content', async () => {
    const filePath = join(tmpDir, 'multiline.txt')
    const content = 'line 1\nline 2\nline 3'
    const result = await tool.execute({ file_path: filePath, content }, makeContext())
    expect(result.isError).toBeFalsy()
    const readResult = await new FileReadTool().execute({ file_path: filePath }, makeContext())
    expect(readResult.data.content).toBe(content)
  })

  it('should return error for missing required fields', () => {
    const result = tool.inputSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('should validate file_path is a string', () => {
    const result = tool.inputSchema.safeParse({
      file_path: 123,
      content: 'test',
    })
    expect(result.success).toBe(false)
  })

  it('should not be read-only', () => {
    expect(tool.isReadOnly({ file_path: '/tmp/t.txt', content: 'test' })).toBe(false)
  })
})

// ─── FileEditTool Tests ──────────────────────────────────

describe('FileEditTool', () => {
  const tool = new FileEditTool()

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdk-test-'))
    testFilePath = join(tmpDir, 'edit-test.txt')
    await writeFile(testFilePath, 'line 1\nline 2\nline 3\n', 'utf-8')
  })

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('should have correct metadata', () => {
    expect(tool.name).toBe('edit')
    expect(tool.description).toBeTruthy()
    expect(tool.inputSchema).toBeDefined()
  })

  it('should replace old_string with new_string', async () => {
    const result = await tool.execute(
      {
        file_path: testFilePath,
        old_string: 'line 2',
        new_string: 'line two',
      },
      makeContext(),
    )
    expect(result.isError).toBeFalsy()
    expect(result.data.type).toBe('update')
  })

  it('should insert content at the end with empty old_string', async () => {
    const filePath = join(tmpDir, 'append-test.txt')
    await writeFile(filePath, 'existing\ncontent\n', 'utf-8')
    const result = await tool.execute(
      {
        file_path: filePath,
        old_string: '',
        new_string: 'appended line\n',
      },
      makeContext(),
    )
    expect(result.isError).toBeFalsy()
    const readResult = await new FileReadTool().execute({ file_path: filePath }, makeContext())
    expect(readResult.data.content).toContain('appended line')
  })

  it('should return error for non-existent file', async () => {
    const result = await tool.execute(
      {
        file_path: '/tmp/nonexistent-edit-test-123.txt',
        old_string: 'hello',
        new_string: 'world',
      },
      makeContext(),
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('does not exist')
  })

  it('should return error when old_string not found', async () => {
    const result = await tool.execute(
      {
        file_path: testFilePath,
        old_string: 'this string does not exist in the file at all',
        new_string: 'replacement',
      },
      makeContext(),
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('not found')
  })

  it('should return error for missing required fields', () => {
    const result = tool.inputSchema.safeParse({ file_path: '/tmp/t.txt' })
    expect(result.success).toBe(false)
  })

  it('should not be read-only', () => {
    expect(
      tool.isReadOnly({
        file_path: '/tmp/t.txt',
        old_string: 'a',
        new_string: 'b',
      }),
    ).toBe(false)
  })
})

// ─── GlobTool Tests ──────────────────────────────────────

describe('GlobTool', () => {
  const tool = new GlobTool()

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdk-test-'))
    await writeFile(join(tmpDir, 'file-a.ts'), '// a', 'utf-8')
    await writeFile(join(tmpDir, 'file-b.ts'), '// b', 'utf-8')
    await writeFile(join(tmpDir, 'file-c.js'), '// c', 'utf-8')
    await mkdir(join(tmpDir, 'subdir'), { recursive: true })
    await writeFile(join(tmpDir, 'subdir', 'nested.ts'), '// nested', 'utf-8')
  })

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('should have correct metadata', () => {
    expect(tool.name).toBe('glob')
    expect(tool.description).toBeTruthy()
    expect(tool.inputSchema).toBeDefined()
  })

  it('should find files matching a simple pattern', async () => {
    const result = await tool.execute({ pattern: '*.ts', path: tmpDir }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.files).toContain('file-a.ts')
    expect(result.data.files).toContain('file-b.ts')
    expect(result.data.files).not.toContain('file-c.js')
  })

  it('should find files in subdirectories with ** pattern', async () => {
    const result = await tool.execute({ pattern: '**/*.ts', path: tmpDir }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.files).toContain('file-a.ts')
    expect(result.data.files).toContain(join('subdir', 'nested.ts'))
  })

  it('should return empty array for non-matching pattern', async () => {
    const result = await tool.execute({ pattern: '*.xyz', path: tmpDir }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.files).toHaveLength(0)
  })

  it('should work without path (use cwd)', async () => {
    const result = tool.inputSchema.safeParse({ pattern: '*.ts' })
    expect(result.success).toBe(true)
  })

  it('should reject missing pattern', () => {
    const result = tool.inputSchema.safeParse({ path: '/tmp' })
    expect(result.success).toBe(false)
  })

  it('should be read-only', () => {
    expect(tool.isReadOnly({ pattern: '*.ts' })).toBe(true)
  })
})

// ─── GrepTool Tests ──────────────────────────────────────

describe('GrepTool', () => {
  const tool = new GrepTool()

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdk-test-'))
    await writeFile(join(tmpDir, 'search.txt'), 'apple\nbanana\ncherry\ndate\nApple\n', 'utf-8')
    await writeFile(join(tmpDir, 'code.ts'), 'const x = 1\n// banana\nfunction hello() {}\n', 'utf-8')
  })

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('should have correct metadata', () => {
    expect(tool.name).toBe('grep')
    expect(tool.description).toBeTruthy()
    expect(tool.inputSchema).toBeDefined()
  })

  it('should find matching lines in files', async () => {
    const result = await tool.execute({ pattern: 'banana', path: tmpDir }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.results.length).toBeGreaterThanOrEqual(1)
    expect(result.data.results.some((r) => r.lineContent?.includes('banana'))).toBe(true)
  })

  it('should support case-insensitive search', async () => {
    const result = await tool.execute({ pattern: 'apple', path: tmpDir, '-i': true }, makeContext())
    expect(result.isError).toBeFalsy()
    // Should match both 'apple' and 'Apple'
    const appleMatches = result.data.results.filter((r) => r.file.includes('search.txt'))
    expect(appleMatches.length).toBeGreaterThan(0)
  })

  it('should filter by glob pattern', async () => {
    const result = await tool.execute({ pattern: 'banana', path: tmpDir, glob: '*.ts' }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.results.length).toBeGreaterThan(0)
    expect(result.data.results.every((r) => r.file.endsWith('.ts'))).toBe(true)
  })

  it('should return empty results for non-matching pattern', async () => {
    const result = await tool.execute({ pattern: 'zzz_nonexistent_zzz', path: tmpDir }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.results).toHaveLength(0)
  })

  it('should reject missing pattern', () => {
    const result = tool.inputSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('should be read-only', () => {
    expect(tool.isReadOnly({ pattern: 'test' })).toBe(true)
  })
})

// ─── WebFetchTool Tests ──────────────────────────────────

describe('WebFetchTool', () => {
  const tool = new WebFetchTool()

  it('should have correct metadata', () => {
    expect(tool.name).toBe('web_fetch')
    expect(tool.description).toBeTruthy()
    expect(tool.inputSchema).toBeDefined()
  })

  it('should reject missing URL', () => {
    const result = tool.inputSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('should reject invalid URL', () => {
    const result = tool.inputSchema.safeParse({ url: 'not-a-url' })
    expect(result.success).toBe(false)
  })

  it('should reject empty string for maxChars', () => {
    // maxChars is optional, not providing it is fine
    const result = tool.inputSchema.safeParse({ url: 'https://example.com' })
    expect(result.success).toBe(true)
  })

  it('should fetch content from a real URL', async () => {
    const result = await tool.execute({ url: 'https://example.com' }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.content).toBeTruthy()
    expect(result.data.url).toBe('https://example.com')
    expect(typeof result.data.content).toBe('string')
  }, 15000)

  it('should respect maxChars parameter', async () => {
    const result = await tool.execute({ url: 'https://example.com', maxChars: 100 }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.content.length).toBeLessThanOrEqual(100)
  }, 15000)

  it('should return error for unreachable URL', async () => {
    const result = await tool.execute({ url: 'https://nonexistent-domain-xyz-123456.com/' }, makeContext())
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Error')
  }, 10000)

  it('should be read-only', () => {
    expect(tool.isReadOnly({ url: 'https://example.com' })).toBe(true)
  })
})

// ─── WebSearchTool Tests ─────────────────────────────────

/**
 * Generate fake DuckDuckGo HTML search results for testing.
 * DuckDuckGo's HTML endpoint now blocks automated requests with CAPTCHA,
 * so we mock the network layer to return controlled test data.
 */
function mockDuckDuckGoHTML(query: string): string {
  const encodedUrl = (url: string) => `https://duckduckgo.com/l/?uddg=${encodeURIComponent(url)}`
  return `<!DOCTYPE html>
<html>
<body>
<div class="results">
  <div class="result results_links results_links_deep">
    <a rel="nofollow" class="result__a" href="${encodedUrl('https://www.typescriptlang.org/')}">TypeScript - JavaScript With Syntax For Types</a>
    <a class="result__snippet">TypeScript extends JavaScript by adding types to the language.</a>
  </div>
  <div class="result results_links results_links_deep">
    <a rel="nofollow" class="result__a" href="${encodedUrl('https://github.com/microsoft/TypeScript')}">GitHub - microsoft/TypeScript: TypeScript is a superset of JavaScript</a>
    <a class="result__snippet">TypeScript is a language for application-scale JavaScript development.</a>
  </div>
  <div class="result results_links results_links_deep">
    <a rel="nofollow" class="result__a" href="${encodedUrl('https://www.typescriptlang.org/docs/')}">Documentation - TypeScript</a>
    <a class="result__snippet">Get started with TypeScript documentation and tutorials.</a>
  </div>
  <div class="result results_links results_links_deep">
    <a rel="nofollow" class="result__a" href="${encodedUrl('https://www.npmjs.com/package/typescript')}">typescript - npm</a>
    <a class="result__snippet">The TypeScript compiler and language service package.</a>
  </div>
  <div class="result results_links results_links_deep">
    <a rel="nofollow" class="result__a" href="${encodedUrl('https://www.youtube.com/results?search_query=typescript+tutorial')}">TypeScript Tutorial - YouTube</a>
    <a class="result__snippet">Learn TypeScript from beginner to advanced.</a>
  </div>
</div>
</body>
</html>`
}

describe('WebSearchTool', () => {
  const tool = new WebSearchTool()

  let originalFetch: typeof globalThis.fetch

  beforeAll(() => {
    originalFetch = globalThis.fetch
    // Mock fetch to intercept DuckDuckGo requests
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (urlStr.includes('html.duckduckgo.com/html/')) {
        const queryUrl = new URL(urlStr)
        const query = queryUrl.searchParams.get('q') || 'test'
        return new Response(mockDuckDuckGoHTML(query), {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=UTF-8' },
        })
      }
      // For non-DDG requests, use the real fetch
      return originalFetch(input, init)
    }) as unknown as typeof globalThis.fetch
  })

  afterAll(() => {
    globalThis.fetch = originalFetch
  })

  it('should have correct metadata', () => {
    expect(tool.name).toBe('web_search')
    expect(tool.description).toBeTruthy()
    expect(tool.inputSchema).toBeDefined()
  })

  it('should reject missing query', () => {
    const result = tool.inputSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('should reject too short query', () => {
    const result = tool.inputSchema.safeParse({ query: 'a' })
    expect(result.success).toBe(false)
  })

  it('should reject non-string query', () => {
    const result = tool.inputSchema.safeParse({ query: 123 })
    expect(result.success).toBe(false)
  })

  it('should search and return results', async () => {
    const result = await tool.execute({ query: 'TypeScript programming language' }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.query).toBe('TypeScript programming language')
    expect(result.data.results.length).toBeGreaterThan(0)
    expect(result.data.results[0].title).toBeTruthy()
    expect(result.data.results[0].url).toBeTruthy()
  }, 30000)

  it('should respect maxResults parameter', async () => {
    const result = await tool.execute({ query: 'node.js', maxResults: 3 }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.results.length).toBeLessThanOrEqual(3)
  }, 30000)

  it('should be read-only', () => {
    expect(tool.isReadOnly({ query: 'test' })).toBe(true)
  })
})

// ─── ToolRegistry Integration Tests ─────────────────────

describe('ToolRegistry with built-in tools', () => {
  it('should register all built-in tools', () => {
    const registry = new ToolRegistry()
    registry.register(
      new BashTool().toTool(),
      new FileReadTool().toTool(),
      new FileWriteTool().toTool(),
      new FileEditTool().toTool(),
      new GlobTool().toTool(),
      new GrepTool().toTool(),
      new WebFetchTool().toTool(),
      new WebSearchTool().toTool(),
    )
    expect(registry.size).toBe(8)
    expect(registry.has('bash')).toBe(true)
    expect(registry.has('read')).toBe(true)
    expect(registry.has('write')).toBe(true)
    expect(registry.has('edit')).toBe(true)
    expect(registry.has('glob')).toBe(true)
    expect(registry.has('grep')).toBe(true)
    expect(registry.has('web_fetch')).toBe(true)
    expect(registry.has('web_search')).toBe(true)
  })

  it('should execute tools through the registry', async () => {
    const registry = new ToolRegistry()
    registry.register(new BashTool().toTool())
    const result = await registry.execute('bash', { command: 'echo hello' }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('hello')
  })

  it('should validate input through the registry', async () => {
    const registry = new ToolRegistry()
    registry.register(new BashTool().toTool())
    const result = await registry.execute('bash', { wrong: 'field' }, makeContext())
    expect(result.isError).toBe(true)
  })
})

// ─── ToolRegistry Edge Cases ────────────────────────────

describe('ToolRegistry — Registration Edge Cases', () => {
  it('should throw when registering duplicate tool name', () => {
    const registry = new ToolRegistry()
    registry.register(new BashTool().toTool())
    expect(() => {
      registry.register(new BashTool().toTool())
    }).toThrow('already registered')
  })

  it('should throw with tool name in error message', () => {
    const registry = new ToolRegistry()
    registry.register(new BashTool().toTool())
    expect(() => {
      registry.register(new BashTool().toTool())
    }).toThrow('bash')
  })

  it('should handle registering and unregistering', () => {
    const registry = new ToolRegistry()
    registry.register(new BashTool().toTool())
    expect(registry.has('bash')).toBe(true)
    expect(registry.unregister('bash')).toBe(true)
    expect(registry.has('bash')).toBe(false)
  })

  it('should return false when unregistering non-existent tool', () => {
    const registry = new ToolRegistry()
    expect(registry.unregister('nonexistent_tool')).toBe(false)
  })

  it('should clear all registered tools', () => {
    const registry = new ToolRegistry()
    registry.register(new BashTool().toTool(), new FileReadTool().toTool(), new FileWriteTool().toTool())
    expect(registry.size).toBe(3)
    registry.clear()
    expect(registry.size).toBe(0)
    expect(registry.has('bash')).toBe(false)
  })

  it('should return frozen array from getTools', () => {
    const registry = new ToolRegistry()
    registry.register(new BashTool().toTool())
    const tools = registry.getTools()
    expect(Object.isFrozen(tools)).toBe(true)
  })

  it('should return undefined for non-existent tool', () => {
    const registry = new ToolRegistry()
    expect(registry.get('nonexistent')).toBeUndefined()
  })

  it('should handle empty registry sizes', () => {
    const registry = new ToolRegistry()
    expect(registry.size).toBe(0)
    expect(registry.getAll()).toHaveLength(0)
    expect(registry.getTools()).toHaveLength(0)
  })

  it('should get single tool by name', () => {
    const registry = new ToolRegistry()
    const bashTool = new BashTool().toTool()
    registry.register(bashTool)
    const retrieved = registry.get('bash')
    expect(retrieved).toBeDefined()
    expect(retrieved!.name).toBe('bash')
  })

  it('should execute tool and return error for invalid input via schema', async () => {
    const registry = new ToolRegistry()
    registry.register(new BashTool().toTool())
    const result = await registry.execute('bash', { wrong: 'field' }, makeContext())
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Error')
  })

  it('should return error for unknown tool name', async () => {
    const registry = new ToolRegistry()
    const result = await registry.execute('unknown_tool', {}, makeContext())
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Unknown tool')
  })

  it('should handle execute errors gracefully', async () => {
    const registry = new ToolRegistry()
    // Create a tool that throws during execute
    const throwingTool = createTool({
      name: 'thrower',
      description: 'A tool that throws errors',
      inputSchema: z.object({}),
      async execute() {
        throw new Error('Intentional test error')
      },
    })
    registry.register(throwingTool)
    const result = await registry.execute('thrower', {}, makeContext())
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Error executing tool')
  })
})

// ─── Built-in Index Export Tests ─────────────────────────

describe('built-in index exports', () => {
  it('should export all tools from index', async () => {
    const builtIn = await import('../../tools/built-in/index.js')
    expect(builtIn.BashTool).toBeDefined()
    expect(builtIn.FileReadTool).toBeDefined()
    expect(builtIn.FileWriteTool).toBeDefined()
    expect(builtIn.FileEditTool).toBeDefined()
    expect(builtIn.GlobTool).toBeDefined()
    expect(builtIn.GrepTool).toBeDefined()
    expect(builtIn.WebFetchTool).toBeDefined()
    expect(builtIn.WebSearchTool).toBeDefined()
  })
})
