/**
 * Tests — LocalCommandOutput
 *
 * Validates the local command execution output format.
 * Based on Claude Code's SDKLocalCommandOutputMessageSchema.
 */
import { describe, expect, it } from 'vitest'
import type { LocalCommandOutput } from '../command-output.js'
import {
  COMMAND_OUTPUT_SENTINEL,
  commandOutputToSystemMessage,
  commandOutputToText,
  createCommandOutput,
  exitCodeToStatus,
  formatCommandOutput,
  isCommandOutput,
  mergeCommandOutputs,
} from '../command-output.js'
import { createSystemMessage } from '../message.js'

describe('LocalCommandOutput', () => {
  describe('Type structure', () => {
    it('should accept stdout only', () => {
      const output: LocalCommandOutput = {
        stdout: 'Hello World\n',
        stderr: '',
        exitCode: 0,
      }
      expect(output.stdout).toBe('Hello World\n')
      expect(output.exitCode).toBe(0)
    })

    it('should accept stderr only', () => {
      const output: LocalCommandOutput = {
        stdout: '',
        stderr: 'Error: file not found\n',
        exitCode: 1,
      }
      expect(output.stderr).toContain('Error')
      expect(output.exitCode).toBe(1)
    })

    it('should accept both stdout and stderr', () => {
      const output: LocalCommandOutput = {
        stdout: 'Processing...\nDone.\n',
        stderr: 'warning: deprecated flag\n',
        exitCode: 0,
      }
      expect(output.stdout).toBeTruthy()
      expect(output.stderr).toBeTruthy()
    })

    it('should accept non-zero exit codes', () => {
      const output: LocalCommandOutput = {
        stdout: '',
        stderr: 'Fatal error',
        exitCode: 127,
      }
      expect(output.exitCode).toBe(127)
    })
  })

  describe('createCommandOutput', () => {
    it('should create a LocalCommandOutput with all fields', () => {
      const output = createCommandOutput('output text\n', 'error text\n', 2)
      expect(output.stdout).toBe('output text\n')
      expect(output.stderr).toBe('error text\n')
      expect(output.exitCode).toBe(2)
    })

    it('should default empty strings when not provided', () => {
      const output = createCommandOutput()
      expect(output.stdout).toBe('')
      expect(output.stderr).toBe('')
      expect(output.exitCode).toBe(0)
    })

    it('should handle null/undefined gracefully', () => {
      // @ts-expect-error testing runtime behavior
      const output = createCommandOutput(null, undefined, undefined)
      expect(output.stdout).toBe('')
      expect(output.stderr).toBe('')
      expect(output.exitCode).toBe(0)
    })
  })

  describe('isCommandOutput', () => {
    it('should identify valid LocalCommandOutput objects', () => {
      expect(isCommandOutput({ stdout: '', stderr: '', exitCode: 0 })).toBe(true)
      expect(isCommandOutput({ stdout: 'a', stderr: 'b', exitCode: 1 })).toBe(true)
      expect(isCommandOutput({ stdout: 'out', stderr: '', exitCode: 0 })).toBe(true)
    })

    it('should reject missing stdout', () => {
      expect(isCommandOutput({ stderr: '', exitCode: 0 })).toBe(false)
    })

    it('should reject missing stderr', () => {
      expect(isCommandOutput({ stdout: '', exitCode: 0 })).toBe(false)
    })

    it('should reject missing exitCode', () => {
      expect(isCommandOutput({ stdout: '', stderr: '' })).toBe(false)
    })

    it('should reject non-integer exitCode', () => {
      expect(isCommandOutput({ stdout: '', stderr: '', exitCode: '0' })).toBe(false)
    })

    it('should reject non-object values', () => {
      expect(isCommandOutput(null)).toBe(false)
      expect(isCommandOutput(undefined)).toBe(false)
      expect(isCommandOutput('string')).toBe(false)
      expect(isCommandOutput(42)).toBe(false)
    })

    it('should reject arrays', () => {
      expect(isCommandOutput(['output'])).toBe(false)
    })
  })

  describe('commandOutputToText', () => {
    it('should combine stdout and stderr', () => {
      const output: LocalCommandOutput = {
        stdout: 'Line 1\nLine 2\n',
        stderr: 'Warning!\n',
        exitCode: 0,
      }
      const text = commandOutputToText(output)
      expect(text).toContain('Line 1')
      expect(text).toContain('Warning!')
    })

    it('should handle stdout only', () => {
      const output: LocalCommandOutput = {
        stdout: 'clean output',
        stderr: '',
        exitCode: 0,
      }
      expect(commandOutputToText(output)).toBe('clean output')
    })

    it('should handle stderr only', () => {
      const output: LocalCommandOutput = {
        stdout: '',
        stderr: 'error output',
        exitCode: 1,
      }
      expect(commandOutputToText(output)).toContain('error output')
    })

    it('should include exit code info', () => {
      const output: LocalCommandOutput = {
        stdout: '',
        stderr: '',
        exitCode: 1,
      }
      const text = commandOutputToText(output)
      expect(text).toContain('Exit code: 1')
    })
  })

  describe('mergeCommandOutputs', () => {
    it('should merge multiple outputs', () => {
      const outputs: LocalCommandOutput[] = [
        { stdout: 'A', stderr: 'err1', exitCode: 0 },
        { stdout: 'B', stderr: '', exitCode: 0 },
        { stdout: 'C', stderr: 'err2', exitCode: 1 },
      ]
      const merged = mergeCommandOutputs(outputs)
      expect(merged.stdout).toContain('A')
      expect(merged.stdout).toContain('B')
      expect(merged.stdout).toContain('C')
      expect(merged.stderr).toContain('err1')
      expect(merged.stderr).toContain('err2')
      expect(merged.exitCode).toBe(1) // last non-zero
    })

    it('should return exitCode 0 when all are 0', () => {
      const outputs: LocalCommandOutput[] = [
        { stdout: 'a', stderr: '', exitCode: 0 },
        { stdout: 'b', stderr: '', exitCode: 0 },
      ]
      expect(mergeCommandOutputs(outputs).exitCode).toBe(0)
    })

    it('should handle empty array', () => {
      const merged = mergeCommandOutputs([])
      expect(merged.stdout).toBe('')
      expect(merged.stderr).toBe('')
      expect(merged.exitCode).toBe(0)
    })
  })

  describe('commandOutputToSystemMessage', () => {
    it('should convert output to a system message with local_command_output subtype', () => {
      const output: LocalCommandOutput = {
        stdout: 'done',
        stderr: '',
        exitCode: 0,
      }
      const msg = commandOutputToSystemMessage(output)
      expect(msg.role).toBe('system')
      // Check the content includes COMMAND_OUTPUT_SENTINEL
      expect(msg.content).toContain(COMMAND_OUTPUT_SENTINEL)
    })

    it('should preserve output content in system message', () => {
      const output: LocalCommandOutput = {
        stdout: 'Compiled successfully.\n',
        stderr: '',
        exitCode: 0,
      }
      const msg = commandOutputToSystemMessage(output)
      expect(msg.content).toContain('Compiled successfully.')
    })
  })

  describe('exitCodeToStatus', () => {
    it('should return "success" for exitCode 0', () => {
      expect(exitCodeToStatus(0)).toBe('success')
    })

    it('should return "error" for exitCode > 0', () => {
      expect(exitCodeToStatus(1)).toBe('error')
      expect(exitCodeToStatus(127)).toBe('error')
      expect(exitCodeToStatus(255)).toBe('error')
    })

    it('should return "error" for negative exit codes', () => {
      expect(exitCodeToStatus(-1)).toBe('error')
    })
  })

  describe('formatCommandOutput', () => {
    it('should format for display', () => {
      const output: LocalCommandOutput = {
        stdout: 'File processed.',
        stderr: 'Warning: deprecated.',
        exitCode: 0,
      }
      const formatted = formatCommandOutput(output)
      expect(formatted).toContain('[stdout]')
      expect(formatted).toContain('[stderr]')
      expect(formatted).toContain('File processed.')
      expect(formatted).toContain('Warning: deprecated.')
    })

    it('should omit empty sections', () => {
      const output: LocalCommandOutput = {
        stdout: 'Clean output',
        stderr: '',
        exitCode: 0,
      }
      const formatted = formatCommandOutput(output)
      expect(formatted).not.toContain('[stderr]')
    })

    it('should show exit code when non-zero', () => {
      const output: LocalCommandOutput = {
        stdout: '',
        stderr: 'Fatal error',
        exitCode: 42,
      }
      const formatted = formatCommandOutput(output)
      expect(formatted).toContain('exit code: 42')
    })
  })
})
