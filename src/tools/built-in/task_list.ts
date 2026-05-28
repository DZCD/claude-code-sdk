/**
 * ClaudeCode SDK — TaskListTool
 *
 * Lists all tasks for the current task list, filtered to
 * remove internal metadata tasks.
 */
import { z } from 'zod'
import type { ToolContext, ToolResult } from '../../types/tool.js'
import { BaseTool } from '../base.js'
import { getTaskListId, listTasks } from '../../task/engine.js'
import type { Task } from '../../types/task.js'

// ─── Schema ──────────────────────────────────────────────

export const taskListSchema = z.object({})

// ─── Output ───────────────────────────────────────────────

export interface TaskListOutput {
  tasks: Array<{
    id: string
    subject: string
    status: string
    owner?: string
    blockedBy: string[]
    blocks: string[]
  }>
}

// ─── Tool Implementation ──────────────────────────────────

export class TaskListTool extends BaseTool<typeof taskListSchema, TaskListOutput> {
  name = 'TaskList'
  description =
    'List all tasks in the current task list. Use this to see the status of all tasks, check dependencies, and find available work.'

  inputSchema = taskListSchema

  async execute(
    _input: z.infer<typeof taskListSchema>,
    _context: ToolContext,
  ): Promise<ToolResult<TaskListOutput>> {
    const taskListId = getTaskListId()

    const allTasks = await listTasks(taskListId)

    // Filter out internal metadata tasks and build resolved task ID set
    const visibleTasks = allTasks.filter(t => !t.metadata?._internal)
    const resolvedTaskIds = new Set(
      visibleTasks.filter(t => t.status === 'completed').map(t => t.id),
    )

    const tasks = visibleTasks.map(task => ({
      id: task.id,
      subject: task.subject,
      status: task.status,
      owner: task.owner,
      blockedBy: task.blockedBy.filter(id => !resolvedTaskIds.has(id)),
      blocks: task.blocks,
    }))

    return {
      data: { tasks },
      content: tasks.length === 0
        ? 'No tasks found'
        : tasks.map(t => {
            const owner = t.owner ? ` (${t.owner})` : ''
            const blocked = t.blockedBy.length > 0
              ? ` [blocked by ${t.blockedBy.map(id => `#${id}`).join(', ')}]`
              : ''
            return `#${t.id} [${t.status}] ${t.subject}${owner}${blocked}`
          }).join('\n'),
    }
  }

  override isReadOnly(): boolean {
    return true
  }

  override isConcurrencySafe(): boolean {
    return true
  }
}
