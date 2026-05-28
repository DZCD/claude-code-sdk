/**
 * ClaudeCode SDK — Task Types
 *
 * Core type definitions for the Task subsystem.
 * Tasks are persistent, file-system-backed work items that track
 * progress through a pending → in_progress → completed lifecycle.
 */
import { z } from 'zod'

// ─── Task Status ──────────────────────────────────────────

export const TASK_STATUSES = ['pending', 'in_progress', 'completed'] as const

export const TaskStatusSchema = z.enum(TASK_STATUSES)
export type TaskStatus = z.infer<typeof TaskStatusSchema>

// ─── Task Interface ───────────────────────────────────────

/**
 * A task represents a unit of work tracked by the Task subsystem.
 * Tasks are stored as JSON files on disk with a sequential numeric ID.
 */
export interface Task {
  /** Unique sequential numeric task ID (e.g., "1", "2") */
  id: string

  /** Brief, actionable title in imperative form */
  subject: string

  /** Detailed description of what needs to be done */
  description: string

  /** Present continuous form for spinner display (e.g., "Running tests") */
  activeForm?: string

  /** Current task status: pending → in_progress → completed */
  status: TaskStatus

  /** Agent ID that owns/claimed this task */
  owner?: string

  /** Task IDs that this task blocks (depends on these tasks) */
  blocks: string[]

  /** Task IDs that block this task */
  blockedBy: string[]

  /** Arbitrary metadata attached to the task */
  metadata?: Record<string, unknown>

  /** Captured output from task execution */
  output?: string

  /** ISO timestamp of creation */
  createdAt: string

  /** ISO timestamp of last update */
  updatedAt: string
}

// ─── Zod Schema ───────────────────────────────────────────

/** Full Task Zod schema for runtime validation */
export const TaskSchema = z.object({
  id: z.string(),
  subject: z.string(),
  description: z.string(),
  activeForm: z.string().optional(),
  status: TaskStatusSchema,
  owner: z.string().optional(),
  blocks: z.array(z.string()),
  blockedBy: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()).optional(),
  output: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

// ─── Create Task Input ────────────────────────────────────

/** Input data for creating a new task (id, status, timestamps are auto-generated) */
export interface CreateTaskInput {
  subject: string
  description: string
  activeForm?: string
  owner?: string
  blocks?: string[]
  blockedBy?: string[]
  metadata?: Record<string, unknown>
}

// ─── Update Task Input ────────────────────────────────────

/** Input data for updating an existing task. All fields are optional. */
export interface UpdateTaskInput {
  subject?: string
  description?: string
  activeForm?: string
  status?: TaskStatus
  owner?: string
  blocks?: string[]
  blockedBy?: string[]
  metadata?: Record<string, unknown>
  output?: string
}

// ─── Task Engine Configuration ────────────────────────────

/** Configuration options for the Task engine */
export interface TaskEngineConfig {
  /** Base directory for task storage (default: ~/.claude/tasks) */
  baseDir?: string
  /** Task list identifier (default: 'default') */
  taskListId?: string
}
