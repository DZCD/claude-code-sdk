/**
 * TDD Tests — bash-security-utils/bashPermissions.ts
 *            bash-security-utils/readOnlyValidation.ts
 */
import { describe, it, expect } from 'vitest'
import {
  parsePermissionRule,
  matchWildcardPattern,
  stripSafeWrappers,
  isBareShellOrWrapperCommand,
  getSimpleCommandPrefix,
  checkBashPermission,
} from '../../tools/built-in/bash-security-utils/bashPermissions.js'
import {
  validateFlags,
  containsVulnerableUncPath,
  checkReadOnlyConstraints,
} from '../../tools/built-in/bash-security-utils/readOnlyValidation.js'
import type { PermissionContext } from '../../tools/built-in/bash-security-utils/types.js'

// ─── bashPermissions Tests ────────────────────────────────

describe('bashPermissions', () => {
  // ─── parsePermissionRule ─────────────────────────────
  describe('parsePermissionRule', () => {
    it('should parse exact Bash(command) rule', () => {
      const result = parsePermissionRule('Bash(ls)')
      expect(result.type).toBe('exact')
      expect(result.command).toBe('ls')
    })

    it('should parse prefix Bash(command:*) rule', () => {
      const result = parsePermissionRule('Bash(rm:*)')
      expect(result.type).toBe('prefix')
      expect(result.prefix).toBe('rm')
    })

    it('should parse wildcard Bash(*) rule', () => {
      const result = parsePermissionRule('Bash(*)')
      expect(result.type).toBe('wildcard')
    })

    it('should parse simple command as exact', () => {
      const result = parsePermissionRule('ls -la')
      expect(result.type).toBe('exact')
      expect(result.command).toBe('ls -la')
    })
  })

  // ─── matchWildcardPattern ────────────────────────────
  describe('matchWildcardPattern', () => {
    it('should match exact patterns', () => {
      expect(matchWildcardPattern('rm', 'rm')).toBe(true)
    })

    it('should match wildcard patterns', () => {
      expect(matchWildcardPattern('rm*', 'rm -rf /')).toBe(true)
    })

    it('should not match different commands', () => {
      expect(matchWildcardPattern('ls*', 'rm -rf /')).toBe(false)
    })
  })

  // ─── stripSafeWrappers ───────────────────────────────
  describe('stripSafeWrappers', () => {
    it('should strip timeout wrapper', () => {
      expect(stripSafeWrappers('timeout 30 ls -la')).toBe('ls -la')
    })

    it('should strip nice wrapper', () => {
      expect(stripSafeWrappers('nice -n 10 ls')).toBe('ls')
    })

    it('should strip safe env vars', () => {
      expect(stripSafeWrappers('NODE_ENV=production npm run build')).toBe('npm run build')
    })

    it('should not strip non-safe env vars', () => {
      // Non-safe env vars should remain (security: we only strip known-safe vars)
      expect(stripSafeWrappers('MY_SECRET=abc123 ls')).toBe('MY_SECRET=abc123 ls')
    })
  })

  // ─── isBareShellOrWrapperCommand ─────────────────────
  describe('isBareShellOrWrapperCommand', () => {
    it('should detect bare bash', () => {
      expect(isBareShellOrWrapperCommand('bash -c "evil"')).toBe(true)
    })

    it('should detect sudo', () => {
      expect(isBareShellOrWrapperCommand('sudo rm -rf /')).toBe(true)
    })

    it('should pass normal commands', () => {
      expect(isBareShellOrWrapperCommand('ls -la')).toBe(false)
    })
  })

  // ─── getSimpleCommandPrefix ───────────────────────────
  describe('getSimpleCommandPrefix', () => {
    it('should extract command + subcommand', () => {
      expect(getSimpleCommandPrefix('git commit -m "msg"')).toBe('git commit')
    })

    it('should return null for simple commands', () => {
      expect(getSimpleCommandPrefix('ls -la')).toBeNull()
    })
  })

  // ─── checkBashPermission ─────────────────────────────
  describe('checkBashPermission', () => {
    const makeContext = (overrides?: Partial<PermissionContext>): PermissionContext => ({
      mode: 'default',
      allowedDirectories: [],
      deniedDirectories: [],
      allowRules: [],
      denyRules: [],
      ...overrides,
    })

    it('should bypass permissions in bypass mode', () => {
      const result = checkBashPermission('rm -rf /', makeContext({ mode: 'bypassPermissions' }))
      expect(result.behavior).toBe('allow')
    })

    it('should allow commands matching allow rules', () => {
      const result = checkBashPermission('ls -la', makeContext({ allowRules: ['Bash(*)'] }))
      expect(result.behavior).toBe('allow')
    })

    it('should deny commands matching deny rules', () => {
      const result = checkBashPermission('rm -rf /', makeContext({
        denyRules: ['Bash(rm:*)'],
      }))
      expect(result.behavior).toBe('deny')
    })

    it('should return passthrough when no rules match', () => {
      const result = checkBashPermission('echo hi', makeContext())
      expect(result.behavior).toBe('passthrough')
    })

    it('should deny take precedence over allow', () => {
      const result = checkBashPermission('rm -rf /', makeContext({
        allowRules: ['Bash(*)'],
        denyRules: ['Bash(rm:*)'],
      }))
      expect(result.behavior).toBe('deny')
    })

    it('should match prefix deny rules', () => {
      const result = checkBashPermission('rm file.txt', makeContext({
        denyRules: ['Bash(rm:*)'],
      }))
      expect(result.behavior).toBe('deny')
    })
  })
})

// ─── readOnlyValidation Tests ──────────────────────────────

describe('readOnlyValidation', () => {
  // ─── validateFlags ────────────────────────────────
  describe('validateFlags', () => {
    const safeFlags = {
      '-n': 'none', '--help': 'none', '--version': 'none',
      '-t': 'string', '-o': 'string', '--output': 'string',
    }

    it('should validate safe flags', () => {
      expect(validateFlags(['-n', '--help'], safeFlags)).toBe(true)
    })

    it('should reject unknown flags', () => {
      expect(validateFlags(['-x', '--dangerous'], safeFlags)).toBe(false)
    })

    it('should handle combined short flags', () => {
      expect(validateFlags(['-nh', '-t'], { '-n': 'none', '-t': 'string', '-h': 'none' })).toBe(true)
    })

    it('should handle -- end-of-options', () => {
      expect(validateFlags(['-n', '--', '-x'], safeFlags)).toBe(true)
    })
  })

  // ─── containsVulnerableUncPath ────────────────────
  describe('containsVulnerableUncPath', () => {
    it('should detect UNC paths', () => {
      expect(containsVulnerableUncPath('\\\\server\\share\\file')).toBe(true)
    })

    it('should pass normal paths', () => {
      expect(containsVulnerableUncPath('/home/user/file.txt')).toBe(false)
    })
  })

  // ─── checkReadOnlyConstraints ──────────────────────
  describe('checkReadOnlyConstraints', () => {
    it('should pass safe commands', () => {
      const result = checkReadOnlyConstraints('ls -la')
      expect(result.safe).toBe(true)
    })

    it('should detect UNC paths', () => {
      const result = checkReadOnlyConstraints('\\\\evil\\share\\file')
      expect(result.safe).toBe(false)
      expect(result.reason).toBe('unc_path')
    })
  })
})
