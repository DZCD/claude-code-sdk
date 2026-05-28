import { describe, expect, it } from 'vitest'
import {
  type DebugFilter,
  extractDebugCategories,
  parseDebugFilter,
  shouldShowDebugCategories,
  shouldShowDebugMessage,
} from '../debugFilter.js'

describe('parseDebugFilter', () => {
  it('should return null for undefined filter string', () => {
    expect(parseDebugFilter(undefined)).toBeNull()
  })

  it('should return null for empty filter string', () => {
    expect(parseDebugFilter('')).toBeNull()
  })

  it('should return null for whitespace-only filter string', () => {
    expect(parseDebugFilter('   ')).toBeNull()
  })

  it('should parse inclusive filter with single category', () => {
    const result = parseDebugFilter('api')
    expect(result).not.toBeNull()
    expect(result!.include).toEqual(['api'])
    expect(result!.exclude).toEqual([])
    expect(result!.isExclusive).toBe(false)
  })

  it('should parse inclusive filter with multiple categories', () => {
    const result = parseDebugFilter('api,hooks')
    expect(result).not.toBeNull()
    expect(result!.include).toEqual(['api', 'hooks'])
    expect(result!.exclude).toEqual([])
    expect(result!.isExclusive).toBe(false)
  })

  it('should parse exclusive filter with single category', () => {
    const result = parseDebugFilter('!1p')
    expect(result).not.toBeNull()
    expect(result!.include).toEqual([])
    expect(result!.exclude).toEqual(['1p'])
    expect(result!.isExclusive).toBe(true)
  })

  it('should parse exclusive filter with multiple categories', () => {
    const result = parseDebugFilter('!1p,!file')
    expect(result).not.toBeNull()
    expect(result!.include).toEqual([])
    expect(result!.exclude).toEqual(['1p', 'file'])
    expect(result!.isExclusive).toBe(true)
  })

  it('should return null for mixed inclusive and exclusive filters', () => {
    const result = parseDebugFilter('api,!file')
    expect(result).toBeNull()
  })

  it('should normalize categories to lowercase', () => {
    const result = parseDebugFilter('API,Hooks')
    expect(result).not.toBeNull()
    expect(result!.include).toEqual(['api', 'hooks'])
  })

  it('should trim whitespace from categories', () => {
    const result = parseDebugFilter(' api , hooks ')
    expect(result).not.toBeNull()
    expect(result!.include).toEqual(['api', 'hooks'])
  })

  it('should handle comma without spaces', () => {
    const result = parseDebugFilter('a,b,c')
    expect(result).not.toBeNull()
    expect(result!.include).toEqual(['a', 'b', 'c'])
  })
})

describe('extractDebugCategories', () => {
  it('should extract category from prefix pattern "category: message"', () => {
    const result = extractDebugCategories('AutoUpdater: check complete')
    expect(result).toContain('autoupdater')
  })

  it('should extract category from bracket pattern "[CATEGORY] message"', () => {
    const result = extractDebugCategories('[CONFIG] loading settings')
    expect(result).toContain('config')
  })

  it('should extract MCP server name from MCP pattern', () => {
    const result = extractDebugCategories('MCP server "filesystem": connected')
    expect(result).toContain('mcp')
    expect(result).toContain('filesystem')
  })

  it('should extract MCP server name with single quotes', () => {
    const result = extractDebugCategories("MCP server 'filesystem': connected")
    expect(result).toContain('mcp')
    expect(result).toContain('filesystem')
  })

  it('should extract [ANT-ONLY] and 1p categories', () => {
    const result = extractDebugCategories('[ANT-ONLY] 1P event: tengu_timer')
    expect(result).toContain('ant-only')
    expect(result).toContain('1p')
  })

  it('should extract secondary categories from "type:" patterns', () => {
    const result = extractDebugCategories('AutoUpdater: Installation type: development')
    expect(result).toContain('autoupdater')
    expect(result).toContain('installation')
  })

  it('should return empty array for messages with no categories', () => {
    const result = extractDebugCategories('Just a plain message without categories')
    expect(result).toEqual([])
  })

  it('should deduplicate categories', () => {
    // Message that could produce duplicate categories
    const result = extractDebugCategories('[test] test: something')
    // The Set-based dedup should work - both patterns extract "test"
    const testCount = result.filter((c) => c === 'test').length
    expect(testCount).toBe(1)
  })

  it('should handle empty string', () => {
    const result = extractDebugCategories('')
    expect(result).toEqual([])
  })

  it('should extract prefix category for non-MCP messages', () => {
    const result = extractDebugCategories('sdk: initialization complete')
    expect(result).toContain('sdk')
  })
})

describe('shouldShowDebugCategories', () => {
  it('should show everything when filter is null', () => {
    expect(shouldShowDebugCategories(['api'], null)).toBe(true)
    expect(shouldShowDebugCategories([], null)).toBe(true)
  })

  it('should show message in inclusive mode when category matches', () => {
    const filter: DebugFilter = {
      include: ['api', 'hooks'],
      exclude: [],
      isExclusive: false,
    }
    expect(shouldShowDebugCategories(['api'], filter)).toBe(true)
    expect(shouldShowDebugCategories(['hooks'], filter)).toBe(true)
  })

  it('should hide message in inclusive mode when category does not match', () => {
    const filter: DebugFilter = {
      include: ['api'],
      exclude: [],
      isExclusive: false,
    }
    expect(shouldShowDebugCategories(['hooks'], filter)).toBe(false)
  })

  it('should hide uncategorized messages in inclusive mode', () => {
    const filter: DebugFilter = {
      include: ['api'],
      exclude: [],
      isExclusive: false,
    }
    expect(shouldShowDebugCategories([], filter)).toBe(false)
  })

  it('should show message in exclusive mode when no categories excluded', () => {
    const filter: DebugFilter = {
      include: [],
      exclude: ['1p'],
      isExclusive: true,
    }
    expect(shouldShowDebugCategories(['api'], filter)).toBe(true)
  })

  it('should hide message in exclusive mode when category is excluded', () => {
    const filter: DebugFilter = {
      include: [],
      exclude: ['1p'],
      isExclusive: true,
    }
    expect(shouldShowDebugCategories(['1p'], filter)).toBe(false)
  })

  it('should hide uncategorized messages in exclusive mode', () => {
    const filter: DebugFilter = {
      include: [],
      exclude: ['1p'],
      isExclusive: true,
    }
    expect(shouldShowDebugCategories([], filter)).toBe(false)
  })
})

describe('shouldShowDebugMessage', () => {
  it('should show message when filter is null', () => {
    expect(shouldShowDebugMessage('api: hello', null)).toBe(true)
  })

  it('should show message in inclusive mode when category matches', () => {
    const filter: DebugFilter = {
      include: ['api'],
      exclude: [],
      isExclusive: false,
    }
    expect(shouldShowDebugMessage('api: hello', filter)).toBe(true)
  })

  it('should hide message in inclusive mode when category does not match', () => {
    const filter: DebugFilter = {
      include: ['hooks'],
      exclude: [],
      isExclusive: false,
    }
    expect(shouldShowDebugMessage('api: hello', filter)).toBe(false)
  })

  it('should hide uncategorized message with inclusive filter', () => {
    const filter: DebugFilter = {
      include: ['api'],
      exclude: [],
      isExclusive: false,
    }
    expect(shouldShowDebugMessage('just a plain message', filter)).toBe(false)
  })
})
