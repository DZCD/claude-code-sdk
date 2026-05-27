/**
 * Tests for path validation rules.
 *
 * Phase 2-G: Implements sandbox constraints, directory whitelists,
 * sensitive path protection, glob pattern validation.
 */
import { describe, it, expect } from 'vitest'
import {
  validatePath,
  isPathAllowed,
  isDangerousRemovalPath,
  expandTilde,
  getGlobBaseDirectory,
  SENSITIVE_PATHS,
} from '../permission/pathValidation.js'
import type { PathValidationOptions } from '../types/permission.js'

const defaultOptions: PathValidationOptions = {
  allowedDirectories: ['/home/user/project'],
  denyWithinAllow: [],
  enableSensitivePathProtection: true,
}

describe('pathValidation', () => {
  describe('validatePath', () => {
    it('should allow paths within working directory', () => {
      const result = validatePath(
        '/home/user/project/src/file.ts',
        '/home/user/project',
        defaultOptions,
        'read',
      )
      expect(result.allowed).toBe(true)
    })

    it('should deny paths outside working directory', () => {
      const result = validatePath(
        '/etc/passwd',
        '/home/user/project',
        defaultOptions,
        'read',
      )
      expect(result.allowed).toBe(false)
    })

    it('should deny sensitive paths when protection enabled', () => {
      const result = validatePath(
        '/home/user/project/.env',
        '/home/user/project',
        defaultOptions,
        'read',
      )
      expect(result.allowed).toBe(false)
    })

    it('should deny sensitive SSH paths', () => {
      const result = validatePath(
        '/home/user/.ssh/id_rsa',
        '/home/user/project',
        defaultOptions,
        'read',
      )
      expect(result.allowed).toBe(false)
    })

    it('should handle relative paths', () => {
      const result = validatePath(
        'src/file.ts',
        '/home/user/project',
        defaultOptions,
        'read',
      )
      expect(result.allowed).toBe(true)
      expect(result.resolvedPath).toContain('/home/user/project/src/file.ts')
    })

    it('should block glob patterns in write operations', () => {
      const result = validatePath(
        '/home/user/project/src/*.ts',
        '/home/user/project',
        defaultOptions,
        'write',
      )
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('Glob pattern')
    })

    it('should allow glob patterns for read operations if base dir is allowed', () => {
      const result = validatePath(
        '/home/user/project/src/*.ts',
        '/home/user/project',
        defaultOptions,
        'read',
      )
      expect(result.allowed).toBe(true)
    })

    it('should deny glob patterns for read if base dir is outside allowed', () => {
      const result = validatePath(
        '/etc/*.conf',
        '/home/user/project',
        defaultOptions,
        'read',
      )
      expect(result.allowed).toBe(false)
    })

    it('should block paths with shell expansion syntax', () => {
      const result = validatePath(
        '/home/user/project/$HOME/file.txt',
        '/home/user/project',
        defaultOptions,
        'read',
      )
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('Shell expansion')
    })

    it('should block tilde expansion variants', () => {
      const result = validatePath(
        '~root/.ssh/id_rsa',
        '/home/user/project',
        defaultOptions,
        'read',
      )
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('Tilde expansion')
    })

    it('should expand simple tilde to home directory', () => {
      const result = validatePath(
        '~/project/file.txt',
        '/home/user/project',
        { ...defaultOptions, allowedDirectories: [require('os').homedir() + '/project'] },
        'read',
      )
      expect(result.allowed).toBe(true)
    })

    it('should provide resolved path in result', () => {
      const result = validatePath(
        'src/file.ts',
        '/home/user/project',
        defaultOptions,
        'read',
      )
      expect(result.resolvedPath).toBeTruthy()
      expect(result.resolvedPath).toContain('/home/user/project')
    })
  })

  describe('isPathAllowed (low-level)', () => {
    it('should allow path in allowed directories', () => {
      expect(
        isPathAllowed('/home/user/project/src/file.ts', defaultOptions, 'read').allowed,
      ).toBe(true)
    })

    it('should deny path outside allowed directories', () => {
      expect(
        isPathAllowed('/tmp/somefile', defaultOptions, 'read').allowed,
      ).toBe(false)
    })

    it('should deny paths in denyWithinAllow', () => {
      const options: PathValidationOptions = {
        allowedDirectories: ['/home/user/project'],
        denyWithinAllow: ['/home/user/project/.claude'],
      }
      expect(
        isPathAllowed('/home/user/project/.claude/settings.json', options, 'read').allowed,
      ).toBe(false)
    })

    it('should deny sensitive dotfiles at root of home', () => {
      const options: PathValidationOptions = {
        allowedDirectories: ['/home/user'],
        denyWithinAllow: [],
        enableSensitivePathProtection: true,
      }
      expect(
        isPathAllowed('/home/user/.ssh/id_rsa', options, 'read').allowed,
      ).toBe(false)
    })

    it('should allow read operations more permissively', () => {
      // Reads in allowed dirs should be allowed
      expect(
        isPathAllowed('/home/user/project/file.txt', defaultOptions, 'read').allowed,
      ).toBe(true)
    })

    it('should allow write operations in allowed directories', () => {
      expect(
        isPathAllowed('/home/user/project/src/output.ts', defaultOptions, 'write').allowed,
      ).toBe(true)
    })

    it('should block write to sensitive paths even if within allowed dir', () => {
      const options: PathValidationOptions = {
        allowedDirectories: ['/home/user/project'],
        denyWithinAllow: [],
        enableSensitivePathProtection: true,
      }
      expect(
        isPathAllowed('/home/user/project/.env', options, 'write').allowed,
      ).toBe(false)
    })
  })

  describe('expandTilde', () => {
    it('should expand ~ to home directory', () => {
      const expanded = expandTilde('~/project/file.txt')
      expect(expanded).not.toBe('~/project/file.txt')
      expect(expanded.startsWith('/')).toBe(true)
      expect(expanded.endsWith('/project/file.txt')).toBe(true)
    })

    it('should expand standalone tilde', () => {
      const expanded = expandTilde('~')
      expect(expanded).not.toBe('~')
    })

    it('should not modify paths without tilde', () => {
      expect(expandTilde('/absolute/path')).toBe('/absolute/path')
    })
  })

  describe('getGlobBaseDirectory', () => {
    it('should extract base directory from glob pattern', () => {
      expect(getGlobBaseDirectory('/home/user/project/*.ts')).toBe('/home/user/project')
    })

    it('should handle nested glob patterns', () => {
      expect(getGlobBaseDirectory('/home/user/project/**/*.ts')).toBe('/home/user/project')
    })

    it('should return path as-is if no glob characters', () => {
      expect(getGlobBaseDirectory('/home/user/project/file.ts')).toBe('/home/user/project/file.ts')
    })
  })

  describe('isDangerousRemovalPath', () => {
    it('should flag root directory', () => {
      expect(isDangerousRemovalPath('/')).toBe(true)
    })

    it('should flag wildcard removal', () => {
      expect(isDangerousRemovalPath('*')).toBe(true)
      expect(isDangerousRemovalPath('/some/path/*')).toBe(true)
    })

    it('should flag home directory', () => {
      expect(isDangerousRemovalPath(require('os').homedir())).toBe(true)
    })

    it('should flag direct children of root', () => {
      expect(isDangerousRemovalPath('/usr')).toBe(true)
      expect(isDangerousRemovalPath('/etc')).toBe(true)
      expect(isDangerousRemovalPath('/tmp')).toBe(true)
      expect(isDangerousRemovalPath('/var')).toBe(true)
    })

    it('should NOT flag nested paths', () => {
      expect(isDangerousRemovalPath('/usr/local')).toBe(false)
      expect(isDangerousRemovalPath('/tmp/somefile')).toBe(false)
      expect(isDangerousRemovalPath('/home/user/project')).toBe(false)
    })

    it('should handle Windows drive roots', () => {
      expect(isDangerousRemovalPath('C:\\')).toBe(true)
      expect(isDangerousRemovalPath('D:/')).toBe(true)
    })

    it('should handle Windows drive children', () => {
      expect(isDangerousRemovalPath('C:\\Windows')).toBe(true)
      expect(isDangerousRemovalPath('C:\\Users')).toBe(true)
    })
  })

  describe('SENSITIVE_PATHS', () => {
    it('should contain common sensitive patterns', () => {
      const patterns = SENSITIVE_PATHS.map((p) => p.pattern)
      expect(patterns).toContain('.env')
      expect(patterns).toContain('.ssh')
      expect(patterns).toContain('.git')
    })
  })
})
