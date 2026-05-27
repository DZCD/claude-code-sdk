/**
 * TDD Tests — sedEditParser, sedValidation, modeValidation
 */
import { describe, it, expect } from 'vitest'
import {
  isSedInPlaceEdit,
  parseSedEditCommand,
  applySedSubstitution,
} from '../../tools/built-in/bash-security-utils/sedEditParser.js'
import {
  isLinePrintingCommand,
  sedCommandIsAllowedByAllowlist,
  validateSedCommand,
} from '../../tools/built-in/bash-security-utils/sedValidation.js'
import {
  checkPermissionMode,
  getAutoAllowedCommands,
} from '../../tools/built-in/bash-security-utils/modeValidation.js'
import type { PermissionContext } from '../../tools/built-in/bash-security-utils/types.js'

// ─── sedEditParser Tests ──────────────────────────────────

describe('sedEditParser', () => {
  describe('parseSedEditCommand', () => {
    it('should parse sed -i s/foo/bar/g file', () => {
      const result = parseSedEditCommand("sed -i 's/foo/bar/g' file.txt")
      expect(result).not.toBeNull()
      expect(result!.filePath).toBe('file.txt')
      expect(result!.pattern).toBe('foo')
      expect(result!.replacement).toBe('bar')
      expect(result!.flags).toBe('g')
    })

    it('should handle -E extended regex flag', () => {
      const result = parseSedEditCommand("sed -i -E 's/[0-9]+/NUM/g' file.txt")
      expect(result).not.toBeNull()
      expect(result!.extendedRegex).toBe(true)
      expect(result!.filePath).toBe('file.txt')
    })

    it('should return null for non-sed commands', () => {
      expect(parseSedEditCommand('echo hello')).toBeNull()
    })

    it('should return null without -i flag', () => {
      expect(parseSedEditCommand("sed 's/foo/bar/' file.txt")).toBeNull()
    })

    it('should handle backup suffix in -i flag', () => {
      const result = parseSedEditCommand("sed -i.bak 's/foo/bar/' file.txt")
      expect(result).not.toBeNull()
      expect(result!.filePath).toBe('file.txt')
    })
  })

  describe('isSedInPlaceEdit', () => {
    it('should detect sed in-place edit', () => {
      expect(isSedInPlaceEdit("sed -i 's/foo/bar/' file.txt")).toBe(true)
    })

    it('should return false for non-sed commands', () => {
      expect(isSedInPlaceEdit('echo hello')).toBe(false)
    })
  })

  describe('applySedSubstitution', () => {
    it('should apply simple substitution', () => {
      const result = applySedSubstitution('hello foo world', {
        filePath: 'test.txt',
        pattern: 'foo',
        replacement: 'bar',
        flags: '',
        extendedRegex: false,
      })
      expect(result).toBe('hello bar world')
    })

    it('should apply global substitution', () => {
      const result = applySedSubstitution('foo foo foo', {
        filePath: 'test.txt',
        pattern: 'foo',
        replacement: 'bar',
        flags: 'g',
        extendedRegex: false,
      })
      expect(result).toBe('bar bar bar')
    })

    it('should handle BRE metacharacters', () => {
      const result = applySedSubstitution('hello foooo bar', {
        filePath: 'test.txt',
        pattern: 'foo\\+',  // BRE: one or more 'o'
        replacement: 'baz',
        flags: '',
        extendedRegex: false,
      })
      // In BRE, \+ means "one or more", so foo\+ matches "foooo"
      expect(result).toBe('hello baz bar')
    })

    it('should handle invalid regex gracefully', () => {
      const result = applySedSubstitution('hello world', {
        filePath: 'test.txt',
        pattern: '[invalid',
        replacement: 'bar',
        flags: '',
        extendedRegex: false,
      })
      expect(result).toBe('hello world') // unchanged
    })
  })
})

// ─── sedValidation Tests ──────────────────────────────────

describe('sedValidation', () => {
  describe('isLinePrintingCommand', () => {
    it('should detect -n with print command', () => {
      expect(isLinePrintingCommand("sed -n '5p' file.txt", [])).toBe(true)
    })

    it('should detect -n with range print', () => {
      expect(isLinePrintingCommand("sed -n '5,10p' file.txt", [])).toBe(true)
    })

    it('should return false without -n flag', () => {
      expect(isLinePrintingCommand("sed '5p' file.txt", [])).toBe(false)
    })
  })

  describe('validateSedCommand', () => {
    it('should detect sed -i (in-place edit)', () => {
      const result = validateSedCommand("sed -i 's/foo/bar/' file.txt")
      expect(result).not.toBeNull()
      expect(result!.safe).toBe(false)
      expect(result!.reason).toBe('sed_in_place')
    })

    it('should pass non-sed commands', () => {
      expect(validateSedCommand('echo hello')).toBeNull()
    })

    it('should pass basic sed read commands', () => {
      const result = validateSedCommand("sed -n '5p' file.txt")
      expect(result).toBeNull()
    })
  })

  describe('sedCommandIsAllowedByAllowlist', () => {
    it('should allow line printing commands', () => {
      const result = sedCommandIsAllowedByAllowlist("sed -n '5p' file.txt")
      expect(result.behavior).toBe('allow')
    })

    it('should passthrough other sed commands', () => {
      const result = sedCommandIsAllowedByAllowlist("sed 's/foo/bar/' file.txt")
      expect(result.behavior).toBe('passthrough')
    })
  })
})

// ─── modeValidation Tests ─────────────────────────────────

describe('modeValidation', () => {
  const makeContext = (mode: PermissionContext['mode']): PermissionContext => ({
    mode,
    allowedDirectories: [],
    deniedDirectories: [],
    allowRules: [],
    denyRules: [],
  })

  describe('checkPermissionMode', () => {
    it('should allow all in bypassPermissions mode', () => {
      const result = checkPermissionMode('rm -rf /', makeContext('bypassPermissions'))
      expect(result.behavior).toBe('allow')
    })

    it('should auto-allow filesystem commands in acceptEdits mode', () => {
      const result = checkPermissionMode('mkdir /tmp/test', makeContext('acceptEdits'))
      expect(result.behavior).toBe('allow')
    })

    it('should passthrough non-filesystem commands in acceptEdits mode', () => {
      const result = checkPermissionMode('echo hello', makeContext('acceptEdits'))
      expect(result.behavior).toBe('passthrough')
    })

    it('should passthrough in default mode', () => {
      const result = checkPermissionMode('ls -la', makeContext('default'))
      expect(result.behavior).toBe('passthrough')
    })
  })

  describe('getAutoAllowedCommands', () => {
    it('should return filesystem commands in acceptEdits mode', () => {
      const commands = getAutoAllowedCommands('acceptEdits')
      expect(commands).toContain('mkdir')
      expect(commands).toContain('rm')
      expect(commands).toContain('cp')
    })

    it('should return empty in default mode', () => {
      expect(getAutoAllowedCommands('default')).toEqual([])
    })
  })
})
