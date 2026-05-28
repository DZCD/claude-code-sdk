/**
 * Tests — PromptRequest & PromptResponse
 *
 * Validates the standardized prompt request/response types.
 * Based on Claude Code's PromptRequestSchema / PromptResponseSchema.
 */
import { describe, expect, it } from 'vitest'
import type {
  PromptRequest,
  PromptRequestOption,
  PromptResponse,
} from '../prompt-messages.js'
import {
  createPromptRequest,
  createPromptResponse,
  isPromptRequest,
  isPromptResponse,
  promptResponseToKey,
} from '../prompt-messages.js'

describe('PromptRequest', () => {
  describe('Type structure', () => {
    it('should accept a valid PromptRequest', () => {
      const req: PromptRequest = {
        prompt: 'req-001',
        message: 'Which file would you like to open?',
        options: [
          { key: 'main', label: 'src/main.ts' },
          { key: 'test', label: 'src/main.test.ts', description: 'Test file' },
        ],
      }
      expect(req.prompt).toBe('req-001')
      expect(req.message).toBe('Which file would you like to open?')
      expect(req.options).toHaveLength(2)
      expect(req.options[0]!.key).toBe('main')
      expect(req.options[1]!.description).toBe('Test file')
    })

    it('should allow options without descriptions', () => {
      const req: PromptRequest = {
        prompt: 'simple',
        message: 'Continue?',
        options: [
          { key: 'yes', label: 'Yes' },
          { key: 'no', label: 'No' },
        ],
      }
      expect(req.options[0]!.description).toBeUndefined()
    })

    it('should allow empty options array', () => {
      const req: PromptRequest = {
        prompt: 'notify',
        message: 'Operation complete.',
        options: [],
      }
      expect(req.options).toHaveLength(0)
    })
  })

  describe('isPromptRequest', () => {
    it('should identify valid PromptRequest objects', () => {
      const req: PromptRequest = {
        prompt: 'req-1',
        message: 'Choose an option',
        options: [{ key: 'a', label: 'Option A' }],
      }
      expect(isPromptRequest(req)).toBe(true)
    })

    it('should reject objects without prompt field', () => {
      expect(isPromptRequest({ message: 'test', options: [] })).toBe(false)
    })

    it('should reject objects without message field', () => {
      expect(isPromptRequest({ prompt: 'test', options: [] })).toBe(false)
    })

    it('should reject objects without options array', () => {
      expect(isPromptRequest({ prompt: 'test', message: 'msg' })).toBe(false)
    })

    it('should reject non-object values', () => {
      expect(isPromptRequest(null)).toBe(false)
      expect(isPromptRequest(undefined)).toBe(false)
      expect(isPromptRequest('string')).toBe(false)
      expect(isPromptRequest(42)).toBe(false)
    })
  })

  describe('createPromptRequest', () => {
    it('should create a PromptRequest with all fields', () => {
      const options: PromptRequestOption[] = [
        { key: 'run', label: 'Run tests' },
        { key: 'lint', label: 'Lint code', description: 'Run biome linter' },
      ]
      const req = createPromptRequest('req-001', 'What should I do?', options)

      expect(req.prompt).toBe('req-001')
      expect(req.message).toBe('What should I do?')
      expect(req.options).toEqual(options)
    })

    it('should create a PromptRequest with empty options', () => {
      const req = createPromptRequest('notify-1', 'Task completed.', [])

      expect(req.prompt).toBe('notify-1')
      expect(req.options).toEqual([])
    })
  })
})

describe('PromptResponse', () => {
  describe('Type structure', () => {
    it('should accept a valid PromptResponse', () => {
      const res: PromptResponse = {
        prompt_response: 'req-001',
        selected: 'main',
      }
      expect(res.prompt_response).toBe('req-001')
      expect(res.selected).toBe('main')
    })
  })

  describe('isPromptResponse', () => {
    it('should identify valid PromptResponse objects', () => {
      const res: PromptResponse = {
        prompt_response: 'req-1',
        selected: 'opt-a',
      }
      expect(isPromptResponse(res)).toBe(true)
    })

    it('should reject objects without prompt_response field', () => {
      expect(isPromptResponse({ selected: 'a' })).toBe(false)
    })

    it('should reject objects without selected field', () => {
      expect(isPromptResponse({ prompt_response: 'test' })).toBe(false)
    })

    it('should reject non-object values', () => {
      expect(isPromptResponse(null)).toBe(false)
      expect(isPromptResponse(undefined)).toBe(false)
      expect(isPromptResponse('string')).toBe(false)
    })
  })

  describe('createPromptResponse', () => {
    it('should create a PromptResponse', () => {
      const res = createPromptResponse('req-001', 'selected-key')
      expect(res.prompt_response).toBe('req-001')
      expect(res.selected).toBe('selected-key')
    })
  })

  describe('promptResponseToKey', () => {
    it('should extract the selected key from a PromptResponse', () => {
      const res: PromptResponse = {
        prompt_response: 'req-1',
        selected: 'my-key',
      }
      expect(promptResponseToKey(res)).toBe('my-key')
    })
  })

  describe('round-trip', () => {
    it('should allow matching request ID to response ID', () => {
      const req = createPromptRequest('match-test', 'Choose:', [
        { key: '1', label: 'One' },
      ])
      const res = createPromptResponse('match-test', '1')

      expect(res.prompt_response).toBe(req.prompt)
    })
  })
})
