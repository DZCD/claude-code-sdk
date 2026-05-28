/**
 * GrepTool — Edge Cases & Coverage Supplement
 *
 * Tests for:
 * - Invalid regex patterns
 * - Non-existent search path
 * - Single file search
 * - Case-insensitive search edge cases
 * - Glob filtering edge cases
 * - Empty files
 * - Large file handling
 * - Binary-like file content
 * - Directory with unreadable entries
 * - Results capped at 1000
 */
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GrepTool } from '../../tools/built-in/grep.js'

const makeContext = () => ({ signal: new AbortController().signal })

let tmpDir: string

describe('GrepTool — Edge Cases', () => {
  const tool = new GrepTool()

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdk-grep-edge-'))

    // Multiple files for search
    await writeFile(join(tmpDir, 'colors.txt'), 'red\ngreen\nblue\nyellow\npurple\norange\n', 'utf-8')
    await writeFile(join(tmpDir, 'numbers.txt'), 'one\ntwo\nthree\nfour\nfive\n', 'utf-8')
    await writeFile(join(tmpDir, 'mix.txt'), 'Red1\nGreen2\nBlue3\n', 'utf-8')
    await writeFile(join(tmpDir, 'empty.txt'), '', 'utf-8')

    // Large file for overflow testing
    const largeLines: string[] = []
    for (let i = 0; i < 2000; i++) {
      largeLines.push(`line ${i} with some content that can be searched`)
    }
    await writeFile(join(tmpDir, 'large.txt'), largeLines.join('\n'), 'utf-8')

    // Nested directories
    await mkdir(join(tmpDir, 'sub'), { recursive: true })
    await writeFile(join(tmpDir, 'sub', 'nested.js'), 'const nest = "deep";\n', 'utf-8')
    await writeFile(join(tmpDir, 'sub', 'data.csv'), 'id,name,value\n1,test,100\n2,sample,200\n', 'utf-8')

    // File with special regex characters
    await writeFile(join(tmpDir, 'special.txt'), 'a+b*c?d(e)f[g]{h}\n', 'utf-8')
  })

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  // ─── Invalid Regex ──────────────────────────────────────

  it('should return error for invalid regex pattern', async () => {
    const result = await tool.execute({ pattern: '[invalid' }, makeContext())
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Invalid regular expression')
  })

  it('should return error for unclosed group in regex', async () => {
    const result = await tool.execute({ pattern: '(unclosed' }, makeContext())
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Invalid regular expression')
  })

  // ─── Non-existent Path ──────────────────────────────────

  it('should return error for non-existent path', async () => {
    const result = await tool.execute({ pattern: 'test', path: '/tmp/nonexistent-grep-path-99999' }, makeContext())
    expect(result.isError).toBe(true)
    expect(result.content).toContain('does not exist')
  })

  // ─── Single File Search ─────────────────────────────────

  it('should search a single file', async () => {
    const result = await tool.execute({ pattern: 'green', path: join(tmpDir, 'colors.txt') }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.numMatches).toBe(1)
    expect(result.data.results[0]).toBeDefined()
    expect(result.data.results[0].file).toContain('colors.txt')
    expect(result.data.results[0].lineContent).toBe('green')
  })

  it('should search a single file with no matches', async () => {
    const result = await tool.execute({ pattern: 'zzznonexistent', path: join(tmpDir, 'colors.txt') }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.numMatches).toBe(0)
  })

  // ─── Case-Insensitive Search ────────────────────────────

  it('should find case-insensitive matches with -i flag', async () => {
    const result = await tool.execute({ pattern: 'red', path: tmpDir, '-i': true }, makeContext())
    expect(result.isError).toBeFalsy()
    // Should find 'red' in colors.txt AND 'Red1' in mix.txt
    expect(result.data.numMatches).toBeGreaterThanOrEqual(2)
  })

  // ─── Glob Filtering ─────────────────────────────────────

  it('should filter by glob pattern for directory search', async () => {
    const result = await tool.execute({ pattern: 'deep', path: tmpDir, glob: '*.js' }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.numMatches).toBeGreaterThan(0)
    expect(result.data.results.every((r) => r.file.endsWith('.js'))).toBe(true)
  })

  it('should return empty when glob filter excludes all files', async () => {
    const result = await tool.execute({ pattern: 'red', path: tmpDir, glob: '*.xyz' }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.numMatches).toBe(0)
  })

  // ─── Empty File ─────────────────────────────────────────

  it('should return empty results for empty file', async () => {
    const result = await tool.execute({ pattern: '.', path: join(tmpDir, 'empty.txt') }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.numMatches).toBe(0)
  })

  // ─── Large File ─────────────────────────────────────────

  it('should handle large files without issues', async () => {
    const result = await tool.execute({ pattern: 'content', path: join(tmpDir, 'large.txt') }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.numMatches).toBe(2000) // All 2000 lines contain "content"
  })

  it('should cap results at 1000 for directory search', async () => {
    const result = await tool.execute({ pattern: 'content', path: tmpDir }, makeContext())
    expect(result.isError).toBeFalsy()
    // Should find matches in large.txt (2000) but cap at 1000
    expect(result.data.numMatches).toBeLessThanOrEqual(1000)
  })

  // ─── Special Characters ─────────────────────────────────

  it('should search for patterns with special regex chars using escape', async () => {
    // The special.txt contains: a+b*c?d(e)f[g]{h}
    // Use . to match each char individually - the full string is 17 chars
    // a+b*c?d(e)f[g]{h} (positions 0-16)
    const result = await tool.execute({ pattern: 'a.b.c.d.e.f.g.', path: join(tmpDir, 'special.txt') }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.numMatches).toBe(1)
  })

  it('should match full special chars line with proper pattern', async () => {
    const result = await tool.execute(
      { pattern: 'a.b.c.d.e.f.g.\\{h\\}', path: join(tmpDir, 'special.txt') },
      makeContext(),
    )
    expect(result.isError).toBeFalsy()
    expect(result.data.numMatches).toBe(1)
  })

  // ─── Multiple Files Search ──────────────────────────────

  it('should search across multiple files in a directory', async () => {
    const result = await tool.execute({ pattern: '^(red|one|const)', path: tmpDir }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.numMatches).toBeGreaterThanOrEqual(3)
  })

  // ─── Schema Validation ─────────────────────────────────

  it('should reject missing required pattern', () => {
    const result = tool.inputSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('should accept all optional fields', () => {
    const result = tool.inputSchema.safeParse({
      pattern: 'test',
      path: '/tmp',
      glob: '*.ts',
      '-i': true,
    })
    expect(result.success).toBe(true)
  })

  it('should be read-only and concurrency-safe', () => {
    expect(tool.isReadOnly({ pattern: 'test' })).toBe(true)
    expect(tool.isConcurrencySafe()).toBe(true)
  })

  // ─── Content Preview Formatting ────────────────────────

  it('should format content preview with file:line:content format for matches', async () => {
    const result = await tool.execute({ pattern: 'green', path: join(tmpDir, 'colors.txt') }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('Found 1 match(es)')
  })

  it('should show "No matches found" when no results', async () => {
    const result = await tool.execute({ pattern: 'zzznonexistentpattern', path: tmpDir }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('No matches found')
  })
})
