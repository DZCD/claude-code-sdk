/**
 * ClaudeCode SDK — Task Engine
 *
 * File-system-backed JSON storage for tasks. Implements a simple
 * sequential ID system with CRUD operations. Tasks are stored as
 * individual JSON files in a directory structure:
 *
 *   {baseDir}/{taskListId}/{id}.json
 *
 * Default baseDir: ~/.claude/tasks
 */
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CreateTaskInput, Task, TaskEngineConfig, UpdateTaskInput } from '../types/task.js'
import { TaskSchema } from '../types/task.js'

// ─── High Water Mark ──────────────────────────────────────

const HIGH_WATER_MARK_FILE = '.highwatermark'

// ─── Config ───────────────────────────────────────────────

const _config: Required<TaskEngineConfig> = {
  baseDir: join(homedir(), '.claude', 'tasks'),
  taskListId: 'default',
}

/**
 * Configure the Task engine. Call once at initialization.
 */
export function configureTaskEngine(config: TaskEngineConfig): void {
  if (config.baseDir) {
    _config.baseDir = config.baseDir
  }
  if (config.taskListId) {
    _config.taskListId = config.taskListId
  }
}

/**
 * Get the current task list ID.
 */
export function getTaskListId(): string {
  return process.env.CLAUDE_CODE_TASK_LIST_ID || _config.taskListId
}

/**
 * Get the storage directory for a given task list.
 */
export function getTasksDir(taskListId: string): string {
  const sanitized = sanitizePathComponent(taskListId)
  return join(_config.baseDir, sanitized)
}

/**
 * Get the file path for a specific task.
 */
export function getTaskPath(taskListId: string, taskId: string): string {
  return join(getTasksDir(taskListId), `${taskId}.json`)
}

/**
 * Sanitize a string for safe use in file paths.
 */
function sanitizePathComponent(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, '-')
}

// ─── High Water Mark Management ───────────────────────────

function getHighWaterMarkPath(taskListId: string): string {
  return join(getTasksDir(taskListId), HIGH_WATER_MARK_FILE)
}

async function readHighWaterMark(taskListId: string): Promise<number> {
  const path = getHighWaterMarkPath(taskListId)
  try {
    const content = (await readFile(path, 'utf-8')).trim()
    const value = Number.parseInt(content, 10)
    return Number.isNaN(value) ? 0 : value
  } catch {
    return 0
  }
}

async function writeHighWaterMark(taskListId: string, value: number): Promise<void> {
  const path = getHighWaterMarkPath(taskListId)
  await writeFile(path, String(value))
}

// ─── Directory Management ─────────────────────────────────

/**
 * Ensure the tasks directory exists for a given task list.
 */
export async function ensureTasksDir(taskListId: string): Promise<void> {
  const dir = getTasksDir(taskListId)
  try {
    await mkdir(dir, { recursive: true })
  } catch {
    // Directory already exists or creation failed;
    // callers will surface errors from subsequent operations.
  }
}

// ─── ID Management ────────────────────────────────────────

/**
 * Find the highest task ID from existing task files.
 */
async function findHighestTaskIdFromFiles(taskListId: string): Promise<number> {
  const dir = getTasksDir(taskListId)
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return 0
  }
  let highest = 0
  for (const file of files) {
    if (!file.endsWith('.json') || file.startsWith('.')) {
      continue
    }
    const taskId = Number.parseInt(file.replace('.json', ''), 10)
    if (!Number.isNaN(taskId) && taskId > highest) {
      highest = taskId
    }
  }
  return highest
}

/**
 * Find the highest task ID considering both existing files and high water mark.
 */
async function findHighestTaskId(taskListId: string): Promise<number> {
  const [fromFiles, fromMark] = await Promise.all([
    findHighestTaskIdFromFiles(taskListId),
    readHighWaterMark(taskListId),
  ])
  return Math.max(fromFiles, fromMark)
}

/**
 * Generate the next sequential task ID.
 */
async function generateTaskId(taskListId: string): Promise<string> {
  const highest = await findHighestTaskId(taskListId)
  return String(highest + 1)
}

// ─── CRUD Operations ──────────────────────────────────────

/**
 * Create a new task. Returns the generated task ID.
 *
 * Task IDs are sequential numeric strings starting from "1".
 * The task is persisted as a JSON file on disk.
 */
export async function createTask(taskListId: string, input: CreateTaskInput): Promise<string> {
  await ensureTasksDir(taskListId)

  const id = await generateTaskId(taskListId)
  const now = new Date().toISOString()

  const task: Task = {
    id,
    subject: input.subject,
    description: input.description,
    activeForm: input.activeForm,
    status: 'pending',
    owner: input.owner,
    blocks: input.blocks ?? [],
    blockedBy: input.blockedBy ?? [],
    metadata: input.metadata,
    createdAt: now,
    updatedAt: now,
  }

  const path = getTaskPath(taskListId, id)
  await writeFile(path, JSON.stringify(task, null, 2))

  return id
}

/**
 * Retrieve a task by its ID.
 * Returns null if the task does not exist or cannot be parsed.
 */
export async function getTask(taskListId: string, taskId: string): Promise<Task | null> {
  const path = getTaskPath(taskListId, taskId)
  try {
    const content = await readFile(path, 'utf-8')
    const data = JSON.parse(content)
    const parsed = TaskSchema.safeParse(data)
    if (!parsed.success) {
      return null
    }
    return parsed.data
  } catch (e) {
    const nodeErr = e as NodeJS.ErrnoException
    if (nodeErr.code === 'ENOENT') {
      return null
    }
    // Other errors (permissions, etc.) — return null
    return null
  }
}

/**
 * List all tasks for a given task list.
 * Returns an empty array if the directory does not exist.
 */
export async function listTasks(taskListId: string): Promise<Task[]> {
  const dir = getTasksDir(taskListId)
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return []
  }
  const taskIds = files.filter((f) => f.endsWith('.json') && !f.startsWith('.')).map((f) => f.replace('.json', ''))

  const results = await Promise.all(taskIds.map((id) => getTask(taskListId, id)))
  return results.filter((t): t is Task => t !== null)
}

/**
 * Update an existing task with partial data.
 * Returns the updated task or null if the task does not exist.
 */
export async function updateTask(taskListId: string, taskId: string, updates: UpdateTaskInput): Promise<Task | null> {
  const existing = await getTask(taskListId, taskId)
  if (!existing) {
    return null
  }

  // Handle metadata merge: merge input metadata into existing metadata
  let metadata: Record<string, unknown> | undefined = existing.metadata ? { ...existing.metadata } : undefined
  if (updates.metadata !== undefined) {
    if (metadata === undefined) {
      metadata = {}
    }
    for (const [key, value] of Object.entries(updates.metadata)) {
      if (value === null) {
        delete metadata[key]
      } else {
        metadata[key] = value
      }
    }
    if (Object.keys(metadata).length === 0) {
      metadata = undefined
    }
  }

  const updated: Task = {
    ...existing,
    subject: updates.subject ?? existing.subject,
    description: updates.description ?? existing.description,
    activeForm: updates.activeForm !== undefined ? updates.activeForm : existing.activeForm,
    status: updates.status ?? existing.status,
    owner: updates.owner !== undefined ? updates.owner : existing.owner,
    blocks: updates.blocks ?? existing.blocks,
    blockedBy: updates.blockedBy ?? existing.blockedBy,
    metadata: updates.metadata !== undefined ? metadata : existing.metadata,
    output: updates.output !== undefined ? updates.output : existing.output,
    updatedAt: new Date().toISOString(),
  }

  const path = getTaskPath(taskListId, taskId)
  await writeFile(path, JSON.stringify(updated, null, 2))

  return updated
}

/**
 * Delete a task by its ID.
 * Returns true if the task was deleted, false if it did not exist.
 */
export async function deleteTask(taskListId: string, taskId: string): Promise<boolean> {
  const path = getTaskPath(taskListId, taskId)

  try {
    // Update high water mark to prevent ID reuse
    const numericId = Number.parseInt(taskId, 10)
    if (!Number.isNaN(numericId)) {
      const currentMark = await readHighWaterMark(taskListId)
      if (numericId > currentMark) {
        await writeHighWaterMark(taskListId, numericId)
      }
    }

    await unlink(path)

    // Remove references to this task from other tasks
    const allTasks = await listTasks(taskListId)
    for (const task of allTasks) {
      const newBlocks = task.blocks.filter((id) => id !== taskId)
      const newBlockedBy = task.blockedBy.filter((id) => id !== taskId)
      if (newBlocks.length !== task.blocks.length || newBlockedBy.length !== task.blockedBy.length) {
        await updateTask(taskListId, task.id, {
          blocks: newBlocks,
          blockedBy: newBlockedBy,
        })
      }
    }

    return true
  } catch (e) {
    const nodeErr = e as NodeJS.ErrnoException
    if (nodeErr.code === 'ENOENT') {
      return false
    }
    return false
  }
}

/**
 * Set up a dependency: `fromTaskId` blocks `toTaskId`.
 * Returns true if both tasks exist and the relationship was established.
 */
export async function blockTask(taskListId: string, fromTaskId: string, toTaskId: string): Promise<boolean> {
  const [fromTask, toTask] = await Promise.all([getTask(taskListId, fromTaskId), getTask(taskListId, toTaskId)])
  if (!fromTask || !toTask) {
    return false
  }

  // Update source task: A blocks B
  if (!fromTask.blocks.includes(toTaskId)) {
    await updateTask(taskListId, fromTaskId, {
      blocks: [...fromTask.blocks, toTaskId],
    })
  }

  // Update target task: B is blockedBy A
  if (!toTask.blockedBy.includes(fromTaskId)) {
    await updateTask(taskListId, toTaskId, {
      blockedBy: [...toTask.blockedBy, fromTaskId],
    })
  }

  return true
}

/**
 * Reset the task list: clear all tasks and preserve the high water mark.
 */
export async function resetTaskList(taskListId: string): Promise<void> {
  const dir = getTasksDir(taskListId)

  // Find current highest ID and update high water mark
  const currentHighest = await findHighestTaskIdFromFiles(taskListId)
  if (currentHighest > 0) {
    const existingMark = await readHighWaterMark(taskListId)
    if (currentHighest > existingMark) {
      await writeHighWaterMark(taskListId, currentHighest)
    }
  }

  // Delete all task files
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return
  }
  for (const file of files) {
    if (file.endsWith('.json') && !file.startsWith('.')) {
      const filePath = join(dir, file)
      try {
        await unlink(filePath)
      } catch {
        // Ignore errors, file may already be deleted
      }
    }
  }
}

// Re-export for use by tools
export { TaskSchema } from '../types/task.js'
