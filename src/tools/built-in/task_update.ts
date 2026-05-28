/**
 * ClaudeCode SDK — TaskUpdateTool
 *
 * Updates an existing task. Supports changing status, subject,
 * description, owner, metadata, and managing dependencies.
 */
import { z } from 'zod'
import type { ToolContext, ToolResult } from '../../types/tool.js'
import type { TaskStatus } from '../../types/task.js'
import { BaseTool } from '../base.js'
import {
  blockTask,
  deleteTask,
  getTask,
  getTaskListId,
  updateTask,
} from '../../task/engine.js'

// ─── Schema ──────────────────────────────────────────────

export const taskUpdateSchema = z.object({
  taskId: z.string().min(1).describe('The ID of the task to update'),
  subject: z.string().optional().describe('New subject for the task'),
  description: z.string().optional().describe('New description for the task'),
  activeForm: z
    .string()
    .optional()
    .describe('Present continuous form shown when in_progress (e.g., "Running tests")'),
  status: z
    .enum(['pending', 'in_progress', 'completed', 'deleted'])
    .optional()
    .describe('New status for the task. Use "deleted" to remove the task.'),
  addBlocks: z
    .array(z.string())
    .optional()
    .describe('Task IDs that this task blocks (depends on these tasks)'),
  addBlockedBy: z
    .array(z.string())
    .optional()
    .describe('Task IDs that block this task'),
  owner: z.string().optional().describe('New owner for the task'),
  metadata: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Metadata keys to merge into the task. Set a key to null to delete it.'),
  output: z.string().optional().describe('Output data to attach to the task'),
})

// ─── Output ───────────────────────────────────────────────

export interface TaskUpdateOutput {
  success: boolean
  taskId: string
  updatedFields: string[]
  error?: string
  statusChange?: {
    from: string
    to: string
  }
}

// ─── Tool Implementation ──────────────────────────────────

export class TaskUpdateTool extends BaseTool<typeof taskUpdateSchema, TaskUpdateOutput> {
  name = 'TaskUpdate'
  description =
    'Update an existing task. Change status, subject, description, owner, or manage dependencies between tasks.'

  inputSchema = taskUpdateSchema

  async execute(
    input: z.infer<typeof taskUpdateSchema>,
    _context: ToolContext,
  ): Promise<ToolResult<TaskUpdateOutput>> {
    const {
      taskId,
      subject,
      description,
      activeForm,
      status,
      owner,
      addBlocks,
      addBlockedBy,
      metadata,
      output,
    } = input

    const taskListId = getTaskListId()

    // Check if task exists
    const existingTask = await getTask(taskListId, taskId)
    if (!existingTask) {
      return {
        data: {
          success: false,
          taskId,
          updatedFields: [],
          error: 'Task not found',
        },
        content: `Task #${taskId} not found`,
      }
    }

    const updatedFields: string[] = []

    // Handle deletion
    if (status === 'deleted') {
      const deleted = await deleteTask(taskListId, taskId)
      return {
        data: {
          success: deleted,
          taskId,
          updatedFields: deleted ? ['deleted'] : [],
          error: deleted ? undefined : 'Failed to delete task',
          statusChange: deleted
            ? { from: existingTask.status, to: 'deleted' }
            : undefined,
        },
        content: deleted
          ? `Task #${taskId} deleted successfully`
          : `Failed to delete task #${taskId}`,
      }
    }

    // Build updates
    const updates: {
      subject?: string
      description?: string
      activeForm?: string
      status?: TaskStatus
      owner?: string
      metadata?: Record<string, unknown>
      output?: string
    } = {}

    if (subject !== undefined && subject !== existingTask.subject) {
      updates.subject = subject
      updatedFields.push('subject')
    }
    if (description !== undefined && description !== existingTask.description) {
      updates.description = description
      updatedFields.push('description')
    }
    if (activeForm !== undefined && activeForm !== existingTask.activeForm) {
      updates.activeForm = activeForm
      updatedFields.push('activeForm')
    }
    if (owner !== undefined && owner !== existingTask.owner) {
      updates.owner = owner
      updatedFields.push('owner')
    }
    if (output !== undefined && output !== existingTask.output) {
      updates.output = output
      updatedFields.push('output')
    }

    // Handle metadata merge
    if (metadata !== undefined) {
      const merged = { ...(existingTask.metadata ?? {}) }
      for (const [key, value] of Object.entries(metadata)) {
        if (value === null) {
          delete merged[key]
        } else {
          merged[key] = value
        }
      }
      updates.metadata = merged
      updatedFields.push('metadata')
    }

    if (status !== undefined && status !== existingTask.status) {
      updates.status = status as TaskStatus
      updatedFields.push('status')
    }

    // Apply updates
    const statusChange =
      updates.status !== undefined
        ? { from: existingTask.status, to: updates.status }
        : undefined

    if (Object.keys(updates).length > 0) {
      await updateTask(taskListId, taskId, updates)
    }

    // Add blocks if provided
    if (addBlocks && addBlocks.length > 0) {
      const newBlocks = addBlocks.filter(
        id => !existingTask.blocks.includes(id),
      )
      for (const blockId of newBlocks) {
        await blockTask(taskListId, taskId, blockId)
      }
      if (newBlocks.length > 0) {
        updatedFields.push('blocks')
      }
    }

    // Add blockedBy if provided
    if (addBlockedBy && addBlockedBy.length > 0) {
      const newBlockedBy = addBlockedBy.filter(
        id => !existingTask.blockedBy.includes(id),
      )
      for (const blockerId of newBlockedBy) {
        await blockTask(taskListId, blockerId, taskId)
      }
      if (newBlockedBy.length > 0) {
        updatedFields.push('blockedBy')
      }
    }

    return {
      data: {
        success: true,
        taskId,
        updatedFields,
        statusChange,
      },
      content: `Updated task #${taskId} ${updatedFields.join(', ')}`,
    }
  }

  override isConcurrencySafe(): boolean {
    return true
  }
}
