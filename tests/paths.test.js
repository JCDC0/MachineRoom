import { describe, expect, it } from 'vitest'
import { ancestors, makeTree, relativeTo, resolveKnown } from '../src/model/paths.js'

describe('relativeTo', () => {
  it('strips an absolute Windows path down to the project', () => {
    expect(relativeTo('agent-sandbox', 'C:\\Users\\user\\Temp\\agent-sandbox\\src\\math.js')).toBe('src/math.js')
  })

  it('keeps a relative path as it is', () => {
    expect(relativeTo('agent-sandbox', 'src\\math.js')).toBe('src/math.js')
    expect(relativeTo('agent-sandbox', './docs/notes.md')).toBe('docs/notes.md')
  })

  it('returns null for a path outside the project', () => {
    expect(relativeTo('agent-sandbox', 'C:\\Users\\user\\.paperclip\\skills\\SKILL.md')).toBeNull()
    expect(relativeTo('agent-sandbox', '/etc/hosts')).toBeNull()
  })

  it('returns an empty string for the project folder itself', () => {
    expect(relativeTo('agent-sandbox', 'C:\\Temp\\agent-sandbox')).toBe('')
  })
})

describe('ancestors', () => {
  it('lists the root first and the parent last', () => {
    expect(ancestors('src/a/b.js')).toEqual(['', 'src', 'src/a'])
    expect(ancestors('package.json')).toEqual([''])
  })
})

describe('resolveKnown', () => {
  const files = ['src/math.js', 'src/strings.js', 'docs/notes.md']

  it('resolves a bare file name when it is unique', () => {
    expect(resolveKnown('strings.js', files)).toBe('src/strings.js')
  })

  it('keeps a name that matches nothing', () => {
    expect(resolveKnown('other.js', files)).toBe('other.js')
  })
})

describe('makeTree', () => {
  it('collects every folder that holds a file', () => {
    const tree = makeTree({ root: 'demo', files: ['b/x.js', 'a/y/z.js'], created: [] })
    expect(tree.dirs).toEqual(['', 'a', 'a/y', 'b'])
    expect(tree.files).toEqual(['a/y/z.js', 'b/x.js'])
  })
})
