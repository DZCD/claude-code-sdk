/**
 * ClaudeCode SDK — TaskCreateTool
 *
 * Creates a new task in the task list with subject, description,
 * and optional activeForm/metadata.
 */
import { z } from 'zod'
import { createTask, getTaskListId } from '../../task/engine.js'
import type { ToolContext, ToolResult } from '../../types/tool.js'
import { BaseTool } from '../base.js'

// ─── Schema ──────────────────────────────────────────────

export const taskCreateSchema = z.object({
  subject: z.string().min(1).describe('A brief title for the task'),
  description: z.string().min(1).describe('What needs to be done'),
  activeForm: z.string().optional().describe('Present continuous form shown when in_progress (e.g., "Running tests")'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Arbitrary metadata to attach to the task'),
})

// ─── Output ───────────────────────────────────────────────

export interface TaskCreateOutput {
  taskId: string
  status: string
  subject: string
}

// ─── Tool Implementation ──────────────────────────────────

export class TaskCreateTool extends BaseTool<typeof taskCreateSchema, TaskCreateOutput> {
  name = 'TaskCreate'
  description =
    'Create a new task in the task list. Use this tool to track progress, organize complex tasks, and demonstrate thoroughness. Tasks are created with status "pending".'

  inputSchema = taskCreateSchema

  async execute(input: z.infer<typeof taskCreateSchema>, _context: ToolContext): Promise<ToolResult<TaskCreateOutput>> {
    const { subject, description, activeForm, metadata } = input
    const taskListId = getTaskListId()

    const taskId = await createTask(taskListId, {
      subject,
      description,
      activeForm,
      metadata,
    })

    return {
      data: {
        taskId,
        status: 'pending',
        subject,
      },
      content: `Task #${taskId} created successfully: ${subject}`,
    }
  }

  override isConcurrencySafe(): boolean {
    return true
  }
}
