/**
 * ClaudeCode SDK — TaskGetTool
 *
 * Retrieves a task by its ID, returning full task details.
 */
import { z } from 'zod'
import { getTask, getTaskListId } from '../../task/engine.js'
import type { Task } from '../../types/task.js'
import type { ToolContext, ToolResult } from '../../types/tool.js'
import { BaseTool } from '../base.js'

// ─── Schema ──────────────────────────────────────────────

export const taskGetSchema = z.object({
  taskId: z.string().min(1).describe('The ID of the task to retrieve'),
})

// ─── Output ───────────────────────────────────────────────

export type TaskGetOutput = {
  task: Pick<
    Task,
    | 'id'
    | 'subject'
    | 'description'
    | 'status'
    | 'blocks'
    | 'blockedBy'
    | 'owner'
    | 'metadata'
    | 'output'
    | 'createdAt'
    | 'updatedAt'
  > | null
}

// ─── Tool Implementation ──────────────────────────────────

export class TaskGetTool extends BaseTool<typeof taskGetSchema, TaskGetOutput> {
  name = 'TaskGet'
  description = 'Retrieve a task by its ID to see its current status, description, and dependencies.'

  inputSchema = taskGetSchema

  async execute(input: z.infer<typeof taskGetSchema>, _context: ToolContext): Promise<ToolResult<TaskGetOutput>> {
    const { taskId } = input
    const taskListId = getTaskListId()

    const task = await getTask(taskListId, taskId)

    if (!task) {
      return {
        data: { task: null },
        content: 'Task not found',
      }
    }

    return {
      data: { task },
      content: `Task #${task.id}: ${task.subject}\nStatus: ${task.status}\nDescription: ${task.description}`,
    }
  }

  override isReadOnly(): boolean {
    return true
  }

  override isConcurrencySafe(): boolean {
    return true
  }
}
