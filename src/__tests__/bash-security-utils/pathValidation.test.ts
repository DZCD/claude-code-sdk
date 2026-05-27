/**
 * TDD Tests — bash-security-utils/pathValidation.ts
 *
 * Tests for path extraction, dangerous path detection, and path validation.
 */
import { describe, expect, it } from 'vitest'
import {
  checkDangerousRemovalPaths,
  expandTilde,
  extractPathsFromCommand,
  filterOutFlags,
  getGlobBaseDirectory,
  isDangerousRemovalPath,
} from '../../tools/built-in/bash-security-utils/pathValidation.js'

describe('pathValidation', () => {
  // ─── filterOutFlags ──────────────────────────────────
  describe('filterOutFlags', () => {
    it('should return positional args only', () => {
      expect(filterOutFlags(['-la', 'file.txt', '-n'])).toEqual(['file.txt'])
    })

    it('should handle -- end-of-options delimiter', () => {
      // Everything after -- is positional, even if it starts with -
      expect(filterOutFlags(['--', '-rf', 'target'])).toEqual(['-rf', 'target'])
    })

    it('should handle combined flags', () => {
      expect(filterOutFlags(['-abc', 'file1', '-d', 'file2'])).toEqual(['file1', 'file2'])
    })

    it('should return empty array for all flags', () => {
      expect(filterOutFlags(['-a', '-b', '-c'])).toEqual([])
    })

    it('should handle empty args', () => {
      expect(filterOutFlags([])).toEqual([])
    })
  })

  // ─── expandTilde ─────────────────────────────────────
  describe('expandTilde', () => {
    it('should expand ~ to home directory', () => {
      const expanded = expandTilde('~/test')
      expect(expanded).toContain('/test')
      expect(expanded.startsWith('/')).toBe(true)
    })

    it('should expand standalone ~', () => {
      const expanded = expandTilde('~')
      expect(expanded).toBeTruthy()
      expect(expanded.startsWith('/')).toBe(true)
    })

    it('should not modify paths without tilde', () => {
      expect(expandTilde('/tmp/test')).toBe('/tmp/test')
    })

    it('should not expand ~user patterns', () => {
      expect(expandTilde('~other/file')).toBe('~other/file')
    })
  })

  // ─── getGlobBaseDirectory ────────────────────────────
  describe('getGlobBaseDirectory', () => {
    it('should extract base directory from glob pattern', () => {
      expect(getGlobBaseDirectory('/path/to/*.txt')).toBe('/path/to')
    })

    it('should return path unchanged if no glob chars', () => {
      expect(getGlobBaseDirectory('/path/to/file.txt')).toBe('/path/to/file.txt')
    })
  })

  // ─── isDangerousRemovalPath ──────────────────────────
  describe('isDangerousRemovalPath', () => {
    it('should detect / as dangerous', () => {
      expect(isDangerousRemovalPath('/')).toBe(true)
    })

    it('should detect /etc as dangerous', () => {
      expect(isDangerousRemovalPath('/etc')).toBe(true)
    })

    it('should detect /bin as dangerous', () => {
      expect(isDangerousRemovalPath('/bin')).toBe(true)
    })

    it('should detect /usr as dangerous', () => {
      expect(isDangerousRemovalPath('/usr')).toBe(true)
    })

    it('should not detect /tmp as dangerous', () => {
      expect(isDangerousRemovalPath('/tmp')).toBe(false)
    })

    it('should not detect home dir as dangerous', () => {
      expect(isDangerousRemovalPath('/home/user')).toBe(false)
    })

    it('should detect system paths on macOS', () => {
      expect(isDangerousRemovalPath('/System')).toBe(true)
    })
  })

  // ─── checkDangerousRemovalPaths ──────────────────────
  describe('checkDangerousRemovalPaths', () => {
    it('should detect dangerous rm -rf /', () => {
      const result = checkDangerousRemovalPaths('rm', ['-rf', '/'], '/home/user')
      expect(result).not.toBeNull()
      expect(result?.behavior).toBe('ask')
    })

    it('should pass safe rm commands', () => {
      const result = checkDangerousRemovalPaths('rm', ['file.txt'], '/home/user')
      expect(result).toBeNull()
    })

    it('should detect rm -- /', () => {
      const result = checkDangerousRemovalPaths('rm', ['--', '/'], '/home/user')
      expect(result).not.toBeNull()
      expect(result?.behavior).toBe('ask')
    })
  })

  // ─── extractPathsFromCommand ─────────────────────────
  describe('extractPathsFromCommand', () => {
    it('should extract paths from cat command', () => {
      const paths = extractPathsFromCommand('cat file.txt /etc/hosts')
      expect(paths).toContain('file.txt')
      expect(paths).toContain('/etc/hosts')
    })

    it('should extract paths from ls command', () => {
      const paths = extractPathsFromCommand('ls -la /tmp /var/log')
      expect(paths).toContain('/tmp')
      expect(paths).toContain('/var/log')
    })

    it('should handle -- in rm command', () => {
      const paths = extractPathsFromCommand('rm -- -f file.txt')
      expect(paths).toContain('-f')
      expect(paths).toContain('file.txt')
    })

    it('should handle cd command', () => {
      const paths = extractPathsFromCommand('cd /tmp/test')
      expect(paths).toContain('/tmp/test')
    })

    it('should handle cd with no args', () => {
      const paths = extractPathsFromCommand('cd')
      expect(paths.length).toBeGreaterThanOrEqual(1)
    })

    it('should extract paths from mkdir command', () => {
      const paths = extractPathsFromCommand('mkdir -p /tmp/new/dir')
      expect(paths).toContain('/tmp/new/dir')
    })

    it('should extract paths from touch command', () => {
      const paths = extractPathsFromCommand('touch file1.txt file2.txt')
      expect(paths).toContain('file1.txt')
      expect(paths).toContain('file2.txt')
    })

    it('should extract paths from cp command', () => {
      const paths = extractPathsFromCommand('cp source.txt dest.txt')
      expect(paths).toContain('source.txt')
      expect(paths).toContain('dest.txt')
    })

    it('should extract paths from mv command', () => {
      const paths = extractPathsFromCommand('mv source.txt /tmp/dest.txt')
      expect(paths).toContain('source.txt')
      expect(paths).toContain('/tmp/dest.txt')
    })

    it('should extract paths from git command', () => {
      const paths = extractPathsFromCommand('git status')
      expect(paths).toContain('.')
    })

    it('should extract paths from find command', () => {
      const paths = extractPathsFromCommand('find /tmp -name "*.txt"')
      expect(paths).toContain('/tmp')
    })

    it('should extract paths from grep command', () => {
      const paths = extractPathsFromCommand('grep -r pattern /tmp')
      expect(paths).toContain('/tmp')
    })

    it('should return empty for unknown commands', () => {
      const paths = extractPathsFromCommand('echo hello world')
      expect(paths.length).toBe(0)
    })

    it('should handle sed -i commands', () => {
      const paths = extractPathsFromCommand("sed -i 's/foo/bar/g' file.txt")
      expect(paths).toContain('file.txt')
    })

    it('should handle simple commands without paths', () => {
      const paths = extractPathsFromCommand('echo hello')
      expect(paths).toEqual([])
    })
  })
})
