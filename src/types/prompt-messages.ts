/**
 * ClaudeCode SDK — Prompt Messages (PromptRequest + PromptResponse)
 *
 * Standardized prompt request/response structures for interactive
 * user elicitation (e.g., "Which file do you want to open?").
 *
 * Based on Claude Code's PromptRequestSchema and PromptResponseSchema
 * (src/utils/hooks.ts, src/entrypoints/sdk/coreSchemas.ts).
 */

// ─── Types ────────────────────────────────────────────

/** An option presented to the user in a prompt */
export interface PromptRequestOption {
  /** Unique key returned in the response when selected */
  key: string
  /** Display label shown to the user */
  label: string
  /** Optional description shown below the label */
  description?: string
}

/**
 * A prompt request sent to the user.
 *
 * The `prompt` field acts as a request ID discriminator.
 * Its presence marks the line as a prompt request.
 */
export interface PromptRequest {
  /** Request identifier — used to match response back to request */
  prompt: string
  /** The prompt message to display to the user */
  message: string
  /** Available options for the user to choose from */
  options: PromptRequestOption[]
}

/**
 * The user's response to a prompt request.
 *
 * Matches back to the request via `prompt_response` (the request's `prompt` ID).
 */
export interface PromptResponse {
  /** The request ID from the corresponding PromptRequest */
  prompt_response: string
  /** The key of the selected option */
  selected: string
}

// ─── Type Guards ──────────────────────────────────────

function hasStringField(obj: unknown, field: string): obj is Record<string, unknown> {
  if (!obj || typeof obj !== 'object') return false
  return typeof (obj as Record<string, unknown>)[field] === 'string'
}

/** Check if an object is a valid PromptRequest */
export function isPromptRequest(obj: unknown): obj is PromptRequest {
  if (!obj || typeof obj !== 'object') return false
  const o = obj as Record<string, unknown>
  return typeof o.prompt === 'string' &&
    typeof o.message === 'string' &&
    Array.isArray(o.options)
}

/** Check if an object is a valid PromptResponse */
export function isPromptResponse(obj: unknown): obj is PromptResponse {
  return hasStringField(obj, 'prompt_response') &&
    hasStringField(obj, 'selected')
}

// ─── Factory Functions ────────────────────────────────

/**
 * Create a PromptRequest.
 */
export function createPromptRequest(
  prompt: string,
  message: string,
  options: PromptRequestOption[],
): PromptRequest {
  return { prompt, message, options }
}

/**
 * Create a PromptResponse.
 */
export function createPromptResponse(
  promptResponse: string,
  selected: string,
): PromptResponse {
  return { prompt_response: promptResponse, selected }
}

// ─── Utilities ────────────────────────────────────────

/**
 * Extract the selected key from a PromptResponse.
 */
export function promptResponseToKey(response: PromptResponse): string {
  return response.selected
}
