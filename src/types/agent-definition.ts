/**
 * AgentDefinition — SDK-level agent type without UI concerns.
 *
 * Defines a custom subagent that can be invoked via the Agent tool.
 * Includes tool restrictions, model selection, MCP servers, skills,
 * and various behavioral configuration options.
 *
 * @see /home/user/.duclaw/workspace/claude-code-source-code/src/entrypoints/sdk/coreSchemas.ts lines 1103-1183
 * @see /home/user/.duclaw/workspace/claude-code-source-code/src/entrypoints/sdk/coreTypes.generated.ts
 * @see /home/user/.duclaw/workspace/claude-code-source-code/src/tools/AgentTool/loadAgentsDir.ts
 */
import { z } from 'zod'

// ============================================================================
// Types
// ============================================================================

/** MCP server specification — either a simple name or a full server config */
export type AgentMcpServerSpec = z.infer<typeof AgentMcpServerSpecSchema>

/** Full agent definition including tools, model, skills, and behavioral config */
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>

// ============================================================================
// Schemas
// ============================================================================

/**
 * Schema for MCP server transport configuration (stdio type).
 * Used within AgentMcpServerSpec object form.
 */
const McpStdioConfigSchema = z.object({
  type: z.literal('stdio').optional(),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
})

/**
 * Schema for MCP server transport configuration (SSE type).
 */
const McpSSEConfigSchema = z.object({
  type: z.literal('sse'),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
})

/**
 * MCP server config for process transport — union of stdio and SSE.
 * Used as the value type in AgentMcpServerSpec object form.
 */
const McpServerConfigForProcessTransportSchema = z.union([McpStdioConfigSchema, McpSSEConfigSchema])

/**
 * MCP server specification — can be a simple server name (string)
 * or a full configuration map keyed by server name.
 */
export const AgentMcpServerSpecSchema = z.union([
  z.string(),
  z.record(z.string(), McpServerConfigForProcessTransportSchema),
])

/**
 * Effort level for reasoning. Either a named level or an integer.
 */
const EffortSchema = z.union([z.enum(['low', 'medium', 'high', 'max']), z.number().int()])

/**
 * Agent memory scope — determines where agent memory files are loaded from.
 */
const AgentMemorySchema = z.enum(['user', 'project', 'local'])

/**
 * Agent definition schema.
 *
 * Required: description, prompt.
 * Optional: tools, disallowedTools, model, mcpServers, skills, initialPrompt,
 *           maxTurns, background, memory, effort, permissionMode,
 *           criticalSystemReminder_EXPERIMENTAL.
 */
export const AgentDefinitionSchema = z.object({
  /** Natural language description of when to use this agent */
  description: z.string(),

  /** Array of allowed tool names. If omitted, inherits all tools from parent */
  tools: z.array(z.string()).optional(),

  /** Array of tool names to explicitly disallow for this agent */
  disallowedTools: z.array(z.string()).optional(),

  /** The agent's system prompt */
  prompt: z.string(),

  /** Model alias (e.g. 'sonnet') or full model ID. If omitted, uses main model */
  model: z.string().optional(),

  /** MCP servers available to this agent */
  mcpServers: z.array(AgentMcpServerSpecSchema).optional(),

  /** Experimental: Critical reminder added to system prompt */
  criticalSystemReminder_EXPERIMENTAL: z.string().optional(),

  /** Array of skill names to preload into the agent context */
  skills: z.array(z.string()).optional(),

  /** Auto-submitted as the first user turn when this agent is the main thread agent */
  initialPrompt: z.string().optional(),

  /** Maximum number of agentic turns (API round-trips) before stopping */
  maxTurns: z.number().int().positive().optional(),

  /** Run this agent as a background task (non-blocking, fire-and-forget) */
  background: z.boolean().optional(),

  /** Scope for auto-loading agent memory files */
  memory: AgentMemorySchema.optional(),

  /** Reasoning effort level for this agent */
  effort: EffortSchema.optional(),

  /** Permission mode controlling how tool executions are handled */
  permissionMode: z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk']).optional(),
})
