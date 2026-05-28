/**
 * Tests — StreamlinedMessage
 *
 * Validates the streamlined message conversion for context window optimization.
 */
import { describe, expect, it } from 'vitest'
import { createAssistantMessage, createToolResultMessage, createUserMessage } from '../message.js'
import type { StreamlinedMessage, StreamlinedToolSummary } from '../streamlined-message.js'
import {
  createStreamlinedTextMessage,
  createStreamlinedToolSummaryMessage,
  isStreamlinedMessage,
  isStreamlinedToolSummary,
  reconstructMessageContent,
  streamlineAll,
  streamlineMessage,
} from '../streamlined-message.js'

describe('StreamlinedMessage', () => {
  // ─── Type Guards ─────────────────────────────

  describe('isStreamlinedMessage', () => {
    it('should return true for streamlined_text messages', () => {
      const msg: StreamlinedMessage = {
        type: 'streamlined_text',
        role: 'assistant',
        text: 'Hello world',
      }
      expect(isStreamlinedMessage(msg)).toBe(true)
    })

    it('should return false for non-streamlined objects', () => {
      expect(isStreamlinedMessage({ type: 'user', content: 'hello' })).toBe(false)
      expect(isStreamlinedMessage(null)).toBe(false)
      expect(isStreamlinedMessage(undefined)).toBe(false)
      expect(isStreamlinedMessage({})).toBe(false)
    })
  })

  describe('isStreamlinedToolSummary', () => {
    it('should return true for streamlined_tool_use_summary messages', () => {
      const msg: StreamlinedToolSummary = {
        type: 'streamlined_tool_use_summary',
        toolSummary: 'Read 2 files, wrote 1 file',
      }
      expect(isStreamlinedToolSummary(msg)).toBe(true)
    })

    it('should return false for non-tool-summary objects', () => {
      expect(isStreamlinedToolSummary({ type: 'streamlined_text', text: 'hello' })).toBe(false)
      expect(isStreamlinedToolSummary(null)).toBe(false)
    })
  })

  // ─── Message Streamlining ────────────────────

  describe('streamlineMessage', () => {
    it('should streamline a user text message to streamlined_text', () => {
      const userMsg = createUserMessage('What is the weather?')
      const result = streamlineMessage(userMsg)

      expect(result.type).toBe('streamlined_text')
      expect(result.role).toBe('user')
      expect((result as StreamlinedMessage).text).toBe('What is the weather?')
    })

    it('should streamline an assistant text message', () => {
      const assistantMsg = createAssistantMessage('The weather is sunny.')
      const result = streamlineMessage(assistantMsg)

      expect(result.type).toBe('streamlined_text')
      expect(result.role).toBe('assistant')
      expect((result as StreamlinedMessage).text).toBe('The weather is sunny.')
    })

    it('should streamline assistant message with tool_use blocks', () => {
      const msg = createAssistantMessage([
        { type: 'text', text: 'Let me check the files.' },
        { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file: 'foo.txt' } },
      ])
      const result = streamlineMessage(msg)

      expect(result.type).toBe('streamlined_text')
      expect(result.role).toBe('assistant')
      expect((result as StreamlinedMessage).text).toBe('Let me check the files.')
      expect((result as StreamlinedMessage).toolUses).toBeDefined()
      expect((result as StreamlinedMessage).toolUses!).toHaveLength(1)
      expect((result as StreamlinedMessage).toolUses![0]!.name).toBe('Read')
    })

    it('should streamline a tool result message to streamlined_text', () => {
      const msg = createToolResultMessage([{ type: 'tool_result', toolUseId: 'tool-1', content: 'file content here' }])
      const result = streamlineMessage(msg)

      expect(result.type).toBe('streamlined_text')
      expect(result.role).toBe('user')
    })

    it('should extract tool_use blocks from assistant content blocks', () => {
      const msg = createAssistantMessage([
        { type: 'text', text: 'Processing...' },
        {
          type: 'tool_use',
          id: 'tu-001',
          name: 'Bash',
          input: { command: 'ls' },
        },
        {
          type: 'tool_use',
          id: 'tu-002',
          name: 'Read',
          input: { file: 'src/index.ts' },
        },
      ])
      const result = streamlineMessage(msg) as StreamlinedMessage

      expect(result.toolUses).toHaveLength(2)
      expect(result.toolUses![0]!.name).toBe('Bash')
      expect(result.toolUses![0]!.input).toEqual({ command: 'ls' })
      expect(result.toolUses![1]!.name).toBe('Read')
    })
  })

  describe('streamlineAll', () => {
    it('should streamline all messages in an array', () => {
      const messages = [
        createUserMessage('Hello'),
        createAssistantMessage('Hi there!'),
        createUserMessage('Read file foo'),
        createAssistantMessage([
          { type: 'text', text: 'Reading...' },
          { type: 'tool_use', id: 't1', name: 'Read', input: { file: 'foo' } },
        ]),
      ]

      const streamed = streamlineAll(messages)

      expect(streamed).toHaveLength(4)
      expect(streamed.every((s) => s.type === 'streamlined_text')).toBe(true)
      expect((streamed[0] as StreamlinedMessage).role).toBe('user')
      expect((streamed[1] as StreamlinedMessage).role).toBe('assistant')
      expect((streamed[3] as StreamlinedMessage).toolUses).toHaveLength(1)
    })

    it('should return empty array for empty input', () => {
      expect(streamlineAll([])).toEqual([])
    })

    it('should handle mixed message types', () => {
      const messages = [
        createUserMessage('Task 1'),
        createAssistantMessage([
          { type: 'thinking', thinking: 'Analyzing...' },
          { type: 'text', text: 'I will help.' },
        ]),
      ]

      const streamed = streamlineAll(messages)
      expect(streamed).toHaveLength(2)
      expect((streamed[1] as StreamlinedMessage).text).toBe('I will help.')
    })
  })

  // ─── Factory Functions ──────────────────────

  describe('createStreamlinedTextMessage', () => {
    it('should create a streamlined_text message with correct fields', () => {
      const msg = createStreamlinedTextMessage('assistant', 'Done processing.')

      expect(msg.type).toBe('streamlined_text')
      expect(msg.role).toBe('assistant')
      expect(msg.text).toBe('Done processing.')
      expect(msg.toolUses).toBeUndefined()
    })

    it('should accept optional toolUses', () => {
      const toolUses = [{ id: 't1', name: 'Read', input: { file: 'test.ts' } }]
      const msg = createStreamlinedTextMessage('assistant', 'Reading...', toolUses)

      expect(msg.toolUses).toEqual(toolUses)
    })

    it('should accept optional session_id and uuid', () => {
      const msg = createStreamlinedTextMessage('assistant', 'text', undefined, 'session-123', 'uuid-456')

      expect(msg.session_id).toBe('session-123')
      expect(msg.uuid).toBe('uuid-456')
    })
  })

  describe('createStreamlinedToolSummaryMessage', () => {
    it('should create a streamlined_tool_use_summary message', () => {
      const msg = createStreamlinedToolSummaryMessage('Read 3 files, wrote 1 file', 'session-789')

      expect(msg.type).toBe('streamlined_tool_use_summary')
      expect(msg.toolSummary).toBe('Read 3 files, wrote 1 file')
      expect(msg.session_id).toBe('session-789')
    })
  })

  // ─── Content Reconstruction ─────────────────

  describe('reconstructMessageContent', () => {
    it('should reconstruct plain text from streamlined_text without tool_uses', () => {
      const msg: StreamlinedMessage = {
        type: 'streamlined_text',
        role: 'assistant',
        text: 'Hello world',
      }
      expect(reconstructMessageContent(msg)).toBe('Hello world')
    })

    it('should reconstruct content with tool use annotations', () => {
      const msg: StreamlinedMessage = {
        type: 'streamlined_text',
        role: 'assistant',
        text: 'Let me check.',
        toolUses: [
          { id: 't1', name: 'Bash', input: { command: 'ls' } },
          { id: 't2', name: 'Read', input: { file: 'foo.txt' } },
        ],
      }
      const reconstructed = reconstructMessageContent(msg)
      expect(reconstructed).toContain('Let me check.')
      expect(reconstructed).toContain('[Tool: Bash]')
      expect(reconstructed).toContain('[Tool: Read]')
    })

    it('should handle streamlined_tool_use_summary', () => {
      const msg: StreamlinedToolSummary = {
        type: 'streamlined_tool_use_summary',
        toolSummary: 'Compacted 5 tool calls',
      }
      expect(reconstructMessageContent(msg)).toBe('[Compacted: Compacted 5 tool calls]')
    })
  })
})
