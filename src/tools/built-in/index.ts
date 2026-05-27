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
import { WebFetchTool } from './web_fetch.js'
import { WebSearchTool } from './web_search.js'

export { BashTool, FileReadTool, FileWriteTool, FileEditTool, GlobTool, GrepTool, WebFetchTool, WebSearchTool }

/**
 * Register all built-in tools into a ToolRegistry.
 * Convenience function for quick SDK setup.
 */
import type { ToolRegistry } from '../registry.js'

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
  )
}
