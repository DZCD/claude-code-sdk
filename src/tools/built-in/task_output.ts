/**
 * ClaudeCode SDK — TaskOutputTool
 *
 * Retrieves the captured output from a task. This is useful
 * for reading the results of a completed task's execution.
 */
import { z } from 'zod'
import { getTask, getTaskListId } from '../../task/engine.js'
import type { ToolContext, ToolResult } from '../../types/tool.js'
import { BaseTool } from '../base.js'

// ─── Schema ──────────────────────────────────────────────

export const taskOutputSchema = z.object({
  taskId: z.string().min(1).describe('The ID of the task to get output from'),
})

// ─── Output ───────────────────────────────────────────────

export interface TaskOutputOutput {
  taskId: string
  subject: string
  status: string
  output: string | null
  exitCode?: number | null
}

// ─── Tool Implementation ──────────────────────────────────

export class TaskOutputTool extends BaseTool<typeof taskOutputSchema, TaskOutputOutput> {
  name = 'TaskOutput'
  description = 'Retrieve the captured output from a task. Use this to read results after a task has been completed.'

  inputSchema = taskOutputSchema

  async execute(input: z.infer<typeof taskOutputSchema>, _context: ToolContext): Promise<ToolResult<TaskOutputOutput>> {
    const { taskId } = input
    const taskListId = getTaskListId()

    const task = await getTask(taskListId, taskId)
    if (!task) {
      return {
        data: {
          taskId,
          subject: '',
          status: 'not_found',
          output: null,
        },
        content: `No task found with ID: ${taskId}`,
        isError: true,
      }
    }

    const output = task.output ?? null

    return {
      data: {
        taskId: task.id,
        subject: task.subject,
        status: task.status,
        output,
      },
      content: output ? `<output>\n${output}\n</output>` : `Task #${task.id} (${task.subject}) has no output`,
    }
  }

  override isReadOnly(): boolean {
    return true
  }

  override isConcurrencySafe(): boolean {
    return true
  }
}
