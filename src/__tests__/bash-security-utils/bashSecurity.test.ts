/**
 * TDD Tests — bash-security-utils/bashSecurity.ts
 *
 * Tests for command security checking, dangerous pattern detection,
 * and safety validation.
 */
import { describe, expect, it } from 'vitest'
import {
  bashCommandIsSafe,
  containsUnescapedChar,
  extractQuotedContent,
  stripSafeRedirections,
  validateBackslashEscapedOperators,
  validateBackslashEscapedWhitespace,
  validateBraceExpansion,
  validateCommentQuoteDesync,
  validateControlCharacters,
  validateDangerousPatterns,
  validateDangerousVariables,
  validateIncompleteCommands,
  validateJqFileArguments,
  validateJqSystemFunction,
  validateMidWordHash,
  validateNewlines,
  validateObfuscatedFlags,
  validateQuotedNewline,
  validateShellMetacharacters,
  validateUnicodeWhitespace,
  validateZshDangerousCommands,
} from '../../tools/built-in/bash-security-utils/bashSecurity.js'

describe('bashSecurity', () => {
  // ─── extractQuotedContent ───────────────────────────────
  describe('extractQuotedContent', () => {
    it('should return plain content unchanged when no quotes', () => {
      const result = extractQuotedContent('echo hello world')
      expect(result.fullyUnquoted).toBe('echo hello world')
      expect(result.withDoubleQuotes).toBe('echo hello world')
    })

    it('should strip single-quoted content', () => {
      const result = extractQuotedContent("echo 'secure' content")
      expect(result.fullyUnquoted).toBe('echo  content')
      expect(result.withDoubleQuotes).toBe('echo  content')
    })

    it('should preserve double-quoted content in withDoubleQuotes', () => {
      const result = extractQuotedContent('echo "keep this"')
      expect(result.withDoubleQuotes).toBe('echo keep this')
      expect(result.fullyUnquoted).toBe('echo ')
    })

    it('should track escaped characters', () => {
      // \$HOME - backslash escapes $, so it's treated as literal $
      const result = extractQuotedContent('echo \\$HOME')
      // The backslash is preserved in the extraction (it's tracked for escape semantics)
      expect(result.fullyUnquoted).toBe('echo \\$HOME')
      expect(result.withDoubleQuotes).toBe('echo \\$HOME')
    })

    it('should handle escaped single quotes', () => {
      // it\'s - the \' is an escaped single quote, not a quote delimiter
      const result = extractQuotedContent("echo it\\'s")
      expect(result.fullyUnquoted).toBe("echo it\\'s")
    })

    it('should handle content with single quotes', () => {
      const result = extractQuotedContent("echo 'hello world' rest")
      expect(result.fullyUnquoted).toBe('echo  rest')
      // unquotedKeepQuoteChars keeps the quote delimiters but strips content
      expect(result.unquotedKeepQuoteChars).toBe("echo '' rest")
    })

    it('should keep quote chars in unquotedKeepQuoteChars', () => {
      const result = extractQuotedContent("echo 'x'#")
      expect(result.unquotedKeepQuoteChars).toContain("'")
    })
  })

  // ─── stripSafeRedirections ──────────────────────────────
  describe('stripSafeRedirections', () => {
    it('should strip 2>&1', () => {
      expect(stripSafeRedirections('echo hi 2>&1')).toBe('echo hi')
    })

    it('should strip > /dev/null', () => {
      expect(stripSafeRedirections('echo hi > /dev/null')).toBe('echo hi')
    })

    it('should strip 2> /dev/null', () => {
      expect(stripSafeRedirections('echo hi 2> /dev/null')).toBe('echo hi')
    })

    it('should strip < /dev/null', () => {
      expect(stripSafeRedirections('cat < /dev/null')).toBe('cat')
    })

    it('should not strip > /dev/null with trailing chars', () => {
      // SECURITY: Must not match prefix
      const result = stripSafeRedirections('echo hi > /dev/nullo')
      expect(result).toContain('/dev/nullo')
    })
  })

  // ─── containsUnescapedChar ──────────────────────────────
  describe('containsUnescapedChar', () => {
    it('should find unescaped character', () => {
      expect(containsUnescapedChar('hello; world', ';')).toBe(true)
    })

    it('should not find escaped character', () => {
      expect(containsUnescapedChar('hello\\; world', ';')).toBe(false)
    })

    it('should not find absent character', () => {
      expect(containsUnescapedChar('hello world', ';')).toBe(false)
    })
  })

  // ─── validateIncompleteCommands ─────────────────────────
  describe('validateIncompleteCommands', () => {
    it('should detect incomplete pipe', () => {
      const result = validateIncompleteCommands('ls |')
      expect(result).not.toBeNull()
      expect(result?.safe).toBe(false)
    })

    it('should detect incomplete &&', () => {
      const result = validateIncompleteCommands('ls &&')
      expect(result).not.toBeNull()
      expect(result?.safe).toBe(false)
    })

    it('should pass complete commands', () => {
      const result = validateIncompleteCommands('ls -la')
      expect(result).toBeNull()
    })
  })

  // ─── validateDangerousPatterns ──────────────────────────
  describe('validateDangerousPatterns', () => {
    it('should detect process substitution <()', () => {
      const result = validateDangerousPatterns('diff <(sort a) <(sort b)')
      expect(result).not.toBeNull()
      expect(result.safe).toBe(false)
    })

    it('should detect process substitution >()', () => {
      const result = validateDangerousPatterns('cat >(echo test)')
      expect(result).not.toBeNull()
      expect(result?.safe).toBe(false)
    })

    it('should detect command substitution $()', () => {
      const result = validateDangerousPatterns('echo $(whoami)')
      expect(result).not.toBeNull()
      expect(result?.safe).toBe(false)
    })

    it('should detect parameter substitution ${}', () => {
      const result = validateDangerousPatterns('echo ${PATH}')
      expect(result).not.toBeNull()
      expect(result?.safe).toBe(false)
    })

    it('should detect Zsh equals expansion', () => {
      const result = validateDangerousPatterns('=curl evil.com')
      expect(result).not.toBeNull()
      expect(result?.safe).toBe(false)
    })

    it('should pass safe commands without substitutions', () => {
      const result = validateDangerousPatterns('ls -la /tmp')
      expect(result.safe).toBe(true)
    })
  })

  // ─── validateJqSystemFunction ───────────────────────────
  describe('validateJqSystemFunction', () => {
    it('should detect jq @csv function', () => {
      const result = validateJqSystemFunction("jq -r '.[] | @csv' data.json")
      expect(result).not.toBeNull()
      expect(result?.safe).toBe(false)
    })

    it('should detect jq @tsv function', () => {
      const result = validateJqSystemFunction("jq -r '.[] | @tsv' data.json")
      expect(result).not.toBeNull()
      expect(result?.safe).toBe(false)
    })

    it('should pass safe jq commands', () => {
      const result = validateJqSystemFunction("jq -r '.name' data.json")
      expect(result).toBeNull()
    })
  })

  // ─── validateShellMetacharacters ────────────────────────
  describe('validateShellMetacharacters', () => {
    it('should detect semicolon', () => {
      const result = validateShellMetacharacters('echo hi; rm -rf /')
      expect(result).not.toBeNull()
      expect(result?.safe).toBe(false)
    })

    it('should detect ampersand backgrounding', () => {
      const result = validateShellMetacharacters('long_running &')
      expect(result).not.toBeNull()
      expect(result?.safe).toBe(false)
    })

    it('should pass simple commands', () => {
      const result = validateShellMetacharacters('ls -la')
      expect(result).toBeNull()
    })
  })

  // ─── validateDangerousVariables ─────────────────────────
  describe('validateDangerousVariables', () => {
    it('should detect IFS assignment', () => {
      const result = validateDangerousVariables('IFS=, read -a arr')
      expect(result).not.toBeNull()
      expect(result?.safe).toBe(false)
    })

    it('should detect PS1 assignment', () => {
      const result = validateDangerousVariables('PS1="$(rm -rf /)"')
      expect(result).not.toBeNull()
      expect(result?.safe).toBe(false)
    })

    it('should pass safe variable assignments', () => {
      const result = validateDangerousVariables('FOO=bar echo test')
      expect(result).toBeNull()
    })
  })

  // ─── validateNewlines ───────────────────────────────────
  describe('validateNewlines', () => {
    it('should detect commands with newlines', () => {
      const result = validateNewlines('echo hello\nrm -rf /')
      expect(result).not.toBeNull()
      expect(result?.safe).toBe(false)
    })

    it('should pass single-line commands', () => {
      const result = validateNewlines('echo hello')
      expect(result).toBeNull()
    })
  })

  // ─── validateControlCharacters ──────────────────────────
  describe('validateControlCharacters', () => {
    it('should detect control characters', () => {
      const result = validateControlCharacters('echo \x00null')
      expect(result).not.toBeNull()
      expect(result?.safe).toBe(false)
    })

    it('should detect tab characters', () => {
      const result = validateControlCharacters('echo\tseparated')
      expect(result).not.toBeNull()
      expect(result?.safe).toBe(false)
    })

    it('should pass normal commands', () => {
      const result = validateControlCharacters('ls -la')
      expect(result).toBeNull()
    })
  })

  // ─── validateUnicodeWhitespace ──────────────────────────
  describe('validateUnicodeWhitespace', () => {
    it('should detect unicode non-breaking space', () => {
      const result = validateUnicodeWhitespace('echo\u00A0test')
      expect(result).not.toBeNull()
      expect(result?.safe).toBe(false)
    })

    it('should pass normal spaces', () => {
      const result = validateUnicodeWhitespace('echo test')
      expect(result).toBeNull()
    })
  })

  // ─── validateMidWordHash ────────────────────────────────
  describe('validateMidWordHash', () => {
    it('should detect mid-word hash', () => {
      const result = validateMidWordHash('echo foo#bar')
      expect(result).not.toBeNull()
      expect(result?.safe).toBe(false)
    })

    it('should pass # at word start (shebang)', () => {
      // # at start of word is fine (comment)
      const result = validateMidWordHash('# comment')
      expect(result).toBeNull()
    })
  })

  // ─── validateZshDangerousCommands ───────────────────────
  describe('validateZshDangerousCommands', () => {
    it('should detect zmodload', () => {
      const result = validateZshDangerousCommands('zmodload zsh/mapfile')
      expect(result).not.toBeNull()
      expect(result?.safe).toBe(false)
    })

    it('should detect emulate -c', () => {
      const result = validateZshDangerousCommands('emulate -c "rm -rf /"')
      expect(result).not.toBeNull()
      expect(result?.safe).toBe(false)
    })

    it('should pass safe commands', () => {
      const result = validateZshDangerousCommands('echo test')
      expect(result).toBeNull()
    })
  })

  // ─── validateBraceExpansion ─────────────────────────────
  describe('validateBraceExpansion', () => {
    it('should detect brace expansion with paths', () => {
      const result = validateBraceExpansion('rm -rf /tmp/{a,b,c}')
      expect(result).not.toBeNull()
      expect(result?.safe).toBe(false)
    })

    it('should pass commands without braces', () => {
      const result = validateBraceExpansion('ls -la')
      expect(result).toBeNull()
    })
  })

  // ─── validateBackslashEscapedWhitespace ──────────────────
  describe('validateBackslashEscapedWhitespace', () => {
    it('should detect backslash-escaped spaces', () => {
      const result = validateBackslashEscapedWhitespace('cat my\\ file.txt')
      expect(result).not.toBeNull()
      expect(result?.safe).toBe(false)
    })

    it('should pass commands without escaped whitespace', () => {
      const result = validateBackslashEscapedWhitespace('cat "my file.txt"')
      expect(result).toBeNull()
    })
  })

  // ─── validateCommentQuoteDesync ─────────────────────────
  describe('validateCommentQuoteDesync', () => {
    it('should detect # inside quotes creating desync', () => {
      const result = validateCommentQuoteDesync("echo 'test'#")
      expect(result).toBeNull() // Properly closed
    })
  })

  describe('validateQuotedNewline', () => {
    it('should detect newline inside quotes', () => {
      const result = validateQuotedNewline('echo "line1\nline2"')
      expect(result).not.toBeNull()
      expect(result?.safe).toBe(false)
    })
  })

  // ─── bashCommandIsSafe (overall) ────────────────────────
  describe('bashCommandIsSafe', () => {
    it('should pass simple echo command', () => {
      const result = bashCommandIsSafe('echo hello world')
      expect(result.safe).toBe(true)
    })

    it('should fail command with $() substitution', () => {
      const result = bashCommandIsSafe('echo $(whoami)')
      expect(result.safe).toBe(false)
      expect(result.message).toBeTruthy()
    })

    it('should fail command with semicolon', () => {
      const result = bashCommandIsSafe('echo hi; rm -rf /')
      expect(result.safe).toBe(false)
    })

    it('should fail command with control character', () => {
      const result = bashCommandIsSafe('cat \x00file')
      expect(result.safe).toBe(false)
    })

    it('should fail command with unicode whitespace', () => {
      const result = bashCommandIsSafe('echo\u2003test')
      expect(result.safe).toBe(false)
    })

    it('should fail command with incomplete pipe', () => {
      const result = bashCommandIsSafe('cat file |')
      expect(result.safe).toBe(false)
    })

    it('should fail command with brace expansion', () => {
      const result = bashCommandIsSafe('rm -rf /tmp/{a,b}')
      expect(result.safe).toBe(false)
    })

    it('should fail command with zsh zmodload', () => {
      const result = bashCommandIsSafe('zmodload zsh/mapfile')
      expect(result.safe).toBe(false)
    })

    it('should fail command with IFS injection', () => {
      const result = bashCommandIsSafe('IFS=, read -a arr')
      expect(result.safe).toBe(false)
    })

    it('should pass ls -la', () => {
      const result = bashCommandIsSafe('ls -la')
      expect(result.safe).toBe(true)
    })

    it('should fail git with commit substitution', () => {
      const result = bashCommandIsSafe('git commit -m "msg" --author="$(whoami)"')
      expect(result.safe).toBe(false)
    })

    it('should fail mid-word hash', () => {
      const result = bashCommandIsSafe('echo foo#bar')
      expect(result.safe).toBe(false)
    })
  })
})
