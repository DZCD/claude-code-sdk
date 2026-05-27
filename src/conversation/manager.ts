/**
 * ClaudeCode SDK — Conversation Manager
 *
 * Manages a single conversation session with message history,
 * streaming, and automatic tool-calling loop.
 */
import type { LLMConnector, StreamEvent, TokenUsage } from '../llm/types.js'
import type { Message, Snowflake } from '../types/message.js'
import { createUserMessage, createAssistantMessage } from '../types/message.js'
import { ToolRegistry } from '../tools/registry.js'
import { conversationLoop, type LoopOptions } from './loop.js'

export class ConversationManager {
  private readonly _messages: Message[] = []
  private _tokenUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 }

  constructor(
    private readonly _llm: LLMConnector,
    private readonly _tools: ToolRegistry,
    private readonly _systemPrompt?: string,
  ) {}

  /**
   * Send a user message and get a streaming response.
   * Automatically handles the tool-calling loop.
   */
  async *send(
    message: string,
    options?: LoopOptions,
  ): AsyncIterable<StreamEvent> {
    // Add user message to history
    const userMsg = createUserMessage(message)
    this._messages.push(userMsg)

    // Run the conversation loop
    for await (const event of conversationLoop(
      this._llm,
      this._systemPrompt,
      this._messages,
      this._tools,
      options,
    )) {
      if (event.type === 'done') {
        this._tokenUsage = {
          inputTokens: this._tokenUsage.inputTokens + (event.usage?.inputTokens ?? 0),
          outputTokens: this._tokenUsage.outputTokens + (event.usage?.outputTokens ?? 0),
        }
      }
      yield event
    }
  }

  /** Get the conversation history */
  getHistory(): Message[] {
    return [...this._messages]
  }

  /** Reset the conversation */
  reset(): void {
    this._messages.length = 0
    this._tokenUsage = { inputTokens: 0, outputTokens: 0 }
  }

  /** Get current token usage */
  getTokenUsage(): TokenUsage {
    return { ...this._tokenUsage }
  }

  /** Manually add a message to the history */
  addMessage(msg: Message): void {
    this._messages.push(msg)
  }

  /** Get the number of messages in the conversation */
  get messageCount(): number {
    return this._messages.length
  }
}
