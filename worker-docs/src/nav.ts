export interface NavPage {
  file: string
  title: string
}

export interface NavSection {
  section: string
  label: string
  pages: NavPage[]
}

export const NAV_ITEMS: NavSection[] = [
  {
    section: 'getting-started',
    label: '快速开始',
    pages: [
      { file: 'installation', title: '安装' },
      { file: 'quick-start', title: '5 分钟快速上手' },
      { file: 'configuration', title: '配置说明' },
    ],
  },
  {
    section: 'core-concepts',
    label: '核心概念',
    pages: [
      { file: 'sdk-overview', title: 'SDK 架构概览' },
      { file: 'session-engine', title: 'Session Engine' },
      { file: 'conversation', title: 'Conversation Manager' },
      { file: 'tool-system', title: '工具系统' },
    ],
  },
  {
    section: 'llm-providers',
    label: 'LLM Provider',
    pages: [
      { file: 'anthropic', title: 'Anthropic' },
      { file: 'bedrock', title: 'AWS Bedrock' },
      { file: 'vertex', title: 'Google Vertex AI' },
      { file: 'foundry', title: 'Anthropic Foundry' },
    ],
  },
  {
    section: 'tools',
    label: '内置工具',
    pages: [
      { file: 'bash', title: 'Bash' },
      { file: 'file-read', title: 'FileRead' },
      { file: 'file-write', title: 'FileWrite' },
      { file: 'file-edit', title: 'FileEdit' },
      { file: 'glob', title: 'Glob' },
      { file: 'grep', title: 'Grep' },
      { file: 'web-fetch', title: 'WebFetch' },
      { file: 'web-search', title: 'WebSearch' },
    ],
  },
  {
    section: 'api-reference',
    label: 'API 参考',
    pages: [
      { file: 'claude-code-sdk', title: 'ClaudeCodeSDK' },
      { file: 'config-manager', title: 'ConfigManager' },
      { file: 'logging', title: '日志系统' },
      { file: 'hooks', title: 'Hook 系统' },
      { file: 'mcp', title: 'MCP 协议' },
    ],
  },
  {
    section: 'examples',
    label: '示例',
    pages: [
      { file: 'basic-chat', title: '基本对话' },
      { file: 'streaming', title: '流式对话' },
      { file: 'tool-usage', title: '工具调用' },
      { file: 'mcp-integration', title: 'MCP 集成' },
    ],
  },
  {
    section: 'advanced',
    label: '进阶',
    pages: [
      { file: 'permission-system', title: '权限系统' },
      { file: 'context-building', title: '上下文构建' },
      { file: 'error-handling', title: '错误处理' },
      { file: 'rate-limiting', title: '速率限制' },
      { file: 'skill-system', title: 'Skill 系统' },
      { file: 'task-system', title: 'Task 子系统' },
      { file: 'structured-output', title: 'Structured Output' },
    ],
  },
]
