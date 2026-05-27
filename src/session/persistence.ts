import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
/**
 * ClaudeCode SDK — Session Persistence
 *
 * Session state serialization/deserialization, save/load,
 * session restore logic, and interruption detection.
 *
 * Adapted from Claude Code reference:
 * - src/utils/conversationRecovery.ts (deserializeMessages, detectTurnInterruption, loadConversationForResume)
 *
 * Simplified for SDK use:
 * - Uses JSON file storage instead of transcript jsonl format
 * - No dependency on AppState, sidechains, or Claude Code runtime
 * - Messages stored as-is using SDK Message types
 */
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ContentBlock, Message, TokenUsage } from '../types/message.js'

// ─── Types ───────────────────────────────────────────────

/** Serializable message for persistence */
export interface SerializedMessage {
  id: string
  role: string
  content: string | ContentBlock[] | unknown
  createdAt: string
  metadata?: Record<string, unknown>
}

/** Session metadata */
export interface SessionMetadata {
  id: string
  label?: string
  tags?: string[]
  modelName?: string
  systemPrompt?: string
  customData?: Record<string, unknown>
}

/** Session state snapshot — used for persistence */
export interface SessionSnapshot {
  id: string
  createdAt: string
  updatedAt: string
  messageCount: number
  tokenUsage: TokenUsage
  messages: SerializedMessage[]
  metadata: SessionMetadata
  attribution?: {
    totalTurns: number
    userMessageCount: number
    assistantMessageCount: number
    toolCallCount: number
    uniqueTools: string[]
  }
}

/** Session restore result */
export interface SessionRestoreResult {
  session: SessionSnapshot
  messageCount: number
  totalTokens: number
}

/** Session status */
export type SessionStatus = 'active' | 'paused' | 'completed' | 'archived'

/** Session list entry */
export interface SessionListEntry {
  id: string
  label?: string
  createdAt: string
  status: SessionStatus
  messageCount: number
}

/** Interruption detection result */
export interface InterruptionResult {
  interrupted: boolean
  lastTurnComplete: boolean
}

// ─── SessionPersistence ─────────────────────────────────

export class SessionPersistence {
  private readonly _storageDir: string

  constructor(storageDir?: string) {
    this._storageDir = storageDir ?? join(process.cwd(), '.sessions')
  }

  /**
   * Get the storage directory path
   */
  get storageDir(): string {
    return this._storageDir
  }

  /**
   * Ensure storage directory exists
   */
  private async ensureDir(): Promise<void> {
    if (!existsSync(this._storageDir)) {
      await mkdir(this._storageDir, { recursive: true })
    }
  }

  /**
   * Get the file path for a session
   */
  private sessionPath(sessionId: string): string {
    return join(this._storageDir, `${sessionId}.json`)
  }

  /**
   * Build a session snapshot from messages and token usage
   */
  buildSnapshot(messages: Message[], tokenUsage: TokenUsage, metadata?: Partial<SessionMetadata>): SessionSnapshot {
    const id = metadata?.id ?? randomUUID()
    const now = new Date().toISOString()

    return {
      id,
      createdAt: now,
      updatedAt: now,
      messageCount: messages.length,
      tokenUsage: { ...tokenUsage },
      messages: messages.map((m) => {
        const msg = m as { id?: string; createdAt?: string }
        return {
          id: msg.id ?? randomUUID(),
          role: m.role,
          content: m.content,
          createdAt: msg.createdAt ?? new Date().toISOString(),
        }
      }),
      metadata: {
        id,
        label: metadata?.label,
        tags: metadata?.tags,
        modelName: metadata?.modelName,
        systemPrompt: metadata?.systemPrompt,
        customData: metadata?.customData,
      },
    }
  }

  /**
   * Save a session snapshot to disk
   */
  async save(snapshot: SessionSnapshot): Promise<string> {
    await this.ensureDir()

    // Update timestamps
    snapshot.updatedAt = new Date().toISOString()

    const filePath = this.sessionPath(snapshot.id)
    await writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf-8')
    return snapshot.id
  }

  /**
   * Load a session snapshot from disk
   */
  async load(sessionId: string): Promise<SessionSnapshot | null> {
    const filePath = this.sessionPath(sessionId)

    if (!existsSync(filePath)) {
      return null
    }

    try {
      const data = await readFile(filePath, 'utf-8')
      return JSON.parse(data) as SessionSnapshot
    } catch {
      return null
    }
  }

  /**
   * List all saved sessions
   */
  async listSessions(): Promise<SessionListEntry[]> {
    await this.ensureDir()

    const files = await readdir(this._storageDir)
    const jsonFiles = files.filter((f) => f.endsWith('.json'))

    const entries: SessionListEntry[] = []

    for (const file of jsonFiles) {
      try {
        const data = await readFile(join(this._storageDir, file), 'utf-8')
        const snapshot = JSON.parse(data) as SessionSnapshot
        entries.push({
          id: snapshot.id,
          label: snapshot.metadata.label,
          createdAt: snapshot.createdAt,
          status: (snapshot as unknown as { status?: SessionStatus }).status ?? 'active',
          messageCount: snapshot.messageCount,
        })
      } catch {
        // Skip invalid files
      }
    }

    // Sort by creation time, newest first
    entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    return entries
  }

  /**
   * Delete a saved session
   */
  async delete(sessionId: string): Promise<boolean> {
    const filePath = this.sessionPath(sessionId)

    if (!existsSync(filePath)) {
      return false
    }

    await unlink(filePath)
    return true
  }

  /**
   * Restore messages from a snapshot
   */
  restoreMessages(snapshot: SessionSnapshot): Message[] {
    return snapshot.messages.map((m) => ({
      id: m.id,
      role: m.role as Message['role'],
      content: typeof m.content === 'string' ? m.content : (m.content as ContentBlock[]),
      createdAt: m.createdAt,
    })) as Message[]
  }

  /**
   * Check if a snapshot can be restored (has messages)
   */
  canRestore(snapshot: SessionSnapshot): boolean {
    return snapshot.messageCount > 0 && snapshot.messages.length > 0
  }

  /**
   * Detect conversation interruption.
   * Adapted from conversationRecovery.ts detectTurnInterruption.
   *
   * Returns whether the conversation was interrupted mid-turn.
   * A conversation is "complete" if it ends on an assistant message.
   * A conversation is "interrupted" if it ends on a user message
   * (the user sent a message but never got a response).
   */
  detectInterruption(messages: Message[]): InterruptionResult {
    if (messages.length === 0) {
      return { interrupted: false, lastTurnComplete: true }
    }

    // Find the last non-system message
    let lastIdx = messages.length - 1
    while (lastIdx >= 0 && messages[lastIdx]!.role === 'system') {
      lastIdx--
    }

    if (lastIdx < 0) {
      return { interrupted: false, lastTurnComplete: true }
    }

    const lastMsg = messages[lastIdx]!

    if (lastMsg.role === 'assistant') {
      return { interrupted: false, lastTurnComplete: true }
    }

    if (lastMsg.role === 'user') {
      // Check if this is a tool result message (content is array of tool_result blocks)
      if (Array.isArray(lastMsg.content)) {
        const hasToolResult = lastMsg.content.some(
          (block: unknown) =>
            typeof block === 'object' &&
            block !== null &&
            'type' in block &&
            (block as { type: string }).type === 'tool_result',
        )
        if (hasToolResult) {
          // Tool result without follow-up assistant message — likely interrupted
          return { interrupted: true, lastTurnComplete: false }
        }
      }

      // Plain user message without assistant response — interrupted prompt
      return { interrupted: true, lastTurnComplete: false }
    }

    return { interrupted: false, lastTurnComplete: true }
  }
}
