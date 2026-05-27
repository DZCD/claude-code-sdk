/**
 * Tests for PermissionManager extensions (plan mode refinement, dangerous patterns, classifier).
 *
 * Phase 2-G: Tests the integrated PermissionManager with bash classifier,
 * path validation, and plan mode refinements.
 */
import { describe, it, expect, vi } from 'vitest'
import { PermissionManager } from '../permission/manager.js'
import type { PermissionMode, PlanModeConfig } from '../types/permission.js'
import { classifyBashCommand } from '../permission/bashClassifier.js'
import { isDangerousBashCommand } from '../permission/dangerousPatterns.js'

describe('PermissionManager — Phase 2-G Extensions', () => {
  describe('plan mode refinement', () => {
    it('should use default plan mode config', () => {
      const pm = new PermissionManager('plan')
      const config = pm.getPlanModeConfig()
      expect(config.allowReadOnlyTools).toBe(true)
      expect(config.allowFileReads).toBe(true)
      expect(config.allowSearchOperations).toBe(true)
    })

    it('should allow read-only read_file tool in plan mode with default config', () => {
      const pm = new PermissionManager('plan')
      const readOnlyTool = {
        name: 'read_file',
        isReadOnly: () => true,
      }
      const result = pm.checkToolInPlanMode('read_file', { path: '/test/file.txt' }, readOnlyTool as never)
      expect(result.type).toBe('allow')
    })

    it('should deny write_file in plan mode', () => {
      const pm = new PermissionManager('plan')
      const writeTool = {
        name: 'write_file',
        isReadOnly: () => false,
      }
      const result = pm.checkToolInPlanMode('write_file', { path: '/test/file.txt' }, writeTool as never)
      expect(result.type).toBe('deny')
    })

    it('should allow read_file with custom plan config allowing reads', () => {
      const pm = new PermissionManager('plan')
      pm.setPlanModeConfig({ ...pm.getPlanModeConfig(), allowFileReads: true })
      const readTool = {
        name: 'read_file',
        isReadOnly: () => true,
      }
      const result = pm.checkToolInPlanMode('read_file', { path: '/test/file.txt' }, readTool as never)
      expect(result.type).toBe('allow')
    })

    it('should deny file reads when allowFileReads is false', () => {
      const pm = new PermissionManager('plan')
      pm.setPlanModeConfig({
        allowReadOnlyTools: false,
        allowFileReads: false,
        allowSearchOperations: false,
      })
      const readTool = {
        name: 'read_file',
        isReadOnly: () => true,
      }
      const result = pm.checkToolInPlanMode('read_file', { path: '/test/file.txt' }, readTool as never)
      expect(result.type).toBe('deny')
    })
  })

  describe('bash command classification', () => {
    it('should classify safe commands as allow in auto mode', async () => {
      const pm = new PermissionManager('auto')
      const decision = await pm.checkBashCommand('ls -la', '/home/user/project')
      expect(decision.type).toBe('allow')
    })

    it('should classify destructive commands as deny', async () => {
      const pm = new PermissionManager('auto')
      const decision = await pm.checkBashCommand('rm -rf /', '/home/user/project')
      expect(decision.type).toBe('deny')
    })

    it('should classify ask-level commands as ask in auto mode', async () => {
      const pm = new PermissionManager('auto')
      const decision = await pm.checkBashCommand('git push origin main', '/home/user/project')
      expect(decision.type).toBe('ask')
    })

    it('should always allow in bypass mode regardless of danger', async () => {
      const pm = new PermissionManager('bypass')
      const decision = await pm.checkBashCommand('rm -rf /', '/home/user/project')
      expect(decision.type).toBe('allow')
    })

    it('should deny all bash in plan mode', async () => {
      const pm = new PermissionManager('plan')
      const decision = await pm.checkBashCommand('ls -la', '/home/user/project')
      expect(decision.type).toBe('deny')
    })

    it('should integrate with dangerous patterns directly', () => {
      expect(isDangerousBashCommand('sudo !!')).toBe(true)
      expect(isDangerousBashCommand('rm -rf /')).toBe(true)
      expect(isDangerousBashCommand('ls -la')).toBe(false)
    })
  })

  describe('path validation with PermissionManager', () => {
    it('should validate paths with default options', () => {
      const pm = new PermissionManager('auto')
      pm.addAllowedDirectory('/home/user/project')

      const result = pm.validatePathEnhanced('/home/user/project/file.ts', '/home/user/project', 'read')
      expect(result.allowed).toBe(true)
    })

    it('should deny paths outside allowed directories', () => {
      const pm = new PermissionManager('auto')
      pm.addAllowedDirectory('/home/user/project')

      const result = pm.validatePathEnhanced('/etc/passwd', '/home/user/project', 'read')
      expect(result.allowed).toBe(false)
    })

    it('should deny sensitive paths', () => {
      const pm = new PermissionManager('auto')
      pm.addAllowedDirectory('/home/user/project')

      const result = pm.validatePathEnhanced('/home/user/project/.env', '/home/user/project', 'read')
      expect(result.allowed).toBe(false)
    })
  })

  describe('dangerous removal detection integration', () => {
    it('should detect dangerous removal via PermissionManager', () => {
      const pm = new PermissionManager('auto')
      expect(pm.isDangerousRemovalPath('/')).toBe(true)
      expect(pm.isDangerousRemovalPath('/usr')).toBe(true)
      expect(pm.isDangerousRemovalPath('/usr/local')).toBe(false)
    })
  })
})
