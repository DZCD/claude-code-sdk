/**
 * ClaudeCode SDK — Conversation Loop
 *
 * Implements the tool-calling conversation loop.
 * Manages message history, stream processing, tool execution,
 * and turn management.
 */
import type { LLMConnector, StreamEvent, ToolDefinition } from '../llm/types.js'
import type { Tool } from '../types/tool.js'
import type { Message } from '../types/message.js'
import { ToolRegistry } from '../tools/registry.js'

export interface LoopOptions {
  /** Maximum number of tool call turns (default: 50) */
  maxToolCallDepth?: number
  /** Abort signal for cancellation */
  signal?: AbortSignal
}

export interface LoopState {
  messages: Message[]
  toolCallCount: number
}

/**
 * Run the conversation loop: send messages to LLM, handle tool calls,
 * and stream events back.
 */
export async function* conversationLoop(
  llm: LLMConnector,
  systemPrompt: string | undefined,
  messages: Message[],
  tools: ToolRegistry,
  options: LoopOptions = {},
): AsyncIterable<StreamEvent> {
  const maxDepth = options.maxToolCallDepth ?? 50
  const signal = options.signal ?? new AbortController().signal
  let depth = 0

  while (depth < maxDepth) {
    if (signal.aborted) {
      yield { type: 'error', error: new Error('Conversation aborted') }
      return
    }

    // Convert messages to API format
    const apiMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        return { role: m.role, content }
      })

    const apiTools: ToolDefinition[] = tools.toAPISchemas()

    // Track tool uses in this turn
    const toolUseBlocks: Array<{
      id: string
      name: string
      input: Record<string, unknown>
    }> = []

    let fullResponse = ''
    let pendingToolUse: {
      id: string
      name: string
      input: Record<string, unknown>
    } | null = null

    // Stream the response
    for await (const event of llm.send(systemPrompt, apiMessages, apiTools, { signal })) {
      switch (event.type) {
        case 'text':
          fullResponse += event.text
          yield event
          break

        case 'tool_use_start':
          pendingToolUse = {
            id: event.id,
            name: event.name,
            input: event.input,
          }
          yield event
          break

        case 'tool_use_end':
          if (pendingToolUse) {
            try {
              pendingToolUse.input = JSON.parse(event.output)
            } catch {
              // Use raw string if not valid JSON
            }
            toolUseBlocks.push(pendingToolUse)
            pendingToolUse = null
          }
          yield event
          break

        case 'thinking':
        case 'ping':
          yield event
          break

        case 'error':
          yield event
          return

        case 'done':
          yield event
          break
      }
    }

    // If no tool calls, we're done
    if (toolUseBlocks.length === 0) {
      return
    }

    // Execute tool calls
    depth++
    for (const toolUse of toolUseBlocks) {
      if (signal.aborted) {
        yield { type: 'error', error: new Error('Tool execution aborted') }
        return
      }

      const result = await tools.execute(toolUse.name, toolUse.input, {
        signal,
      })

      // Add tool result to messages
      // In a real implementation, we'd construct proper ToolResultMessage
      messages.push({
        id: `${Date.now()}-result-${toolUse.id}`,
        role: 'user',
        content: result.content,
        createdAt: new Date().toISOString(),
        // @ts-expect-error: tool result metadata
        _toolResult: true,
        _toolUseId: toolUse.id,
      })
    }
  }

  if (depth >= maxDepth) {
    yield {
      type: 'error',
      error: new Error(`Exceeded maximum tool call depth (${maxDepth})`),
    }
  }
}
