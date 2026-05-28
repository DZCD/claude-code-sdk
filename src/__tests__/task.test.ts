/**
 * Tests — Task Subsystem
 *
 * Covers Task engine (file system CRUD) + 6 Task tools + integration.
 * Uses real file I/O with temporary directories (no mocking of core logic).
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  blockTask,
  configureTaskEngine,
  createTask,
  deleteTask,
  getTask,
  getTaskListId,
  getTaskPath,
  listTasks,
  resetTaskList,
  updateTask,
} from '../task/engine.js'
import { TaskCreateTool } from '../tools/built-in/task_create.js'
import { TaskGetTool } from '../tools/built-in/task_get.js'
import { TaskListTool } from '../tools/built-in/task_list.js'
import { TaskOutputTool } from '../tools/built-in/task_output.js'
import { TaskStopTool } from '../tools/built-in/task_stop.js'
import { TaskUpdateTool } from '../tools/built-in/task_update.js'
import { ToolRegistry } from '../tools/registry.js'
import type { ToolContext } from '../types/tool.js'

// ─── Test Context ─────────────────────────────────────────

const testContext: ToolContext = {
  signal: new AbortController().signal,
}

const TEST_TASK_LIST = 'test-task-list'

let testBaseDir: string

beforeEach(async () => {
  testBaseDir = await mkdtemp(join(tmpdir(), 'claude-sdk-task-test-'))
  configureTaskEngine({
    baseDir: testBaseDir,
    taskListId: TEST_TASK_LIST,
  })
})

afterEach(async () => {
  await rm(testBaseDir, { recursive: true, force: true })
})

// ─── Task Engine Tests ────────────────────────────────────

describe('Task Engine — File System Storage', () => {
  describe('createTask', () => {
    it('should create a task with sequential numeric ID', async () => {
      const id1 = await createTask(TEST_TASK_LIST, {
        subject: 'First task',
        description: 'The first task',
      })
      const id2 = await createTask(TEST_TASK_LIST, {
        subject: 'Second task',
        description: 'The second task',
      })

      expect(id1).toBe('1')
      expect(id2).toBe('2')
    })

    it('should persist task to disk as JSON', async () => {
      const id = await createTask(TEST_TASK_LIST, {
        subject: 'Test task',
        description: 'A test task',
        metadata: { priority: 'high' },
      })

      const task = await getTask(TEST_TASK_LIST, id)
      expect(task).not.toBeNull()
      expect(task!.subject).toBe('Test task')
      expect(task!.description).toBe('A test task')
      expect(task!.status).toBe('pending')
      expect(task!.metadata).toEqual({ priority: 'high' })
      expect(task!.blocks).toEqual([])
      expect(task!.blockedBy).toEqual([])
      expect(task!.createdAt).toBeTruthy()
      expect(task!.updatedAt).toBeTruthy()
    })

    it('should set activeForm when provided', async () => {
      const id = await createTask(TEST_TASK_LIST, {
        subject: 'Running task',
        description: 'Running something',
        activeForm: 'Running tests',
      })

      const task = await getTask(TEST_TASK_LIST, id)
      expect(task!.activeForm).toBe('Running tests')
    })

    it('should maintain sequential IDs across mixed operations', async () => {
      const id1 = await createTask(TEST_TASK_LIST, { subject: 'T1', description: 'D1' })
      expect(id1).toBe('1')

      const id2 = await createTask(TEST_TASK_LIST, { subject: 'T2', description: 'D2' })
      expect(id2).toBe('2')

      // Delete task 2
      await deleteTask(TEST_TASK_LIST, '2')

      // New task should be '3' (high water mark prevents reuse)
      const id3 = await createTask(TEST_TASK_LIST, { subject: 'T3', description: 'D3' })
      expect(id3).toBe('3')
    })
  })

  describe('getTask', () => {
    it('should return null for non-existent task', async () => {
      const task = await getTask(TEST_TASK_LIST, '999')
      expect(task).toBeNull()
    })

    it('should retrieve a task by ID', async () => {
      const id = await createTask(TEST_TASK_LIST, {
        subject: 'Get me',
        description: 'Retrieve this task',
      })

      const task = await getTask(TEST_TASK_LIST, id)
      expect(task).not.toBeNull()
      expect(task!.id).toBe(id)
      expect(task!.subject).toBe('Get me')
    })
  })

  describe('listTasks', () => {
    it('should return empty array for empty task list', async () => {
      const tasks = await listTasks(TEST_TASK_LIST)
      expect(tasks).toEqual([])
    })

    it('should list all tasks', async () => {
      await createTask(TEST_TASK_LIST, { subject: 'T1', description: 'D1' })
      await createTask(TEST_TASK_LIST, { subject: 'T2', description: 'D2' })
      await createTask(TEST_TASK_LIST, { subject: 'T3', description: 'D3' })

      const tasks = await listTasks(TEST_TASK_LIST)
      expect(tasks).toHaveLength(3)
      expect(tasks.map(t => t.subject)).toEqual(['T1', 'T2', 'T3'])
    })

    it('should return empty for non-existent directory', async () => {
      const tasks = await listTasks('non-existent')
      expect(tasks).toEqual([])
    })
  })

  describe('updateTask', () => {
    it('should update task fields', async () => {
      const id = await createTask(TEST_TASK_LIST, {
        subject: 'Original',
        description: 'Original desc',
      })

      const updated = await updateTask(TEST_TASK_LIST, id, {
        subject: 'Updated',
        status: 'in_progress',
      })

      expect(updated).not.toBeNull()
      expect(updated!.subject).toBe('Updated')
      expect(updated!.status).toBe('in_progress')
      expect(updated!.description).toBe('Original desc')
    })

    it('should update updatedAt on change', async () => {
      const id = await createTask(TEST_TASK_LIST, {
        subject: 'Before',
        description: 'Before desc',
      })

      const original = await getTask(TEST_TASK_LIST, id)
      const originalUpdatedAt = original!.updatedAt

      // Small delay to ensure timestamps differ
      await new Promise(r => setTimeout(r, 10))

      const updated = await updateTask(TEST_TASK_LIST, id, {
        status: 'completed',
      })

      expect(updated!.updatedAt).not.toBe(originalUpdatedAt)
    })

    it('should merge metadata correctly', async () => {
      const id = await createTask(TEST_TASK_LIST, {
        subject: 'Meta test',
        description: 'Testing metadata',
        metadata: { existing: 'value', toRemove: 'old' },
      })

      const updated = await updateTask(TEST_TASK_LIST, id, {
        metadata: { newKey: 'newValue', toRemove: null },
      })

      expect(updated!.metadata).toEqual({ existing: 'value', newKey: 'newValue' })
    })

    it('should return null for non-existent task', async () => {
      const result = await updateTask(TEST_TASK_LIST, '999', { subject: 'Nope' })
      expect(result).toBeNull()
    })

    it('should update output field', async () => {
      const id = await createTask(TEST_TASK_LIST, {
        subject: 'Output test',
        description: 'Testing output',
      })

      const updated = await updateTask(TEST_TASK_LIST, id, {
        output: 'Task completed successfully',
      })

      expect(updated!.output).toBe('Task completed successfully')
    })
  })

  describe('deleteTask', () => {
    it('should delete an existing task', async () => {
      const id = await createTask(TEST_TASK_LIST, {
        subject: 'To delete',
        description: 'This will be deleted',
      })

      const result = await deleteTask(TEST_TASK_LIST, id)
      expect(result).toBe(true)

      const task = await getTask(TEST_TASK_LIST, id)
      expect(task).toBeNull()
    })

    it('should return false for non-existent task', async () => {
      const result = await deleteTask(TEST_TASK_LIST, '999')
      expect(result).toBe(false)
    })

    it('should clean up references from other tasks', async () => {
      const id1 = await createTask(TEST_TASK_LIST, { subject: 'T1', description: 'D1' })
      const id2 = await createTask(TEST_TASK_LIST, { subject: 'T2', description: 'D2' })

      await blockTask(TEST_TASK_LIST, id1, id2)

      // Delete id2, and check id1's blocks no longer contain id2
      await deleteTask(TEST_TASK_LIST, id2)

      const t1 = await getTask(TEST_TASK_LIST, id1)
      expect(t1!.blocks).not.toContain(id2)
    })
  })

  describe('blockTask', () => {
    it('should set up block relationship', async () => {
      const id1 = await createTask(TEST_TASK_LIST, { subject: 'T1', description: 'D1' })
      const id2 = await createTask(TEST_TASK_LIST, { subject: 'T2', description: 'D2' })

      const result = await blockTask(TEST_TASK_LIST, id1, id2)
      expect(result).toBe(true)

      const t1 = await getTask(TEST_TASK_LIST, id1)
      const t2 = await getTask(TEST_TASK_LIST, id2)

      expect(t1!.blocks).toContain(id2)
      expect(t2!.blockedBy).toContain(id1)
    })

    it('should return false if either task does not exist', async () => {
      const result = await blockTask(TEST_TASK_LIST, '999', '888')
      expect(result).toBe(false)
    })

    it('should not duplicate existing blocks', async () => {
      const id1 = await createTask(TEST_TASK_LIST, { subject: 'T1', description: 'D1' })
      const id2 = await createTask(TEST_TASK_LIST, { subject: 'T2', description: 'D2' })

      await blockTask(TEST_TASK_LIST, id1, id2)
      await blockTask(TEST_TASK_LIST, id1, id2) // Should be idempotent

      const t1 = await getTask(TEST_TASK_LIST, id1)
      expect(t1!.blocks).toEqual([id2])
    })
  })

  describe('resetTaskList', () => {
    it('should clear all tasks', async () => {
      await createTask(TEST_TASK_LIST, { subject: 'T1', description: 'D1' })
      await createTask(TEST_TASK_LIST, { subject: 'T2', description: 'D2' })

      await resetTaskList(TEST_TASK_LIST)

      const tasks = await listTasks(TEST_TASK_LIST)
      expect(tasks).toHaveLength(0)
    })

    it('should preserve high water mark', async () => {
      await createTask(TEST_TASK_LIST, { subject: 'T1', description: 'D1' })
      await createTask(TEST_TASK_LIST, { subject: 'T2', description: 'D2' })

      await resetTaskList(TEST_TASK_LIST)

      const id = await createTask(TEST_TASK_LIST, { subject: 'T3', description: 'D3' })
      expect(id).toBe('3') // Not '1' — high water mark preserved
    })
  })

  describe('getTaskListId', () => {
    it('should return configured task list ID', () => {
      expect(getTaskListId()).toBe(TEST_TASK_LIST)
    })
  })
})

// ─── Task Tool Tests ──────────────────────────────────────

describe('Task Tools', () => {
  let registry: ToolRegistry

  beforeEach(() => {
    registry = new ToolRegistry()
  })

  describe('TaskCreateTool', () => {
    it('should register and create a task', async () => {
      const tool = new TaskCreateTool().toTool()
      registry.register(tool)

      const result = await registry.execute('TaskCreate', {
        subject: 'Test task',
        description: 'Test description',
      }, testContext)

      expect(result.isError).toBeFalsy()
      expect(result.data).toMatchObject({
        taskId: expect.any(String),
        status: 'pending',
        subject: 'Test task',
      })
      expect(result.content).toContain('created successfully')
    })

    it('should accept optional activeForm and metadata', async () => {
      const tool = new TaskCreateTool().toTool()
      registry.register(tool)

      const result = await registry.execute('TaskCreate', {
        subject: 'Active task',
        description: 'With active form',
        activeForm: 'Running tests',
        metadata: { env: 'staging' },
      }, testContext)

      expect(result.isError).toBeFalsy()

      // Verify on disk
      const task = await getTask(TEST_TASK_LIST, result.data.taskId)
      expect(task!.activeForm).toBe('Running tests')
      expect(task!.metadata).toEqual({ env: 'staging' })
    })

    it('should validate required fields', async () => {
      const tool = new TaskCreateTool().toTool()
      registry.register(tool)

      const result = await registry.execute('TaskCreate', {
        subject: '',
      }, testContext)

      expect(result.isError).toBe(true)
    })
  })

  describe('TaskGetTool', () => {
    it('should retrieve an existing task', async () => {
      const id = await createTask(TEST_TASK_LIST, {
        subject: 'Retrieve me',
        description: 'For get tool test',
      })

      const tool = new TaskGetTool().toTool()
      registry.register(tool)

      const result = await registry.execute('TaskGet', { taskId: id }, testContext)

      expect(result.isError).toBeFalsy()
      expect(result.data.task).not.toBeNull()
      expect(result.data.task.subject).toBe('Retrieve me')
    })

    it('should return null for non-existent task', async () => {
      const tool = new TaskGetTool().toTool()
      registry.register(tool)

      const result = await registry.execute('TaskGet', { taskId: '999' }, testContext)

      expect(result.isError).toBeFalsy()
      expect(result.data.task).toBeNull()
    })
  })

  describe('TaskListTool', () => {
    it('should list all tasks', async () => {
      await createTask(TEST_TASK_LIST, { subject: 'T1', description: 'D1' })
      await createTask(TEST_TASK_LIST, { subject: 'T2', description: 'D2' })

      const tool = new TaskListTool().toTool()
      registry.register(tool)

      const result = await registry.execute('TaskList', {}, testContext)

      expect(result.isError).toBeFalsy()
      expect(result.data.tasks).toHaveLength(2)
      expect(result.data.tasks[0].subject).toBe('T1')
    })

    it('should return empty list when no tasks', async () => {
      const tool = new TaskListTool().toTool()
      registry.register(tool)

      const result = await registry.execute('TaskList', {}, testContext)
      expect(result.data.tasks).toEqual([])
      expect(result.content).toContain('No tasks found')
    })
  })

  describe('TaskStopTool', () => {
    it('should mark a task as completed', async () => {
      const id = await createTask(TEST_TASK_LIST, {
        subject: 'To stop',
        description: 'Will be stopped',
      })

      const tool = new TaskStopTool().toTool()
      registry.register(tool)

      const result = await registry.execute('TaskStop', { taskId: id }, testContext)

      expect(result.isError).toBeFalsy()
      expect(result.data.status).toBe('completed')

      const task = await getTask(TEST_TASK_LIST, id)
      expect(task!.status).toBe('completed')
    })

    it('should return error for non-existent task', async () => {
      const tool = new TaskStopTool().toTool()
      registry.register(tool)

      const result = await registry.execute('TaskStop', { taskId: '999' }, testContext)

      expect(result.isError).toBe(true)
    })

    it('should handle already completed task gracefully', async () => {
      const id = await createTask(TEST_TASK_LIST, {
        subject: 'Already done',
        description: 'Done',
      })
      await updateTask(TEST_TASK_LIST, id, { status: 'completed' })

      const tool = new TaskStopTool().toTool()
      registry.register(tool)

      const result = await registry.execute('TaskStop', { taskId: id }, testContext)
      expect(result.data.status).toBe('completed')
      expect(result.content).toContain('already completed')
    })
  })

  describe('TaskUpdateTool', () => {
    it('should update task status', async () => {
      const id = await createTask(TEST_TASK_LIST, {
        subject: 'Status change',
        description: 'Update my status',
      })

      const tool = new TaskUpdateTool().toTool()
      registry.register(tool)

      const result = await registry.execute('TaskUpdate', {
        taskId: id,
        status: 'in_progress',
      }, testContext)

      expect(result.isError).toBeFalsy()
      expect(result.data.success).toBe(true)
      expect(result.data.updatedFields).toContain('status')
      expect(result.data.statusChange).toEqual({ from: 'pending', to: 'in_progress' })

      const task = await getTask(TEST_TASK_LIST, id)
      expect(task!.status).toBe('in_progress')
    })

    it('should update multiple fields', async () => {
      const id = await createTask(TEST_TASK_LIST, {
        subject: 'Multi update',
        description: 'Original desc',
      })

      const tool = new TaskUpdateTool().toTool()
      registry.register(tool)

      const result = await registry.execute('TaskUpdate', {
        taskId: id,
        subject: 'Updated subject',
        description: 'Updated desc',
        owner: 'agent-1',
      }, testContext)

      expect(result.data.success).toBe(true)
      expect(result.data.updatedFields).toContain('subject')
      expect(result.data.updatedFields).toContain('description')
      expect(result.data.updatedFields).toContain('owner')

      const task = await getTask(TEST_TASK_LIST, id)
      expect(task!.subject).toBe('Updated subject')
    })

    it('should handle task deletion', async () => {
      const id = await createTask(TEST_TASK_LIST, {
        subject: 'To delete',
        description: 'Delete me',
      })

      const tool = new TaskUpdateTool().toTool()
      registry.register(tool)

      const result = await registry.execute('TaskUpdate', {
        taskId: id,
        status: 'deleted',
      }, testContext)

      expect(result.data.success).toBe(true)
      expect(result.data.updatedFields).toContain('deleted')

      const task = await getTask(TEST_TASK_LIST, id)
      expect(task).toBeNull()
    })

    it('should return error for non-existent task', async () => {
      const tool = new TaskUpdateTool().toTool()
      registry.register(tool)

      const result = await registry.execute('TaskUpdate', {
        taskId: '999',
        status: 'completed',
      }, testContext)

      expect(result.data.success).toBe(false)
      expect(result.data.error).toBe('Task not found')
    })

    it('should add block dependencies', async () => {
      const id1 = await createTask(TEST_TASK_LIST, { subject: 'T1', description: 'D1' })
      const id2 = await createTask(TEST_TASK_LIST, { subject: 'T2', description: 'D2' })

      const tool = new TaskUpdateTool().toTool()
      registry.register(tool)

      await registry.execute('TaskUpdate', {
        taskId: id1,
        addBlocks: [id2],
      }, testContext)

      const t1 = await getTask(TEST_TASK_LIST, id1)
      expect(t1!.blocks).toContain(id2)
    })

    it('should merge metadata', async () => {
      const id = await createTask(TEST_TASK_LIST, {
        subject: 'Meta merge',
        description: 'Merge metadata',
        metadata: { existing: 'keep' },
      })

      const tool = new TaskUpdateTool().toTool()
      registry.register(tool)

      await registry.execute('TaskUpdate', {
        taskId: id,
        metadata: { newKey: 'added' },
      }, testContext)

      const task = await getTask(TEST_TASK_LIST, id)
      expect(task!.metadata).toEqual({ existing: 'keep', newKey: 'added' })
    })
  })

  describe('TaskOutputTool', () => {
    it('should retrieve task output', async () => {
      const id = await createTask(TEST_TASK_LIST, {
        subject: 'Output task',
        description: 'With output',
      })
      await updateTask(TEST_TASK_LIST, id, { output: 'Hello, world!' })

      const tool = new TaskOutputTool().toTool()
      registry.register(tool)

      const result = await registry.execute('TaskOutput', { taskId: id }, testContext)

      expect(result.isError).toBeFalsy()
      expect(result.data.output).toBe('Hello, world!')
      expect(result.data.subject).toBe('Output task')
    })

    it('should return null output for task without output', async () => {
      const id = await createTask(TEST_TASK_LIST, {
        subject: 'No output',
        description: 'No output here',
      })

      const tool = new TaskOutputTool().toTool()
      registry.register(tool)

      const result = await registry.execute('TaskOutput', { taskId: id }, testContext)

      expect(result.data.output).toBeNull()
    })

    it('should return error for non-existent task', async () => {
      const tool = new TaskOutputTool().toTool()
      registry.register(tool)

      const result = await registry.execute('TaskOutput', { taskId: '999' }, testContext)

      expect(result.isError).toBe(true)
    })
  })
})

// ─── Integration Tests ────────────────────────────────────

describe('Task Subsystem Integration', () => {
  it('should support full task lifecycle', async () => {
    // Create
    const taskId = await createTask(TEST_TASK_LIST, {
      subject: 'Lifecycle test',
      description: 'Testing the full lifecycle',
    })

    // Read
    let task = await getTask(TEST_TASK_LIST, taskId)
    expect(task!.status).toBe('pending')

    // Start
    task = await updateTask(TEST_TASK_LIST, taskId, { status: 'in_progress' })
    expect(task!.status).toBe('in_progress')

    // Set output
    task = await updateTask(TEST_TASK_LIST, taskId, { output: 'Done!' })

    // Complete
    task = await updateTask(TEST_TASK_LIST, taskId, { status: 'completed' })
    expect(task!.status).toBe('completed')

    // Verify listing
    const tasks = await listTasks(TEST_TASK_LIST)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.status).toBe('completed')
    expect(tasks[0]!.output).toBe('Done!')
  })

  it('should handle dependencies between tasks', async () => {
    const t1 = await createTask(TEST_TASK_LIST, { subject: 'First', description: 'First task' })
    const t2 = await createTask(TEST_TASK_LIST, { subject: 'Second', description: 'Depends on first' })

    // t1 blocks t2 — t2 depends on t1
    await blockTask(TEST_TASK_LIST, t1, t2)

    const task1 = await getTask(TEST_TASK_LIST, t1)
    const task2 = await getTask(TEST_TASK_LIST, t2)

    expect(task1!.blocks).toContain(t2)
    expect(task2!.blockedBy).toContain(t1)
  })

  it('should work with ToolRegistry and all tools registered', async () => {
    const registry = new ToolRegistry()
    registry.register(
      new TaskCreateTool().toTool(),
      new TaskGetTool().toTool(),
      new TaskListTool().toTool(),
      new TaskStopTool().toTool(),
      new TaskUpdateTool().toTool(),
      new TaskOutputTool().toTool(),
    )

    // Verify all 6 tools registered
    expect(registry.size).toBe(6)
    expect(registry.has('TaskCreate')).toBe(true)
    expect(registry.has('TaskGet')).toBe(true)
    expect(registry.has('TaskList')).toBe(true)
    expect(registry.has('TaskStop')).toBe(true)
    expect(registry.has('TaskUpdate')).toBe(true)
    expect(registry.has('TaskOutput')).toBe(true)

    // Use them end-to-end
    const createResult = await registry.execute('TaskCreate', {
      subject: 'E2E task',
      description: 'End-to-end test',
    }, testContext)
    expect(createResult.isError).toBeFalsy()
    const taskId = createResult.data.taskId

    const listResult = await registry.execute('TaskList', {}, testContext)
    expect(listResult.data.tasks).toHaveLength(1)

    const getResult = await registry.execute('TaskGet', { taskId }, testContext)
    expect(getResult.data.task.subject).toBe('E2E task')

    const updateResult = await registry.execute('TaskUpdate', {
      taskId,
      status: 'completed',
      output: 'All done',
    }, testContext)
    expect(updateResult.data.success).toBe(true)

    const outputResult = await registry.execute('TaskOutput', { taskId }, testContext)
    expect(outputResult.data.output).toBe('All done')
  })
})
