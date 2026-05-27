/**
 * TDD Tests — bash-security-utils/types.ts
 *
 * Tests for the BashTool security type definitions.
 */
import { describe, expect, it } from 'vitest'
import { BASH_SECURITY_CHECK_IDS } from '../../tools/built-in/bash-security-utils/types.js'

describe('BashTool Security Types', () => {
  describe('BASH_SECURITY_CHECK_IDS', () => {
    it('should have unique numeric IDs', () => {
      const values = Object.values(BASH_SECURITY_CHECK_IDS)
      const uniqueValues = new Set(values)
      expect(uniqueValues.size).toBe(values.length)
    })

    it('should have all required check IDs', () => {
      expect(BASH_SECURITY_CHECK_IDS.INCOMPLETE_COMMANDS).toBe(1)
      expect(BASH_SECURITY_CHECK_IDS.JQ_SYSTEM_FUNCTION).toBe(2)
      expect(BASH_SECURITY_CHECK_IDS.JQ_FILE_ARGUMENTS).toBe(3)
      expect(BASH_SECURITY_CHECK_IDS.OBFUSCATED_FLAGS).toBe(4)
      expect(BASH_SECURITY_CHECK_IDS.SHELL_METACHARACTERS).toBe(5)
      expect(BASH_SECURITY_CHECK_IDS.DANGEROUS_VARIABLES).toBe(6)
      expect(BASH_SECURITY_CHECK_IDS.NEWLINES).toBe(7)
      expect(BASH_SECURITY_CHECK_IDS.DANGEROUS_PATTERNS_COMMAND_SUBSTITUTION).toBe(8)
      expect(BASH_SECURITY_CHECK_IDS.DANGEROUS_PATTERNS_INPUT_REDIRECTION).toBe(9)
      expect(BASH_SECURITY_CHECK_IDS.DANGEROUS_PATTERNS_OUTPUT_REDIRECTION).toBe(10)
      expect(BASH_SECURITY_CHECK_IDS.IFS_INJECTION).toBe(11)
      expect(BASH_SECURITY_CHECK_IDS.GIT_COMMIT_SUBSTITUTION).toBe(12)
      expect(BASH_SECURITY_CHECK_IDS.PROC_ENVIRON_ACCESS).toBe(13)
      expect(BASH_SECURITY_CHECK_IDS.MALFORMED_TOKEN_INJECTION).toBe(14)
      expect(BASH_SECURITY_CHECK_IDS.BACKSLASH_ESCAPED_WHITESPACE).toBe(15)
      expect(BASH_SECURITY_CHECK_IDS.BRACE_EXPANSION).toBe(16)
      expect(BASH_SECURITY_CHECK_IDS.CONTROL_CHARACTERS).toBe(17)
      expect(BASH_SECURITY_CHECK_IDS.UNICODE_WHITESPACE).toBe(18)
      expect(BASH_SECURITY_CHECK_IDS.MID_WORD_HASH).toBe(19)
      expect(BASH_SECURITY_CHECK_IDS.ZSH_DANGEROUS_COMMANDS).toBe(20)
      expect(BASH_SECURITY_CHECK_IDS.BACKSLASH_ESCAPED_OPERATORS).toBe(21)
      expect(BASH_SECURITY_CHECK_IDS.COMMENT_QUOTE_DESYNC).toBe(22)
      expect(BASH_SECURITY_CHECK_IDS.QUOTED_NEWLINE).toBe(23)
    })

    it('should have exactly 23 check IDs', () => {
      const keys = Object.keys(BASH_SECURITY_CHECK_IDS)
      expect(keys.length).toBe(23)
    })
  })

  describe('Type structure validation', () => {
    it('should infer correct literal types from BASH_SECURITY_CHECK_IDS', () => {
      // Type-level test: values should be numbers
      const value: number = BASH_SECURITY_CHECK_IDS.INCOMPLETE_COMMANDS
      expect(typeof value).toBe('number')
    })
  })
})
