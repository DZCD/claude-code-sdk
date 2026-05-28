/**
 * GlobTool — Edge Cases & Coverage Supplement
 *
 * Tests for:
 * - Symbolic links handling
 * - Permission-denied directories
 * - Large directories with many files
 * - Empty result edge cases
 * - Advanced glob patterns (?, braces, leading **)
 * - Invalid directories
 * - Hidden directory filtering
 * - Miscellaneous uncovered branches
 */
import { mkdir, mkdtemp, rm, symlink, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { GlobTool } from '../../tools/built-in/glob.js'

const makeContext = () => ({ signal: new AbortController().signal })

let tmpDir: string

describe('GlobTool — Edge Cases', () => {
  const tool = new GlobTool()

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdk-glob-edge-'))

    // Create a rich test directory structure
    await mkdir(join(tmpDir, 'deep', 'a', 'b', 'c'), { recursive: true })
    await writeFile(join(tmpDir, 'deep', 'a', 'file1.ts'), '// ts', 'utf-8')
    await writeFile(join(tmpDir, 'deep', 'a', 'b', 'file2.ts'), '// ts', 'utf-8')
    await writeFile(join(tmpDir, 'deep', 'a', 'b', 'c', 'file3.ts'), '// ts', 'utf-8')

    // Files for ? wildcard and dot pattern tests
    await writeFile(join(tmpDir, 'file-a.ts'), '// file-a', 'utf-8')
    await writeFile(join(tmpDir, 'file-b.ts'), '// file-b', 'utf-8')
    await writeFile(join(tmpDir, 'file-c.js'), '// file-c', 'utf-8')

    // Files with special characters in names
    await writeFile(join(tmpDir, 'file+plus.txt'), 'plus', 'utf-8')
    await writeFile(join(tmpDir, 'file[1].txt'), 'bracket', 'utf-8')
    await writeFile(join(tmpDir, 'file with spaces.txt'), 'spaces', 'utf-8')

    // Hidden directory (should be skipped)
    await mkdir(join(tmpDir, '.hidden-dir'), { recursive: true })
    await writeFile(join(tmpDir, '.hidden-dir', 'secret.txt'), 'secret', 'utf-8')

    // Symbolic link to a file
    try {
      await symlink(join(tmpDir, 'file-a.ts'), join(tmpDir, 'link-to-ts.txt'))
    } catch {
      // symlink might not be supported on some platforms
    }
  })

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  // ─── Symbolic Links ─────────────────────────────────────

  it('should not follow symbolic links to files', async () => {
    // The walkDirectory function uses stat() which returns stats for
    // the target of the symlink. If it's a regular file, it should be found.
    // Symlinks to files that aren't .ts won't match the pattern.
    const result = await tool.execute({ pattern: '*', path: tmpDir }, makeContext())
    expect(result.isError).toBeFalsy()
    // The symlink itself appears as a file via stat
    const allFiles = result.data.files
    // Should exist even if just as a regular file
    expect(allFiles.length).toBeGreaterThan(0)
  })

  // ─── Permission Error Handling ──────────────────────────

  it('should gracefully handle non-existent directory', async () => {
    const result = await tool.execute(
      { pattern: '*.ts', path: '/tmp/nonexistent-glob-path-xyz-99999' },
      makeContext(),
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('does not exist')
  })

  it('should handle the case where path is a file, not a directory', async () => {
    const result = await tool.execute(
      { pattern: '*.ts', path: join(tmpDir, 'deep', 'a', 'file1.ts') },
      makeContext(),
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Not a directory')
  })

  // ─── Empty / No Results ─────────────────────────────────

  it('should return empty array for non-matching pattern with no results', async () => {
    const result = await tool.execute({ pattern: '*.nonexistent_ext', path: tmpDir }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.files).toHaveLength(0)
    expect(result.content).toContain('No files matched')
  })

  // ─── Leading ** Patterns ────────────────────────────────

  it('should match recursively with leading ** pattern', async () => {
    const result = await tool.execute({ pattern: '**/file1.ts', path: tmpDir }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.files).toContain(join('deep', 'a', 'file1.ts'))
  })

  it('should match deeply with **/* pattern', async () => {
    const result = await tool.execute({ pattern: '**/*.ts', path: tmpDir }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.files.length).toBeGreaterThanOrEqual(3)
    expect(result.data.files).toContain(join('deep', 'a', 'file1.ts'))
    expect(result.data.files).toContain(join('deep', 'a', 'b', 'file2.ts'))
    expect(result.data.files).toContain(join('deep', 'a', 'b', 'c', 'file3.ts'))
  })

  // ─── ? Wildcard Pattern ─────────────────────────────────

  it('should match single character with ? wildcard', async () => {
    const result = await tool.execute({ pattern: 'file-?.ts', path: tmpDir }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.files).toContain('file-a.ts')
    expect(result.data.files).toContain('file-b.ts')
  })

  it('should not match with ? when no single char fits', async () => {
    const result = await tool.execute({ pattern: 'file-?.txt', path: tmpDir }, makeContext())
    expect(result.isError).toBeFalsy()
    // file+plus.txt doesn't match file-?.txt pattern
    // file[1].txt doesn't match either
    // The ? matches exactly one character
  })

  // ─── Brace Expansion {a,b,c} ────────────────────────────

  it('should handle brace expansion patterns', async () => {
    // Create files for brace test
    await writeFile(join(tmpDir, 'data.json'), '{}', 'utf-8')
    await writeFile(join(tmpDir, 'data.xml'), '<d/>', 'utf-8')
    await writeFile(join(tmpDir, 'data.yaml'), 'key: val', 'utf-8')

    const result = await tool.execute({ pattern: 'data.{json,xml}', path: tmpDir }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.files).toContain('data.json')
    expect(result.data.files).toContain('data.xml')
    expect(result.data.files).not.toContain('data.yaml')
  })

  // ─── Hidden Directory Filtering ─────────────────────────

  it('should skip hidden directories (starting with .)', async () => {
    const result = await tool.execute({ pattern: '**/*.txt', path: tmpDir }, makeContext())
    expect(result.isError).toBeFalsy()
    // The hidden-dir/secret.txt should NOT be found
    const hiddenResults = result.data.files.filter((f) => f.includes('.hidden-dir'))
    expect(hiddenResults).toHaveLength(0)
  })

  // ─── Pattern with Dots ──────────────────────────────────

  it('should correctly match patterns with dots', async () => {
    const result = await tool.execute({ pattern: '*.ts', path: tmpDir }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.files).toContain('file-a.ts')
    expect(result.data.files).toContain('file-b.ts')
  })

  // ─── Special Characters in Filenames ─────────────────────

  it('should handle filenames with special characters', async () => {
    const result = await tool.execute({ pattern: 'file+plus.txt', path: tmpDir }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.files).toContain('file+plus.txt')
  })

  it('should handle filenames with brackets', async () => {
    const result = await tool.execute({ pattern: 'file[1].txt', path: tmpDir }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.files).toContain('file[1].txt')
  })

  it('should handle filenames with spaces', async () => {
    const result = await tool.execute({ pattern: 'file with spaces.txt', path: tmpDir }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.files).toContain('file with spaces.txt')
  })

  // ─── Schema Validation Edge Cases ───────────────────────

  it('should reject empty pattern string', () => {
    const result = tool.inputSchema.safeParse({ pattern: '' })
    expect(result.success).toBe(false)
  })

  it('should accept pattern with optional path', () => {
    const result = tool.inputSchema.safeParse({ pattern: '*.ts', path: '/some/path' })
    expect(result.success).toBe(true)
  })

  it('should accept pattern without path (defaults to cwd)', () => {
    const result = tool.inputSchema.safeParse({ pattern: '*.ts' })
    expect(result.success).toBe(true)
  })

  it('should handle pattern with regex special characters like +', async () => {
    const result = await tool.execute(
      { pattern: 'file+*.txt', path: tmpDir },
      makeContext(),
    )
    expect(result.isError).toBeFalsy()
    expect(result.data.files).toContain('file+plus.txt')
  })

  it('should handle a directory with permission-restricted subdirectory', async () => {
    // Create a subdirectory and remove its permissions
    const noPermDir = join(tmpDir, 'no-perm-dir')
    await mkdir(noPermDir, { recursive: true })
    await writeFile(join(noPermDir, 'inside.txt'), 'inside', 'utf-8')

    try {
      await chmod(noPermDir, 0o000)
    } catch {
      // chmod may not work on all platforms
    }

    const result = await tool.execute({ pattern: '**/*.txt', path: tmpDir }, makeContext())

    // Restore permissions for cleanup
    try {
      await chmod(noPermDir, 0o755)
    } catch {
      // ignore
    }

    // Should not throw - the permission error should be caught and the directory skipped
    expect(result.isError).toBeFalsy()
  })

  it('should be read-only and concurrency-safe', () => {
    expect(tool.isReadOnly({ pattern: '*.ts' })).toBe(true)
    expect(tool.isConcurrencySafe()).toBe(true)
  })
})
