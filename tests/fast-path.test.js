import { describe, expect, it } from 'vitest'
import { parentPath } from '../src/engine/fastPath.js'

describe('parentPath', () => {
  it('returns empty string for empty or missing input', () => {
    expect(parentPath('')).toBe('')
    expect(parentPath(null)).toBe('')
    expect(parentPath(undefined)).toBe('')
  })

  it('returns empty string for top-level paths', () => {
    expect(parentPath('src')).toBe('')
    expect(parentPath('README.md')).toBe('')
    expect(parentPath('docs')).toBe('')
  })

  it('returns parent folder for nested paths', () => {
    expect(parentPath('src/engine')).toBe('src')
    expect(parentPath('src/engine/cards.js')).toBe('src/engine')
    expect(parentPath('a/b/c/d/e.txt')).toBe('a/b/c/d')
  })

  it('handles multiple segments correctly', () => {
    let current = 'a/b/c/d'
    const chain = [current]
    while (current !== '') {
      current = parentPath(current)
      chain.push(current)
    }
    expect(chain).toEqual(['a/b/c/d', 'a/b/c', 'a/b', 'a', ''])
  })
})
