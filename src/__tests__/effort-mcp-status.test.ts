import { describe, expect, it } from 'vitest'
import type { EffortLevel } from '../types/effort.js'
import { EFFORT_LEVELS, normalizeEffortLevel } from '../types/effort.js'
import type {
  McpServerCapabilities,
  McpServerInfo,
  McpServerStatus,
  McpServerStatusValue,
  McpServerTool,
  McpToolAnnotations,
} from '../types/mcp-status.js'
import {
  MCP_SERVER_STATUS_VALUES,
  isMcpConnected,
  isMcpErrored,
  normalizeMcpServerStatus,
} from '../types/mcp-status.js'

// ─── EffortLevel Tests ────────────────────────────────────

describe('EffortLevel', () => {
  describe('type values', () => {
    it('should have exactly 3 valid values', () => {
      expect(EFFORT_LEVELS).toHaveLength(3)
    })

    it('should include low, medium, high in order', () => {
      expect(EFFORT_LEVELS).toEqual(['low', 'medium', 'high'])
    })

    it('should accept low as a valid EffortLevel', () => {
      const level: EffortLevel = 'low'
      expect(level).toBe('low')
    })

    it('should accept medium as a valid EffortLevel', () => {
      const level: EffortLevel = 'medium'
      expect(level).toBe('medium')
    })

    it('should accept high as a valid EffortLevel', () => {
      const level: EffortLevel = 'high'
      expect(level).toBe('high')
    })

    it('should be a read-only typed array', () => {
      // `as const` ensures type-level readonly, not runtime Object.freeze
      const arr: readonly EffortLevel[] = EFFORT_LEVELS
      expect(arr).toEqual(['low', 'medium', 'high'])
    })
  })

  describe('normalizeEffortLevel', () => {
    it('should return low for low input', () => {
      expect(normalizeEffortLevel('low')).toBe('low')
    })

    it('should return medium for medium input', () => {
      expect(normalizeEffortLevel('medium')).toBe('medium')
    })

    it('should return high for high input', () => {
      expect(normalizeEffortLevel('high')).toBe('high')
    })

    it('should default to medium for unknown string', () => {
      expect(normalizeEffortLevel('extreme')).toBe('medium')
    })

    it('should default to medium for undefined', () => {
      expect(normalizeEffortLevel(undefined)).toBe('medium')
    })

    it('should default to medium for null', () => {
      expect(normalizeEffortLevel(null)).toBe('medium')
    })

    it('should default to medium for arbitrary object', () => {
      expect(normalizeEffortLevel({})).toBe('medium')
    })

    it('should default to medium for number', () => {
      expect(normalizeEffortLevel(42)).toBe('medium')
    })

    it('should handle empty string by defaulting to medium', () => {
      expect(normalizeEffortLevel('')).toBe('medium')
    })
  })
})

// ─── McpServerStatus Tests ────────────────────────────────

describe('McpServerStatus', () => {
  describe('MCP_SERVER_STATUS_VALUES', () => {
    it('should have 5 status values', () => {
      expect(MCP_SERVER_STATUS_VALUES).toHaveLength(5)
    })

    it('should include all expected values in order', () => {
      expect(MCP_SERVER_STATUS_VALUES).toEqual(['connected', 'failed', 'needs-auth', 'pending', 'disabled'])
    })

    it('should be read-only typed', () => {
      // `as const` ensures type-level readonly, not runtime Object.freeze
      const arr: readonly McpServerStatusValue[] = MCP_SERVER_STATUS_VALUES
      expect(arr).toEqual(['connected', 'failed', 'needs-auth', 'pending', 'disabled'])
    })
  })

  describe('type assertions', () => {
    it('should accept connected status', () => {
      const status: McpServerStatusValue = 'connected'
      expect(status).toBe('connected')
    })

    it('should accept failed status', () => {
      const status: McpServerStatusValue = 'failed'
      expect(status).toBe('failed')
    })

    it('should accept needs-auth status', () => {
      const status: McpServerStatusValue = 'needs-auth'
      expect(status).toBe('needs-auth')
    })

    it('should accept pending status', () => {
      const status: McpServerStatusValue = 'pending'
      expect(status).toBe('pending')
    })

    it('should accept disabled status', () => {
      const status: McpServerStatusValue = 'disabled'
      expect(status).toBe('disabled')
    })
  })

  describe('isMcpConnected', () => {
    it('should return true for connected', () => {
      expect(isMcpConnected('connected')).toBe(true)
    })

    it('should return false for failed', () => {
      expect(isMcpConnected('failed')).toBe(false)
    })

    it('should return false for needs-auth', () => {
      expect(isMcpConnected('needs-auth')).toBe(false)
    })

    it('should return false for pending', () => {
      expect(isMcpConnected('pending')).toBe(false)
    })

    it('should return false for disabled', () => {
      expect(isMcpConnected('disabled')).toBe(false)
    })
  })

  describe('isMcpErrored', () => {
    it('should return false for connected', () => {
      expect(isMcpErrored('connected')).toBe(false)
    })

    it('should return true for failed', () => {
      expect(isMcpErrored('failed')).toBe(true)
    })

    it('should return false for needs-auth', () => {
      expect(isMcpErrored('needs-auth')).toBe(false)
    })

    it('should return false for pending', () => {
      expect(isMcpErrored('pending')).toBe(false)
    })

    it('should return false for disabled', () => {
      expect(isMcpErrored('disabled')).toBe(false)
    })
  })

  describe('normalizeMcpServerStatus', () => {
    it('should return connected for connected input', () => {
      expect(normalizeMcpServerStatus('connected')).toBe('connected')
    })

    it('should return failed for failed input', () => {
      expect(normalizeMcpServerStatus('failed')).toBe('failed')
    })

    it('should return needs-auth for needs-auth input', () => {
      expect(normalizeMcpServerStatus('needs-auth')).toBe('needs-auth')
    })

    it('should return pending for pending input', () => {
      expect(normalizeMcpServerStatus('pending')).toBe('pending')
    })

    it('should return disabled for disabled input', () => {
      expect(normalizeMcpServerStatus('disabled')).toBe('disabled')
    })

    it('should default to pending for unknown string', () => {
      expect(normalizeMcpServerStatus('unknown')).toBe('pending')
    })

    it('should default to pending for undefined', () => {
      expect(normalizeMcpServerStatus(undefined)).toBe('pending')
    })

    it('should default to pending for null', () => {
      expect(normalizeMcpServerStatus(null)).toBe('pending')
    })

    it('should default to pending for number', () => {
      expect(normalizeMcpServerStatus(42)).toBe('pending')
    })

    it('should default to pending for empty string', () => {
      expect(normalizeMcpServerStatus('')).toBe('pending')
    })
  })
})

// ─── McpServerStatus Interface Tests ──────────────────────

describe('McpServerStatus object shape', () => {
  it('should allow a fully populated connected server status', () => {
    const serverInfo: McpServerInfo = {
      name: 'my-mcp-server',
      version: '1.2.3',
    }

    const annotations: McpToolAnnotations = {
      readOnly: true,
      destructive: false,
    }

    const tool: McpServerTool = {
      name: 'search',
      description: 'Search tool',
      annotations,
    }

    const capabilities: McpServerCapabilities = {
      experimental: { 'claude/channel': 'my-channel' },
    }

    const status: McpServerStatus = {
      name: 'my-mcp-server',
      status: 'connected',
      serverInfo,
      tools: [tool],
      capabilities,
      scope: 'project',
      config: { type: 'stdio', command: 'node', args: ['server.js'] },
    }

    expect(status.name).toBe('my-mcp-server')
    expect(status.status).toBe('connected')
    expect(status.serverInfo?.name).toBe('my-mcp-server')
    expect(status.tools).toHaveLength(1)
    expect(status.tools?.[0]?.name).toBe('search')
    expect(status.tools?.[0]?.annotations?.readOnly).toBe(true)
    expect(status.capabilities?.experimental?.['claude/channel']).toBe('my-channel')
    expect(status.scope).toBe('project')
  })

  it('should allow a failed server status with error', () => {
    const status: McpServerStatus = {
      name: 'broken-server',
      status: 'failed',
      error: 'Connection refused',
    }

    expect(status.name).toBe('broken-server')
    expect(status.status).toBe('failed')
    expect(status.error).toBe('Connection refused')
    expect(status.serverInfo).toBeUndefined()
    expect(status.tools).toBeUndefined()
  })

  it('should allow a pending server status (minimal)', () => {
    const status: McpServerStatus = {
      name: 'pending-server',
      status: 'pending',
    }

    expect(status.name).toBe('pending-server')
    expect(status.status).toBe('pending')
  })

  it('should allow a needs-auth server status', () => {
    const status: McpServerStatus = {
      name: 'auth-server',
      status: 'needs-auth',
      scope: 'user',
    }

    expect(status.status).toBe('needs-auth')
    expect(status.scope).toBe('user')
  })

  it('should allow a disabled server status', () => {
    const status: McpServerStatus = {
      name: 'disabled-server',
      status: 'disabled',
    }

    expect(status.status).toBe('disabled')
  })
})

// ─── Top-level export availability ────────────────────────

describe('Top-level exports from src/index.ts', () => {
  it('should export EffortLevel type from index', async () => {
    const mod = await import('../index.js')
    // Type-level check: just ensure the module loads without error
    expect(mod.normalizeEffortLevel).toBeDefined()
    expect(mod.EFFORT_LEVELS).toBeDefined()
  })

  it('should export McpServerStatus utilities from index', async () => {
    const mod = await import('../index.js')
    expect(mod.isMcpConnected).toBeDefined()
    expect(mod.isMcpErrored).toBeDefined()
    expect(mod.normalizeMcpServerStatus).toBeDefined()
    expect(mod.MCP_SERVER_STATUS_VALUES).toBeDefined()
  })
})
