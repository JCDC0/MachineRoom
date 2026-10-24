import { describe, expect, it } from 'vitest'
import { createRunLineReader } from '../src/briefs/recording.js'
import { createClaudeParser } from '../src/model/parsers/claude.js'
import { loadScenario, testContext } from './helpers.js'

const ctx = { ...testContext(), agentKey: 'claude' }
const line = (item) => `${JSON.stringify(item)}\n`
const lines = (...items) => items.map(line).join('')

function assistant(content, parent = null) {
  return { type: 'assistant', message: { role: 'assistant', content }, parent_tool_use_id: parent, session_id: 's1' }
}

function use(id, name, input) {
  return { type: 'tool_use', id, name, input }
}

function result(id, isError = false, parent = null) {
  return {
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: '' }] },
    parent_tool_use_id: parent,
    session_id: 's1',
  }
}

function starts(activities) {
  return activities.filter((activity) => activity.type === 'tool.start')
}

describe('claude stream-json', () => {
  it('keeps a background subagent open when its Agent result comes before its own lines', () => {
    const parser = createClaudeParser(ctx)
    const out = parser.push(
      lines(
        assistant([use('a1', 'Agent', { subagent_type: 'Explore', description: 'Read strings' })]),
        result('a1'),
        assistant([use('r1', 'Read', { file_path: 'src/math.js' })]),
        assistant([use('r2', 'Read', { file_path: 'src/strings.js' })], 'a1'),
        result('r2', false, 'a1'),
        result('r1'),
      ),
      0,
    )
    expect(out.filter((activity) => activity.type === 'agent.end')).toEqual([])
    expect(starts(out).map((activity) => [activity.agent, activity.touches[0]?.path])).toEqual([
      ['claude', undefined],
      ['claude', 'src/math.js'],
      ['claude~1', 'src/strings.js'],
    ])
  })

  it('maps each tool name to its touches', () => {
    const parser = createClaudeParser(ctx)
    const out = parser.push(
      lines(
        assistant([use('t1', 'Read', { file_path: 'C:\\Temp\\agent-sandbox\\src\\math.js' })]),
        assistant([use('t2', 'Write', { file_path: 'docs/claude-notes.md' })]),
        assistant([use('t3', 'Edit', { file_path: 'src/math.js' })]),
        assistant([use('t4', 'MultiEdit', { file_path: 'src/strings.js' })]),
        assistant([use('t5', 'NotebookEdit', { notebook_path: 'docs/notes.ipynb' })]),
        assistant([use('t6', 'Glob', { path: 'src' })]),
        assistant([use('t7', 'Glob', {})]),
        assistant([use('t8', 'Grep', { path: 'docs' })]),
        assistant([use('t9', 'LS', { path: 'docs' })]),
        assistant([use('t10', 'Bash', { command: 'cat src/math.js' })]),
        assistant([use('t11', 'WebSearch', { query: 'claude code' })])
      ),
      1000
    )
    const found = Object.fromEntries(starts(out).map((activity) => [activity.id, activity]))
    expect(found.t1).toMatchObject({ tool: 'read', label: 'read src/math.js', agent: 'claude' })
    expect(found.t1.touches).toEqual([{ path: 'src/math.js', mode: 'read', kind: 'file' }])
    expect(found.t2).toMatchObject({ tool: 'write', label: 'write docs/claude-notes.md' })
    expect(found.t2.touches).toEqual([{ path: 'docs/claude-notes.md', mode: 'write', kind: 'file' }])
    expect(found.t3).toMatchObject({ tool: 'edit', label: 'edit src/math.js' })
    expect(found.t3.touches).toEqual([{ path: 'src/math.js', mode: 'write', kind: 'file' }])
    expect(found.t4.touches).toEqual([{ path: 'src/strings.js', mode: 'write', kind: 'file' }])
    expect(found.t5.touches).toEqual([{ path: 'docs/notes.ipynb', mode: 'write', kind: 'file' }])
    expect(found.t6).toMatchObject({ tool: 'search', label: 'glob src' })
    expect(found.t6.touches).toEqual([{ path: 'src', mode: 'list', kind: 'dir' }])
    expect(found.t7).toMatchObject({ tool: 'search', label: 'glob .' })
    expect(found.t7.touches).toEqual([{ path: '', mode: 'list', kind: 'dir' }])
    expect(found.t8.touches).toEqual([{ path: 'docs', mode: 'list', kind: 'dir' }])
    expect(found.t9).toMatchObject({ tool: 'search', label: 'ls docs' })
    expect(found.t9.touches).toEqual([{ path: 'docs', mode: 'list', kind: 'dir' }])
    expect(found.t10).toMatchObject({ tool: 'shell', label: '$ cat src/math.js' })
    expect(found.t10.touches).toEqual([{ path: 'src/math.js', mode: 'read', kind: 'file' }])
    expect(found.t11).toMatchObject({ tool: 'other', label: 'WebSearch' })
    expect(found.t11.touches).toEqual([])
  })

  it('ends a call with its result and reads a failed result', () => {
    const parser = createClaudeParser(ctx)
    parser.push(lines(assistant([use('t1', 'Read', { file_path: 'src/math.js' })]), assistant([use('t2', 'Bash', { command: 'npm test' })])), 1000)
    const out = parser.push(lines(result('t1'), result('t2', true)), 2000)
    expect(out).toEqual([
      { time: 2000, type: 'tool.end', id: 't1', ok: true, agent: 'claude' },
      { time: 2000, type: 'tool.end', id: 't2', ok: false, agent: 'claude' },
    ])
  })

  it('spawns a child from Task and gives its lines the child key', () => {
    const parser = createClaudeParser(ctx)
    const out = parser.push(
      lines(
        assistant([use('parent-task', 'Task', { description: 'Read the notes', subagent_type: 'Explore' })]),
        assistant([use('c1', 'Read', { file_path: 'src/strings.js' })], 'parent-task'),
        assistant([use('c2', 'Read', { file_path: 'docs/notes.md' })], 'parent-task'),
        assistant([use('p1', 'Read', { file_path: 'package.json' })]),
        result('c1', false, 'parent-task'),
        result('c2', false, 'parent-task'),
        result('parent-task')
      ),
      3000
    )
    expect(out.filter((activity) => activity.type === 'agent.spawn')).toEqual([
      { time: 3000, type: 'agent.spawn', agent: 'claude', child: 'claude~1', name: 'Explore', label: 'Read the notes' },
    ])
    const child = starts(out).filter((activity) => activity.agent === 'claude~1')
    expect(child.map((activity) => activity.label)).toEqual(['read src/strings.js', 'read docs/notes.md'])
    expect(child.map((activity) => activity.touches)).toEqual([
      [{ path: 'src/strings.js', mode: 'read', kind: 'file' }],
      [{ path: 'docs/notes.md', mode: 'read', kind: 'file' }],
    ])
    expect(starts(out).find((activity) => activity.id === 'p1')).toMatchObject({ agent: 'claude', label: 'read package.json' })
    expect(out.filter((activity) => activity.type === 'tool.end' && activity.agent === 'claude~1')).toHaveLength(2)
    expect(out.filter((activity) => activity.type === 'agent.end')).toEqual([{ time: 3000, type: 'agent.end', agent: 'claude~1', ok: true }])
  })

  it('fails a child whose Task result is an error', () => {
    const parser = createClaudeParser(ctx)
    parser.push(line(assistant([use('task-2', 'Agent', { description: 'Count the files' })])), 4000)
    const out = parser.push(line(result('task-2', true)), 5000)
    expect(out).toContainEqual({ time: 5000, type: 'agent.end', agent: 'claude~1', ok: false })
    expect(out).toContainEqual({ time: 5000, type: 'tool.end', id: 'task-2', ok: false, agent: 'claude' })
  })

  it('waits for a stream line that arrives in two chunks', () => {
    const parser = createClaudeParser(ctx)
    const full = JSON.stringify(assistant([use('t1', 'Read', { file_path: 'src/math.js' })]))
    expect(parser.push(full.slice(0, 24), 1)).toEqual([])
    const out = parser.push(`${full.slice(24)}\n`, 2)
    expect(starts(out)).toEqual([
      {
        time: 2, type: 'tool.start', id: 't1', tool: 'read', label: 'read src/math.js',
        touches: [{ path: 'src/math.js', mode: 'read', kind: 'file' }], agent: 'claude',
      },
    ])
  })

  it('ends a foreground child that speaks before its result without a tool line', () => {
    const parser = createClaudeParser(ctx)
    const out = parser.push(
      lines(
        assistant([use('task-text', 'Task', { description: 'Read the notes', subagent_type: 'Explore' })]),
        assistant([{ type: 'text', text: 'The notes are short.' }], 'task-text'),
        result('task-text')
      ),
      6000
    )
    expect(out.filter((activity) => activity.type === 'agent.end')).toEqual([
      { time: 6000, type: 'agent.end', agent: 'claude~1', ok: true },
    ])
  })

  it('keeps a background child open when its lines arrive before its result', () => {
    const parser = createClaudeParser(ctx)
    const out = parser.push(
      lines(
        assistant([use('task-bg', 'Agent', { description: 'Count the files', run_in_background: true })]),
        assistant([use('c1', 'Read', { file_path: 'src/strings.js' })], 'task-bg'),
        result('c1', false, 'task-bg'),
        result('task-bg')
      ),
      7000
    )
    expect(starts(out).find((activity) => activity.id === 'c1').agent).toBe('claude~1')
    expect(out.filter((activity) => activity.type === 'agent.end')).toEqual([])
  })

  it('shows the base name of a folder outside the project in a search label', () => {
    const parser = createClaudeParser(ctx)
    const out = parser.push(
      lines(
        assistant([use('g1', 'Glob', { path: 'C:\\Users\\someone\\Documents\\secret' })]),
        assistant([use('g2', 'Grep', { path: 'C:\\Users\\someone\\Documents\\secret' })]),
        assistant([use('g3', 'LS', { path: 'C:/Users/someone/Documents' })])
      ),
      8000
    )
    const found = Object.fromEntries(starts(out).map((activity) => [activity.id, activity]))
    expect(found.g1).toMatchObject({ tool: 'search', label: 'glob secret' })
    expect(found.g1.touches).toEqual([])
    expect(found.g2).toMatchObject({ label: 'grep secret' })
    expect(found.g2.touches).toEqual([])
    expect(found.g3).toMatchObject({ label: 'ls Documents' })
    expect(found.g3.touches).toEqual([])
    expect(JSON.stringify(out)).not.toContain('someone')
  })

  it('keeps a Bash command but shortens a path under the profile folder', () => {
    const parser = createClaudeParser(ctx)
    const out = parser.push(
      lines(
        assistant([use('b1', 'Bash', { command: 'cat C:\\Users\\someone\\Documents\\secret.txt && npm test' })]),
        assistant([use('b2', 'Bash', { command: 'cat "C:/Users/someone/My Documents/notes.txt"' })])
      ),
      9000
    )
    const found = Object.fromEntries(starts(out).map((activity) => [activity.id, activity]))
    expect(found.b1).toMatchObject({ tool: 'shell', label: '$ cat secret.txt && npm test' })
    expect(found.b2).toMatchObject({ tool: 'shell', label: '$ cat "notes.txt"' })
    expect(JSON.stringify(out)).not.toContain('someone')
  })

  it('feeds a lane log through the claude reader and keeps the tool lines', () => {
    const read = createRunLineReader('claude')
    expect(read(JSON.stringify({ type: 'system', subtype: 'init', tools: ['Read'] })).read).toBe(false)
    const entry = read(JSON.stringify(assistant([use('t1', 'Read', { file_path: 'src/math.js' })])))
    expect(entry.read).toBe(true)
    expect(JSON.parse(entry.chunk).message.content[0].name).toBe('Read')
  })

  it('plays scenario-h with a parent, a child and a failed Bash', () => {
    const { activities } = loadScenario('scenario-h')
    const calls = starts(activities)
    expect(calls).toHaveLength(14)
    expect(calls.filter((activity) => activity.agent === 'claude~1')).toHaveLength(3)
    expect(calls.filter((activity) => activity.agent === 'claude')).toHaveLength(11)
    expect(activities.find((activity) => activity.type === 'agent.spawn')).toMatchObject({
      agent: 'claude',
      child: 'claude~1',
      name: 'Explore',
      label: 'Read the notes',
    })
    expect(activities.filter((activity) => activity.type === 'agent.end')).toEqual([
      expect.objectContaining({ agent: 'claude~1', ok: true }),
    ])
    expect(activities.filter((activity) => activity.type === 'tool.end' && activity.ok === false)).toEqual([
      expect.objectContaining({ id: 'toolu_bash', agent: 'claude' }),
    ])
    expect(calls.find((activity) => activity.id === 'toolu_task').touches).toEqual([])
  })
})
