import type { HookRegistry } from '../hooks/registry.js'
import { executePostToolHooks, executePreToolHooks } from '../hooks/registry.js'
/**
 * ClaudeCode SDK — Conversation Loop
 *
 * Implements the tool-calling conversation loop.
 * Manages message history, stream processing, tool execution,
 * and turn management.
 */
import type { LLMConnector, StreamEvent, ToolDefinition } from '../llm/types.js'
import type { ToolRegistry } from '../tools/registry.js'
import type { ContentBlock, Message, ThinkingBlock, ToolUseBlock } from '../types/message.js'
import { createAssistantMessage, createToolResultMessage } from '../types/message.js'
import type { Tool } from '../types/tool.js'

export interface LoopOptions {
  /** Maximum number of tool call turns (default: 50) */
  maxToolCallDepth?: number
  /** Abort signal for cancellation */
  signal?: AbortSignal
  /** Optional hook registry for pre/post tool hooks */
  hooks?: HookRegistry
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
  const hooks = options.hooks
  let depth = 0

  while (depth < maxDepth) {
    if (signal.aborted) {
      yield { type: 'error', error: new Error('Conversation aborted') }
      return
    }

    // Convert messages to Anthropic API format
    // - User text:  { role: 'user', content: 'text' }
    // - User tool_result: { role: 'user', content: [{ type: 'tool_result', tool_use_id, content }] }
    // - Assistant text: { role: 'assistant', content: [{ type: 'text', text }] }
    // - Assistant tool_use: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] }
    const apiMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        if (typeof m.content === 'string') {
          // User text message — string content
          return { role: m.role, content: m.content }
        }

        // ContentBlock[] — convert each block to API format
        const blocks = m.content.map((block) => {
          switch (block.type) {
            case 'tool_result':
              return {
                type: 'tool_result',
                tool_use_id: block.toolUseId,
                content: block.content,
              }
            case 'tool_use':
              return {
                type: 'tool_use',
                id: block.id,
                name: block.name,
                input: block.input,
              }
            case 'text':
              return {
                type: 'text',
                text: block.text,
              }
            case 'thinking':
              return {
                type: 'thinking',
                thinking: block.thinking,
              }
            default:
              // Fallback: unknown block type
              return block
          }
        })
        return { role: m.role, content: blocks }
      })

    const apiTools: ToolDefinition[] = tools.toAPISchemas()

    // Track tool uses in this turn
    const toolUseBlocks: Array<{
      id: string
      name: string
      input: Record<string, unknown>
    }> = []

    let fullResponse = ''
    let thinkingText = ''
    let pendingToolUse: {
      id: string
      name: string
      input: Record<string, unknown>
    } | null = null

    // Stream the response
    for await (const event of llm.send(systemPrompt, apiMessages, apiTools, {
      signal,
    })) {
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
          if (event.thinking) {
            thinkingText += event.thinking
          }
          yield event
          break

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

    // Store assistant response in messages (includes text + thinking + tool_use blocks)
    const assistantBlocks: ContentBlock[] = []
    if (thinkingText) {
      assistantBlocks.push({ type: 'thinking', thinking: thinkingText } as ThinkingBlock)
    }
    if (fullResponse) {
      assistantBlocks.push({ type: 'text', text: fullResponse })
    }
    for (const toolUse of toolUseBlocks) {
      assistantBlocks.push({
        type: 'tool_use',
        id: toolUse.id,
        name: toolUse.name,
        input: toolUse.input,
      } as ToolUseBlock)
    }
    // Only push non-empty assistant messages
    if (assistantBlocks.length > 0) {
      messages.push(createAssistantMessage(assistantBlocks))
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

      // Phase 3C: Pre-tool hook
      if (hooks) {
        const hookResult = await executePreToolHooks(hooks, toolUse.name, toolUse.input)
        if (!hookResult.allowed) {
          yield {
            type: 'error',
            error: new Error(`Tool ${toolUse.name} blocked by hook: ${hookResult.error ?? 'blocked'}`),
          }
          return
        }
        if (hookResult.modifiedInput) {
          toolUse.input = hookResult.modifiedInput
        }
      }

      const result = await tools.execute(toolUse.name, toolUse.input, {
        signal,
      })

      // Phase 3C: Post-tool hook
      if (hooks) {
        await executePostToolHooks(hooks, toolUse.name, toolUse.input, result)
      }

      // Add tool result to messages (properly typed ToolResultBlock[])
      messages.push(createToolResultMessage([{
        type: 'tool_result',
        toolUseId: toolUse.id,
        content: typeof result.content === 'string' ? result.content : JSON.stringify(result.content),
      }]))
    }
  }

  if (depth >= maxDepth) {
    yield {
      type: 'error',
      error: new Error(`Exceeded maximum tool call depth (${maxDepth})`),
    }
  }
}
