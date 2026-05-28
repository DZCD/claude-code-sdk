/**
 * ClaudeCode SDK — Built-in Tools Index
 *
 * Exports all built-in tool implementations for registration
 * with the ToolRegistry or direct use.
 */
import { BashTool } from './bash.js'
import { FileEditTool } from './file_edit.js'
import { FileReadTool } from './file_read.js'
import { FileWriteTool } from './file_write.js'
import { GlobTool } from './glob.js'
import { GrepTool } from './grep.js'
import { TaskCreateTool } from './task_create.js'
import { TaskGetTool } from './task_get.js'
import { TaskListTool } from './task_list.js'
import { TaskOutputTool } from './task_output.js'
import { TaskStopTool } from './task_stop.js'
import { TaskUpdateTool } from './task_update.js'
import { WebFetchTool } from './web_fetch.js'
import { WebSearchTool } from './web_search.js'

export {
  BashTool,
  FileEditTool,
  FileReadTool,
  FileWriteTool,
  GlobTool,
  GrepTool,
  TaskCreateTool,
  TaskGetTool,
  TaskListTool,
  TaskOutputTool,
  TaskStopTool,
  TaskUpdateTool,
  WebFetchTool,
  WebSearchTool,
}

/**
 * Register all built-in tools into a ToolRegistry.
 * Convenience function for quick SDK setup.
 */
import type { ToolRegistry } from '../registry.js'

/**
 * Register only the Task tools into a ToolRegistry.
 */
export function registerAllTaskTools(registry: ToolRegistry): void {
  registry.register(
    new TaskCreateTool().toTool(),
    new TaskGetTool().toTool(),
    new TaskListTool().toTool(),
    new TaskStopTool().toTool(),
    new TaskUpdateTool().toTool(),
    new TaskOutputTool().toTool(),
  )
}

/**
 * Register all built-in tools (including Task tools) into a ToolRegistry.
 */
export function registerAllBuiltInTools(registry: ToolRegistry): void {
  registry.register(
    new BashTool().toTool(),
    new FileReadTool().toTool(),
    new FileWriteTool().toTool(),
    new FileEditTool().toTool(),
    new GlobTool().toTool(),
    new GrepTool().toTool(),
    new WebFetchTool().toTool(),
    new WebSearchTool().toTool(),
    new TaskCreateTool().toTool(),
    new TaskGetTool().toTool(),
    new TaskListTool().toTool(),
    new TaskStopTool().toTool(),
    new TaskUpdateTool().toTool(),
    new TaskOutputTool().toTool(),
  )
}
