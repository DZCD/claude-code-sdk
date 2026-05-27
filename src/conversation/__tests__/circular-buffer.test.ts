/**
 * Tests — CircularBuffer
 *
 * Fixed-size circular buffer with auto-eviction.
 */
import { describe, expect, it } from 'vitest'
import { CircularBuffer } from '../circular-buffer.js'

describe('CircularBuffer', () => {
  describe('basic operations', () => {
    it('should create an empty buffer', () => {
      const buf = new CircularBuffer<number>(5)
      expect(buf.toArray()).toEqual([])
      expect(buf.length).toBe(0)
    })

    it('should add items and retrieve them', () => {
      const buf = new CircularBuffer<number>(3)
      buf.add(1)
      buf.add(2)
      buf.add(3)
      expect(buf.toArray()).toEqual([1, 2, 3])
      expect(buf.length).toBe(3)
    })

    it('should evict oldest item when full', () => {
      const buf = new CircularBuffer<number>(3)
      buf.add(1)
      buf.add(2)
      buf.add(3)
      buf.add(4)
      expect(buf.toArray()).toEqual([2, 3, 4])
      expect(buf.length).toBe(3)
    })

    it('should evict multiple items when overflowing', () => {
      const buf = new CircularBuffer<number>(3)
      buf.add(1)
      buf.add(2)
      buf.add(3)
      buf.add(4)
      buf.add(5)
      expect(buf.toArray()).toEqual([3, 4, 5])
    })

    it('should handle capacity of 1', () => {
      const buf = new CircularBuffer<string>(1)
      buf.add('a')
      expect(buf.toArray()).toEqual(['a'])
      buf.add('b')
      expect(buf.toArray()).toEqual(['b'])
    })

    it('should clear all items', () => {
      const buf = new CircularBuffer<number>(3)
      buf.add(1)
      buf.add(2)
      buf.add(3)
      buf.clear()
      expect(buf.toArray()).toEqual([])
      expect(buf.length).toBe(0)
    })
  })

  describe('getRecent', () => {
    it('should return most recent N items', () => {
      const buf = new CircularBuffer<number>(5)
      buf.add(1)
      buf.add(2)
      buf.add(3)
      buf.add(4)
      buf.add(5)
      expect(buf.getRecent(2)).toEqual([4, 5])
      expect(buf.getRecent(3)).toEqual([3, 4, 5])
    })

    it('should return fewer items when count exceeds available', () => {
      const buf = new CircularBuffer<number>(5)
      buf.add(1)
      buf.add(2)
      expect(buf.getRecent(10)).toEqual([1, 2])
    })

    it('should return recent items after eviction', () => {
      const buf = new CircularBuffer<number>(3)
      buf.add(1)
      buf.add(2)
      buf.add(3)
      buf.add(4) // evicts 1
      buf.add(5) // evicts 2
      expect(buf.getRecent(2)).toEqual([4, 5])
      expect(buf.getRecent(3)).toEqual([3, 4, 5])
    })

    it('should return empty array when buffer is empty', () => {
      const buf = new CircularBuffer<number>(3)
      expect(buf.getRecent(1)).toEqual([])
    })
  })

  describe('addAll', () => {
    it('should add multiple items at once', () => {
      const buf = new CircularBuffer<number>(5)
      buf.addAll([1, 2, 3])
      expect(buf.toArray()).toEqual([1, 2, 3])
      expect(buf.length).toBe(3)
    })

    it('should evict when addAll exceeds capacity', () => {
      const buf = new CircularBuffer<number>(3)
      buf.addAll([1, 2, 3, 4, 5])
      expect(buf.toArray()).toEqual([3, 4, 5])
    })
  })

  describe('edge cases', () => {
    it('should handle zero capacity', () => {
      const buf = new CircularBuffer<number>(0)
      buf.add(1)
      expect(buf.toArray()).toEqual([])
      expect(buf.length).toBe(0)
    })

    it('should handle undefined/string items', () => {
      const buf = new CircularBuffer<string>(3)
      buf.add('hello')
      buf.add('world')
      expect(buf.getRecent(1)).toEqual(['world'])
    })

    it('should maintain correct order after multiple wrap-arounds', () => {
      const buf = new CircularBuffer<number>(3)
      for (let i = 1; i <= 9; i++) {
        buf.add(i)
      }
      // After 9 adds to capacity 3: items 7, 8, 9 remain
      expect(buf.toArray()).toEqual([7, 8, 9])
    })
  })
})
