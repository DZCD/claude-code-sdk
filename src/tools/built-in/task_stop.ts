/**
 * ClaudeCode SDK — TaskStopTool
 *
 * Stops a task by setting its status to 'completed'.
 * In the reference Claude Code, this is used to stop background
 * running tasks. In the SDK, we set the task as completed since
 * there is no separate background task model.
 */
import { z } from 'zod'
import { getTask, getTaskListId, updateTask } from '../../task/engine.js'
import type { ToolContext, ToolResult } from '../../types/tool.js'
import { BaseTool } from '../base.js'

// ─── Schema ──────────────────────────────────────────────

export const taskStopSchema = z.object({
  taskId: z.string().min(1).describe('The ID of the task to stop'),
})

// ─── Output ───────────────────────────────────────────────

export interface TaskStopOutput {
  message: string
  taskId: string
  status: string
}

// ─── Tool Implementation ──────────────────────────────────

export class TaskStopTool extends BaseTool<typeof taskStopSchema, TaskStopOutput> {
  name = 'TaskStop'
  description = 'Stop a task by setting it to completed. Use this to mark a task as finished or to stop work on a task.'

  inputSchema = taskStopSchema

  async execute(input: z.infer<typeof taskStopSchema>, _context: ToolContext): Promise<ToolResult<TaskStopOutput>> {
    const { taskId } = input
    const taskListId = getTaskListId()

    const task = await getTask(taskListId, taskId)
    if (!task) {
      return {
        data: {
          message: `No task found with ID: ${taskId}`,
          taskId,
          status: 'not_found',
        },
        content: `No task found with ID: ${taskId}`,
        isError: true,
      }
    }

    if (task.status === 'completed') {
      return {
        data: {
          message: `Task #${taskId} is already completed`,
          taskId,
          status: 'completed',
        },
        content: `Task #${taskId} is already completed`,
      }
    }

    await updateTask(taskListId, taskId, { status: 'completed' })

    return {
      data: {
        message: `Successfully stopped task: ${taskId} (${task.subject})`,
        taskId,
        status: 'completed',
      },
      content: `Successfully stopped task: ${taskId} (${task.subject})`,
    }
  }

  override isConcurrencySafe(): boolean {
    return true
  }
}
