/**
 * ClaudeCode SDK — Attribution Manager
 *
 * Message source tracking, conversation round attribution,
 * attribution metadata and texts generation.
 *
 * Adapted from Claude Code reference:
 * - src/utils/attribution.ts (getAttributionTexts, countUserPromptsInMessages)
 * - src/utils/attributionHooks.ts
 * - src/utils/attributionTrailer.ts
 *
 * Stripped of Claude Code runtime dependencies (AppState, transcript, settings):
 * uses lightweight in-memory counters and configurable model name.
 */

// ─── Product Constants ───────────────────────────────────

export const PRODUCT_URL = 'https://claude.ai'

// ─── Types ───────────────────────────────────────────────

/** Message source type — core attribution dimension */
export type MessageSource = 'user' | 'assistant' | 'tool' | 'system'

/** Attribution mode */
export type AttributionMode = 'none' | 'simple' | 'full'

/** Single message attribution metadata */
export interface AttributionMetadata {
  source: MessageSource
  turnNumber: number
  timestamp: string
  sourceLabel?: string
}

/** Attribution statistics */
export interface AttributionStats {
  totalTurns: number
  userMessageCount: number
  assistantMessageCount: number
  toolCallCount: number
  uniqueTools: string[]
  startTime: string
  lastActivityTime: string
}

/** Attribution texts for commit/PR attribution */
export interface AttributionTexts {
  commit: string
  pr: string
}

/** Serializable snapshot of attribution state */
export interface AttributionSnapshot {
  totalTurns: number
  userMessageCount: number
  assistantMessageCount: number
  toolCallCount: number
  uniqueTools: string[]
  startTime: string
  lastActivityTime: string
  modelName: string
  mode: AttributionMode
}

// ─── Defaults ─────────────────────────────────────────────

const DEFAULT_ATTRIBUTION_TEXTS: AttributionTexts = {
  commit: 'Co-Authored-By: Claude <noreply@anthropic.com>',
  pr: 'Generated with Claude Code SDK',
}

// ─── AttributionManager ─────────────────────────────────

export class AttributionManager {
  private _turnNumber = 0
  private _userMessageCount = 0
  private _assistantMessageCount = 0
  private _toolCallCount = 0
  private _uniqueTools = new Set<string>()
  private _startTime: string
  private _lastActivityTime: string
  private _modelName: string
  private _mode: AttributionMode
  private _hasUserThisTurn = false

  constructor(config?: { mode?: AttributionMode; modelName?: string }) {
    this._mode = config?.mode ?? 'simple'
    this._modelName = config?.modelName ?? 'Claude'
    const now = new Date().toISOString()
    this._startTime = now
    this._lastActivityTime = now
  }

  /**
   * Record a message and return its attribution metadata.
   * In 'none' mode, returns empty metadata and does not count.
   */
  recordMessage(source: MessageSource, options?: { toolName?: string }): AttributionMetadata {
    const now = new Date().toISOString()
    this._lastActivityTime = now

    if (this._mode === 'none') {
      return { source, turnNumber: 0, timestamp: now }
    }

    // Turn tracking: each new user message starts a new turn
    if (source === 'user') {
      this._turnNumber++
      this._userMessageCount++
      this._hasUserThisTurn = true
    } else if (source === 'assistant') {
      this._assistantMessageCount++
    } else if (source === 'tool') {
      this._toolCallCount++
      if (options?.toolName) {
        this._uniqueTools.add(options.toolName)
      }
    }

    return {
      source,
      turnNumber: this._turnNumber,
      timestamp: now,
      sourceLabel: source === 'tool' || source === 'assistant' ? options?.toolName : undefined,
    }
  }

  /** Get the current turn number */
  getCurrentTurn(): number {
    return this._turnNumber
  }

  /** Get attribution statistics */
  getStats(): AttributionStats {
    return {
      totalTurns: this._turnNumber,
      userMessageCount: this._userMessageCount,
      assistantMessageCount: this._assistantMessageCount,
      toolCallCount: this._toolCallCount,
      uniqueTools: Array.from(this._uniqueTools),
      startTime: this._startTime,
      lastActivityTime: this._lastActivityTime,
    }
  }

  /** Generate attribution texts for commit/PR */
  getAttributionTexts(): AttributionTexts {
    if (this._mode === 'none') {
      return { commit: '', pr: '' }
    }

    const modelRef = this._modelName !== 'Claude' ? this._modelName : 'Claude'

    return {
      commit: `Co-Authored-By: ${modelRef} <noreply@anthropic.com>`,
      pr: `🤖 Generated with [Claude Code SDK](${PRODUCT_URL})`,
    }
  }

  /** Reset all attribution state */
  reset(): void {
    this._turnNumber = 0
    this._userMessageCount = 0
    this._assistantMessageCount = 0
    this._toolCallCount = 0
    this._uniqueTools.clear()
    this._hasUserThisTurn = false
    const now = new Date().toISOString()
    this._startTime = now
    this._lastActivityTime = now
  }

  /** Serialize attribution state to a snapshot */
  serialize(): AttributionSnapshot {
    return {
      totalTurns: this._turnNumber,
      userMessageCount: this._userMessageCount,
      assistantMessageCount: this._assistantMessageCount,
      toolCallCount: this._toolCallCount,
      uniqueTools: Array.from(this._uniqueTools),
      startTime: this._startTime,
      lastActivityTime: this._lastActivityTime,
      modelName: this._modelName,
      mode: this._mode,
    }
  }

  /** Deserialize attribution state from a snapshot */
  static deserialize(snapshot: AttributionSnapshot): AttributionManager {
    const mgr = new AttributionManager({
      mode: snapshot.mode,
      modelName: snapshot.modelName,
    })
    mgr._turnNumber = snapshot.totalTurns
    mgr._userMessageCount = snapshot.userMessageCount
    mgr._assistantMessageCount = snapshot.assistantMessageCount
    mgr._toolCallCount = snapshot.toolCallCount
    mgr._uniqueTools = new Set(snapshot.uniqueTools)
    mgr._startTime = snapshot.startTime
    mgr._lastActivityTime = snapshot.lastActivityTime
    return mgr
  }
}
