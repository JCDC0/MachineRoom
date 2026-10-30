import { describe, expect, it } from 'vitest'
import {
  agentStateWord,
  breadcrumbRows,
  effortForAgent,
  explorerRows,
  formatBytes,
  inspectTarget,
  internetStatus,
  previewLines,
  touchRows,
} from '../src/ui/inspector.js'

const tree = {
  rootName: 'demo',
  dirs: ['', 'docs', 'src', 'src/engine', 'src/ui', 'deep', 'deep/nested'],
  files: [
    'README.md',
    'docs/guide.md',
    'src/a.js',
    'src/engine/room.js',
    'src/ui/Inspector.jsx',
    'deep/nested/only.txt',
  ],
}

describe('the inspector state word', () => {
  it('reads thinking while a run is open and no tool call is open', () => {
    expect(agentStateWord({ status: 'working', openCalls: 0, label: '$ npm test' })).toEqual({
      word: 'thinking',
      tool: '',
      command: '',
    })
  })

  it('reads working with the tool and its command while a call is open', () => {
    expect(
      agentStateWord({ status: 'working', openCalls: 1, tool: 'shell', label: '$ npm test' })
    ).toEqual({
      word: 'working',
      tool: 'shell',
      command: '$ npm test',
    })
  })

  it('reads idle, failed and done otherwise', () => {
    expect(agentStateWord({ status: 'idle' }).word).toBe('idle')
    expect(agentStateWord({ status: 'queued' }).word).toBe('idle')
    expect(agentStateWord({ status: 'error' }).word).toBe('failed')
    expect(agentStateWord({ status: 'cancelled' }).word).toBe('failed')
    expect(agentStateWord({ status: 'done' }).word).toBe('done')
    expect(agentStateWord({ status: 'finished' }).word).toBe('done')
  })
})

describe('the folder explorer rows', () => {
  it('lists the folders inside a folder first and then its files', () => {
    const rows = explorerRows('', tree)
    expect(rows.map((row) => [row.kind, row.path])).toEqual([
      ['dir', 'deep'],
      ['dir', 'docs'],
      ['dir', 'src'],
      ['file', 'README.md'],
    ])
  })

  it('lists a nested folder from the whole tree even when no card holds it', () => {
    expect(explorerRows('src', tree).map((row) => [row.kind, row.path])).toEqual([
      ['dir', 'src/engine'],
      ['dir', 'src/ui'],
      ['file', 'src/a.js'],
    ])
    expect(explorerRows('deep/nested', tree).map((row) => row.path)).toEqual(['deep/nested/only.txt'])
  })

  it('leaves out paths that are not direct children', () => {
    expect(explorerRows('docs', tree).map((row) => row.path)).toEqual(['docs/guide.md'])
    expect(explorerRows('missing', tree)).toEqual([])
  })

  it('builds a breadcrumb from the root to the folder', () => {
    expect(breadcrumbRows('src/ui', 'demo')).toEqual([
      { path: '', name: 'demo' },
      { path: 'src', name: 'src' },
      { path: 'src/ui', name: 'ui' },
    ])
    expect(breadcrumbRows('', 'demo')).toEqual([{ path: '', name: 'demo' }])
  })
})

describe('the inspector helpers', () => {
  it('accepts only the four kinds and keeps a folder root', () => {
    expect(inspectTarget({ kind: 'folder', id: '' })).toEqual({ kind: 'folder', id: '' })
    expect(inspectTarget({ kind: 'file', id: 'src/a.js' })).toEqual({ kind: 'file', id: 'src/a.js' })
    expect(inspectTarget({ kind: 'internet' })).toEqual({ kind: 'internet', id: 'internet' })
    expect(inspectTarget({ kind: 'agent', id: '' })).toBeNull()
    expect(inspectTarget({ kind: 'planet', id: 'x' })).toBeNull()
    expect(inspectTarget(null)).toBeNull()
  })

  it('reads the file preview notices as they come', () => {
    expect(previewLines({ binary: true })).toEqual({ notice: 'Binary file.', text: '' })
    expect(previewLines({ truncated: true, text: 'abc' })).toEqual({
      notice: 'Too large, showing the first 256 KB.',
      text: 'abc',
    })
    expect(previewLines({ text: '<b>plain</b>' })).toEqual({ notice: '', text: '<b>plain</b>' })
  })

  it('formats sizes, connection words and touch rows', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(null)).toBe('not reported')
    expect(internetStatus(true)).toBe('Connected')
    expect(internetStatus(false)).toBe('No connection')
    expect(internetStatus(null)).toBe('Connection not reported')
    expect(touchRows([{ key: 'opencode', mode: 'read', time: 10 }, { key: '', mode: 'read', time: 20 }])).toEqual([
      { key: 'opencode', mode: 'read', time: 10 },
    ])
  })

  it('reads effort from the family node or the orchestrator', () => {
    expect(
      effortForAgent({
        key: 'opencode',
        harness: 'opencode',
        family: [{ id: 'opencode', kind: 'lane', harness: 'opencode', effort: 'max' }],
      })
    ).toBe('max')
    expect(
      effortForAgent({
        key: 'orchestrator',
        harness: 'claude',
        orchestrators: [{ id: 'orchestrator', harness: 'claude', effort: 'high' }],
      })
    ).toBe('high')
    expect(effortForAgent({ key: 'opencode', harness: 'opencode' })).toBe('default')
  })
})
