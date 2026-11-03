import { describe, expect, it } from 'vitest'
import { ancestors, makeTree, relativeTo, resolveKnown, visibleText } from '../src/model/paths.js'

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
    expect(relativeTo('agent-sandbox', '.')).toBe('')
  })

  it('returns null for a relative path that climbs out of the project', () => {
    expect(relativeTo('MachineRoom-hermes', '../MachineRoom/docs/agents/TASKS.md')).toBeNull()
    expect(relativeTo('agent-sandbox', 'src/../../secret.txt')).toBeNull()
    expect(relativeTo('agent-sandbox', 'C:\\Temp\\agent-sandbox\\..\\other\\x.js')).toBeNull()
  })

  it('folds dot folders that stay inside the project', () => {
    expect(relativeTo('agent-sandbox', 'src/../docs/./notes.md')).toBe('docs/notes.md')
    expect(relativeTo('agent-sandbox', 'src/')).toBe('src')
  })

  it('reads a relative path when the project has no name yet', () => {
    expect(relativeTo('', 'src/')).toBe('src')
    expect(relativeTo('', 'src/math.js')).toBe('src/math.js')
    expect(relativeTo('', '/etc/hosts')).toBeNull()
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
    expect(resolveKnown('strings.js', files, 'test')).toBe('src/strings.js')
  })

  it('keeps a name that matches nothing', () => {
    expect(resolveKnown('other.js', files)).toBe('other.js')
  })

  it('picks the match whose folder is near', () => {
    const shared = ['src/index.js', 'test/index.js']
    expect(resolveKnown('index.js', shared, 'src')).toBe('src/index.js')
    expect(resolveKnown('index.js', shared, 'test')).toBe('test/index.js')
  })

  it('picks the match that shares the longest leading folder path', () => {
    const shared = ['src/engine/index.js', 'srcx/index.js']
    expect(resolveKnown('index.js', shared, 'src/ui')).toBe('src/engine/index.js')
    expect(resolveKnown('index.js', shared, 'srcx/deep')).toBe('srcx/index.js')
  })

  it('keeps the bare name when the longest shared folder is a tie', () => {
    const shared = ['src/ui/index.js', 'src/engine/index.js']
    expect(resolveKnown('index.js', shared, 'src')).toBe('index.js')
  })

  it('keeps today behaviour without near', () => {
    const shared = ['src/index.js', 'test/index.js']
    expect(resolveKnown('index.js', shared)).toBe('index.js')
  })
})

describe('makeTree', () => {
  it('collects every folder that holds a file', () => {
    const tree = makeTree({ root: 'demo', files: ['b/x.js', 'a/y/z.js'], created: [] })
    expect(tree.dirs).toEqual(['', 'a', 'a/y', 'b'])
    expect(tree.files).toEqual(['a/y/z.js', 'b/x.js'])
  })

  it('builds the same folders by walking the sorted prefixes of a deep list', () => {
    const files = [
      'src/a/one.js',
      'src/a/two.js',
      'src/a/deep/three.js',
      'src/b/one.js',
      'src/b/deep/four.js',
      'top.js',
      'z/last.js',
    ]
    const tree = makeTree({ root: 'demo', files: [...files].reverse(), created: [] })
    expect(tree.files).toEqual([...files].sort())
    expect(tree.dirs).toEqual(['', 'src', 'src/a', 'src/a/deep', 'src/b', 'src/b/deep', 'z'])
  })
})

describe('visibleText', () => {
  const mark = (value) => `[U+${value.toString(16).toUpperCase().padStart(4, '0')}]`
  const bidi = [0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]

  it('marks each bidi control', () => {
    for (const value of bidi) {
      expect(visibleText(`a${String.fromCharCode(value)}b`)).toBe(`a${mark(value)}b`)
    }
  })

  it('marks each C0 control except tab', () => {
    for (let value = 0; value < 0x20; value += 1) {
      if (value === 0x09) continue
      expect(visibleText(`x${String.fromCharCode(value)}y`)).toBe(`x${mark(value)}y`)
    }
  })

  it('keeps a tab', () => {
    expect(visibleText('src/\tmath.js')).toBe('src/\tmath.js')
  })

  it('keeps plain and non-Latin text', () => {
    expect(visibleText('src/model/paths.js')).toBe('src/model/paths.js')
    expect(visibleText('données/日本語/Ω')).toBe('données/日本語/Ω')
  })

  it('keeps characters that are not listed', () => {
    expect(visibleText('a\u200Bb\u007F')).toBe('a\u200Bb\u007F')
  })

  it('marks a mixed line and keeps the rest', () => {
    const line = 'if (a\u202Eb)\u0007 {\n\treturn 1 }'
    expect(visibleText(line)).toBe(`if (a${mark(0x202e)}b)${mark(0x0007)} {${mark(0x000a)}\treturn 1 }`)
  })
})
