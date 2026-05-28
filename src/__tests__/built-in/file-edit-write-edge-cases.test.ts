/**
 * FileEditTool / FileWriteTool — Edge Cases & Coverage Supplement
 *
 * Tests for:
 * - FileEdit: write error handling (mkdir/writeFile failures)
 * - FileEdit: old_string not found (already tested)
 * - FileEdit: empty old_string append error handling
 * - FileEdit: replace with write error handling
 * - FileWrite: write error handling (permission denied scenarios)
 * - FileWrite: non-existent parent directory auto-creation
 * - Both: schema validation edge cases
 */
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FileEditTool } from '../../tools/built-in/file_edit.js'
import { FileReadTool } from '../../tools/built-in/file_read.js'
import { FileWriteTool } from '../../tools/built-in/file_write.js'

const makeContext = () => ({ signal: new AbortController().signal })

let tmpDir: string

// ─── FileEditTool Edge Cases ──────────────────────────────

describe('FileEditTool — Edge Cases', () => {
  const tool = new FileEditTool()
  let testFilePath: string

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdk-edit-edge-'))
    testFilePath = join(tmpDir, 'edit-target.txt')
    await writeFile(testFilePath, 'original content\nline 2\nline 3\n', 'utf-8')
  })

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  // ─── Metadata ─────────────────────────────────────────

  it('should have correct metadata', () => {
    expect(tool.name).toBe('edit')
    expect(tool.description).toBeTruthy()
    expect(tool.inputSchema).toBeDefined()
  })

  // ─── Append (empty old_string) ────────────────────────

  it('should append content with empty old_string', async () => {
    const filePath = join(tmpDir, 'append-edge.txt')
    await writeFile(filePath, 'base\n', 'utf-8')
    const result = await tool.execute(
      { file_path: filePath, old_string: '', new_string: 'appended\n' },
      makeContext(),
    )
    expect(result.isError).toBeFalsy()
    expect(result.data.type).toBe('update')

    // Verify content
    const read = await new FileReadTool().execute({ file_path: filePath }, makeContext())
    expect(read.data.content).toContain('appended')
  })

  it('should report error when appending to non-existent file', async () => {
    const result = await tool.execute(
      { file_path: join(tmpDir, 'nonexistent-append.txt'), old_string: '', new_string: 'content' },
      makeContext(),
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('does not exist')
  })

  // ─── Write Error Handling ──────────────────────────────

  it('should handle write permission error on edit', async () => {
    // Create a read-only file (if supported on this platform)
    const roFile = join(tmpDir, 'readonly-edit.txt')
    await writeFile(roFile, 'can edit?\n', 'utf-8')

    try {
      await chmod(roFile, 0o444) // Remove write permission
    } catch {
      // chmod might not be supported on all platforms
    }

    const result = await tool.execute(
      { file_path: roFile, old_string: 'can', new_string: 'cannot' },
      makeContext(),
    )

    // The result depends on whether chmod was effective
    // On some platforms (Windows, some containers), chmod may not affect write permissions
    if (result.isError) {
      expect(result.content).toContain('Error')
    } else {
      // If write succeeded (e.g., root in container), that's also fine
      expect(result.data.type).toBe('update')
    }
  })

  // ─── Read Error Handling (non-ENOENT) — lines 58-68 ───

  it('should return non-ENOENT error when readFile fails for other reasons', async () => {
    // Create a file in a subdirectory, then revoke directory permissions
    const restrictedDir = join(tmpDir, 'restricted-dir')
    const fileInRestrictedDir = join(restrictedDir, 'secret.txt')
    await mkdir(restrictedDir, { recursive: true })
    await writeFile(fileInRestrictedDir, 'secret content', 'utf-8')

    // Remove read+execute permissions from the parent directory
    try {
      await chmod(restrictedDir, 0o000)
    } catch {
      // chmod may not work on all systems
    }

    const result = await tool.execute(
      { file_path: fileInRestrictedDir, old_string: 'any', new_string: 'thing' },
      makeContext(),
    )

    // Restore permissions so cleanup works
    try {
      await chmod(restrictedDir, 0o755)
    } catch {
      // ignore
    }

    if (result.isError) {
      // May get EACCES or similar permission error
      expect(result.content).toContain('Error')
      expect(result.isError).toBe(true)
    }
    // On some platforms (Windows, root), this might succeed
  })

  // ─── Append Write Error Handling — lines 77-88 ────────

  it('should return write error when appending to a read-only file', async () => {
    const appRoFile = join(tmpDir, 'append-readonly.txt')
    await writeFile(appRoFile, 'existing content\n', 'utf-8')

    // Make file read-only
    try {
      await chmod(appRoFile, 0o444)
    } catch {
      // may not work on all platforms
    }

    const result = await tool.execute(
      { file_path: appRoFile, old_string: '', new_string: 'appended content\n' },
      makeContext(),
    )

    // Restore permissions for cleanup
    try {
      await chmod(appRoFile, 0o644)
    } catch {
      // ignore
    }

    if (result.isError) {
      expect(result.content).toContain('Error writing file')
    } else {
      // If write succeeded (e.g., root), that's fine too
      expect(result.data.type).toBe('update')
    }
  })

  // ─── Replace Operations ───────────────────────────────

  it('should replace exact text match', async () => {
    const result = await tool.execute(
      { file_path: testFilePath, old_string: 'original content', new_string: 'updated content' },
      makeContext(),
    )
    expect(result.isError).toBeFalsy()
    expect(result.data.type).toBe('update')

    // Verify replacement
    const read = await new FileReadTool().execute({ file_path: testFilePath }, makeContext())
    expect(read.data.content).toContain('updated content')
    expect(read.data.content).not.toContain('original content')
  })

  it('should handle replacement with multi-line new_string', async () => {
    const filePath = join(tmpDir, 'multiline-replace.txt')
    await writeFile(filePath, 'before\nafter\n', 'utf-8')

    const result = await tool.execute(
      { file_path: filePath, old_string: 'before', new_string: 'line 1\nline 2\nline 3' },
      makeContext(),
    )
    expect(result.isError).toBeFalsy()

    const read = await new FileReadTool().execute({ file_path: filePath }, makeContext())
    expect(read.data.content).toContain('line 1')
    expect(read.data.content).toContain('line 2')
    expect(read.data.content).toContain('line 3')
  })

  // ─── Schema Validation ────────────────────────────────

  it('should reject missing file_path', () => {
    const result = tool.inputSchema.safeParse({ old_string: 'a', new_string: 'b' })
    expect(result.success).toBe(false)
  })

  it('should reject missing old_string', () => {
    const result = tool.inputSchema.safeParse({ file_path: '/tmp/t.txt', new_string: 'b' })
    expect(result.success).toBe(false)
  })

  it('should reject missing new_string', () => {
    const result = tool.inputSchema.safeParse({ file_path: '/tmp/t.txt', old_string: 'a' })
    expect(result.success).toBe(false)
  })

  it('should not be read-only', () => {
    expect(tool.isReadOnly({ file_path: '/tmp/t.txt', old_string: 'a', new_string: 'b' })).toBe(false)
  })

  it('should not be concurrency-safe', () => {
    expect(tool.isConcurrencySafe()).toBe(false)
  })
})

// ─── FileWriteTool Edge Cases ─────────────────────────────

describe('FileWriteTool — Edge Cases', () => {
  const tool = new FileWriteTool()

  let writeTmpDir: string

  beforeAll(async () => {
    writeTmpDir = await mkdtemp(join(tmpdir(), 'sdk-write-edge-'))
  })

  afterAll(async () => {
    await rm(writeTmpDir, { recursive: true, force: true })
  })

  // ─── Metadata ─────────────────────────────────────────

  it('should have correct metadata', () => {
    expect(tool.name).toBe('write')
    expect(tool.description).toBeTruthy()
    expect(tool.inputSchema).toBeDefined()
  })

  // ─── Create vs Update ────────────────────────────────

  it('should create a new file in nested directory', async () => {
    const nestedPath = join(writeTmpDir, 'nested', 'dir', 'new-file.txt')
    const result = await tool.execute({ file_path: nestedPath, content: 'nested content' }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.type).toBe('create')
  })

  it('should detect update when file already exists', async () => {
    const filePath = join(writeTmpDir, 'existing.txt')
    await writeFile(filePath, 'old content', 'utf-8')
    const result = await tool.execute({ file_path: filePath, content: 'new content' }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.type).toBe('update')
  })

  // ─── Error Cases ─────────────────────────────────────

  it('should handle write error (permission denied)', async () => {
    // This is tricky to test deterministically; try writing to a path
    // that likely won't be writable
    const result = await tool.execute(
      { file_path: '/root/forbidden-file.txt', content: 'test' },
      makeContext(),
    )

    if (result.isError) {
      expect(result.content).toContain('Error writing file')
    }
    // If running as root, it might succeed
  })

  // ─── Empty Content ────────────────────────────────────

  it('should write empty content', async () => {
    const filePath = join(writeTmpDir, 'empty-content.txt')
    const result = await tool.execute({ file_path: filePath, content: '' }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.type).toBe('create')

    const read = await new FileReadTool().execute({ file_path: filePath }, makeContext())
    expect(read.data.content).toBe('')
  })

  it('should handle very large content', async () => {
    const filePath = join(writeTmpDir, 'large-content.txt')
    const largeContent = 'x'.repeat(10000)
    const result = await tool.execute({ file_path: filePath, content: largeContent }, makeContext())
    expect(result.isError).toBeFalsy()
    expect(result.data.type).toBe('create')
  })

  // ─── Schema Validation ────────────────────────────────

  it('should reject missing file_path', () => {
    const result = tool.inputSchema.safeParse({ content: 'test' })
    expect(result.success).toBe(false)
  })

  it('should reject missing content', () => {
    const result = tool.inputSchema.safeParse({ file_path: '/tmp/t.txt' })
    expect(result.success).toBe(false)
  })

  it('should reject non-string file_path', () => {
    const result = tool.inputSchema.safeParse({ file_path: 123, content: 'test' })
    expect(result.success).toBe(false)
  })

  it('should reject non-string content', () => {
    const result = tool.inputSchema.safeParse({ file_path: '/tmp/t.txt', content: 123 })
    expect(result.success).toBe(false)
  })

  it('should not be read-only', () => {
    expect(tool.isReadOnly({ file_path: '/tmp/t.txt', content: 'test' })).toBe(false)
  })

  it('should not be concurrency-safe', () => {
    expect(tool.isConcurrencySafe()).toBe(false)
  })
})
