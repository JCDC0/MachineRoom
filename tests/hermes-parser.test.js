import { describe, expect, it } from 'vitest'
import { createHermesParser } from '../src/model/parsers/hermes.js'
import { unreadableLines } from '../src/model/parsers/unreadable.js'
import { testContext } from './helpers.js'

const ctx = testContext()
const line = (item) => `${JSON.stringify(item)}\n`
const summary = (activities) =>
  activities.filter((a) => a.type === 'tool.start' || a.type === 'tool.end').map((a) => (a.type === 'tool.start' ? `start ${a.label}` : `end ${a.ok}`))

describe('the Hermes parser and its JSON call lines', () => {
  it('starts a call at a call line and ends it at its result', () => {
    const parser = createHermesParser(ctx)
    const started = parser.push(line({ hermes: 'call', id: 'c1', name: 'read_file', args: { path: 'src/math.js' } }), 1000)
    expect(summary(started)).toEqual(['start read src/math.js'])
    expect(started[0]).toMatchObject({ tool: 'read', id: 'c1', touches: [{ path: 'src/math.js', mode: 'read', kind: 'file' }] })
    const ended = parser.push(line({ hermes: 'result', id: 'c1', ok: true }), 2000)
    expect(summary(ended)).toEqual(['end true'])
    expect(ended[0]).toMatchObject({ type: 'tool.end', id: 'c1', ok: true })
  })

  it('waits between the two halves of a chunk and reads args as a JSON string', () => {
    const parser = createHermesParser(ctx)
    const full = JSON.stringify({ hermes: 'call', id: 'c2', name: 'write_file', args: JSON.stringify({ path: 'src/new.js' }) })
    expect(parser.push(full.slice(0, 30), 1)).toEqual([])
    const out = parser.push(`${full.slice(30)}\n`, 2)
    expect(out[0]).toMatchObject({ tool: 'write', touches: [{ path: 'src/new.js', mode: 'write', kind: 'file' }] })
  })

  it('maps write_file to write and patch to edit', () => {
    const parser = createHermesParser(ctx)
    const wrote = parser.push(line({ hermes: 'call', id: 'a', name: 'write_file', args: { path: 'docs/notes.md' } }), 10)
    expect(wrote[0].tool).toBe('write')
    const patched = parser.push(line({ hermes: 'call', id: 'b', name: 'patch', args: { path: 'docs/notes.md' } }), 20)
    expect(patched[0]).toMatchObject({ tool: 'edit', label: 'edit docs/notes.md', touches: [{ path: 'docs/notes.md', mode: 'write', kind: 'file' }] })
  })

  it('reads a terminal call as a shell command with its files', () => {
    const parser = createHermesParser(ctx)
    const out = parser.push(line({ hermes: 'call', id: 't1', name: 'terminal', args: { command: 'cat src/math.js', workdir: '.' } }), 500)
    expect(out[0]).toMatchObject({ tool: 'shell', label: '$ cat src/math.js' })
    expect(out[0].touches.map((touch) => touch.path)).toEqual(['src/math.js'])
    const noCommand = parser.push(line({ hermes: 'call', id: 't2', name: 'terminal', args: { workdir: 'src' } }), 600)
    expect(noCommand[0].label).toBe('$ src')
  })

  it('maps search_files to search with its pattern', () => {
    const parser = createHermesParser(ctx)
    const out = parser.push(line({ hermes: 'call', id: 's1', name: 'search_files', args: { pattern: 'export function', path: 'src' } }), 700)
    expect(out[0]).toMatchObject({ tool: 'search', label: 'search export function', touches: [] })
  })

  it('maps the web tools to the web kind', () => {
    const parser = createHermesParser(ctx)
    const searched = parser.push(line({ hermes: 'call', id: 'w1', name: 'web_search', args: { query: 'hermes tools' } }), 800)
    expect(searched[0]).toMatchObject({ tool: 'web', label: 'web search hermes tools', touches: [] })
    const fetched = parser.push(line({ hermes: 'call', id: 'w2', name: 'web_fetch', args: { url: 'https://example.com' } }), 900)
    expect(fetched[0]).toMatchObject({ tool: 'web', label: 'web fetch https://example.com' })
  })

  it('reads an unknown tool as other and keeps its name', () => {
    const parser = createHermesParser(ctx)
    const out = parser.push(line({ hermes: 'call', id: 'x1', name: 'todo_write', args: {} }), 1000)
    expect(out[0]).toMatchObject({ tool: 'other', label: 'todo_write' })
  })

  it('gives a call with no id a number of its own', () => {
    const parser = createHermesParser(ctx)
    const out = parser.push(line({ hermes: 'call', name: 'read_file', args: { path: 'src/math.js' } }), 1000)
    expect(out[0].id).toBe('hermes-1')
  })

  it('marks a failed result as a failed call', () => {
    const parser = createHermesParser(ctx)
    parser.push(line({ hermes: 'call', id: 'f1', name: 'terminal', args: { command: 'npm test' } }), 1000)
    const out = parser.push(line({ hermes: 'result', id: 'f1', ok: false }), 2000)
    expect(out).toEqual([{ time: 2000, type: 'tool.end', id: 'f1', ok: false }])
  })

  it('spawns one child for delegate_task and ends it at the result', () => {
    const parser = createHermesParser({ ...ctx, agentKey: 'hermes' })
    const started = parser.push(
      line({ hermes: 'call', id: 'd1', name: 'delegate_task', args: { tasks: [{ goal: 'Count the exported functions' }] } }),
      1000
    )
    expect(summary(started)).toEqual(['start delegate Count the exported functions'])
    expect(started.filter((a) => a.type === 'agent.spawn')).toEqual([
      { time: 1000, type: 'agent.spawn', agent: 'hermes', child: 'hermes~1', name: 'Count the exported functions', label: 'delegate Count the exported functions' },
    ])
    const ended = parser.push(line({ hermes: 'result', id: 'd1', ok: true }), 5000)
    expect(ended.filter((a) => a.type === 'agent.end')).toEqual([{ time: 5000, type: 'agent.end', agent: 'hermes~1', ok: true }])
  })

  it('names a delegate_task child from a JSON string of tasks', () => {
    const parser = createHermesParser({ ...ctx, agentKey: 'hermes' })
    const out = parser.push(line({ hermes: 'call', id: 'd2', name: 'delegate_task', args: JSON.stringify({ tasks: [{ description: 'Read the docs' }] }) }), 1000)
    expect(out.find((a) => a.type === 'agent.spawn').name).toBe('Read the docs')
  })

  it('puts a child session calls on a child of its own', () => {
    const parser = createHermesParser({ ...ctx, agentKey: 'hermes' })
    const out = parser.push(line({ hermes: 'call', id: 'k1', name: 'read_file', args: { path: 'src/math.js' }, agent: 'sub-1', agentName: 'worker' }), 1000)
    expect(out.filter((a) => a.type === 'agent.spawn')).toEqual([
      { time: 1000, type: 'agent.spawn', agent: 'hermes', child: 'hermes~1', name: 'worker', label: 'worker' },
    ])
    expect(out[out.length - 1]).toMatchObject({ type: 'tool.start', tool: 'read', agent: 'hermes~1' })
    const again = parser.push(line({ hermes: 'call', id: 'k2', name: 'read_file', args: { path: 'docs/notes.md' }, agent: 'sub-1' }), 2000)
    expect(again.filter((a) => a.type === 'agent.spawn')).toEqual([])
    const ended = parser.push(line({ hermes: 'result', id: 'k2', ok: true }), 3000)
    expect(ended[0]).toMatchObject({ type: 'tool.end', agent: 'hermes~1' })
  })

  it('keeps reading the boxed lines it read before', () => {
    const parser = createHermesParser(ctx)
    const out = parser.push('  \u250a \ud83d\udcd6 read      strings.js  1.2s\n', 10000)
    expect(summary(out)).toEqual(['start read src/strings.js', 'end true'])
    expect(unreadableLines('hermes', '  \u250a \ud83d\udcd6 read      strings.js  1.2s\n')).toEqual([])
  })
})
