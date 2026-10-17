import { describe, expect, it } from 'vitest'
import { createAgyParser } from '../src/model/parsers/agy.js'
import { createClaudeParser } from '../src/model/parsers/claude.js'
import { createHermesParser } from '../src/model/parsers/hermes.js'
import { createOpencodeParser } from '../src/model/parsers/opencode.js'
import { testContext } from './helpers.js'

const ctx = testContext()
const lines = (...items) => items.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join('\n') + '\n'
const summary = (activities) => activities.map((a) => (a.type === 'tool.start' ? `start ${a.label}` : `end ${a.ok}`))

describe('claude parser', () => {
  it('turns an edit into a write touch and a completed end', () => {
    const parser = createClaudeParser(ctx)
    const out = parser.push(
      lines(
        { type: 'acpx.tool_call', name: 'Edit', toolCallId: 't1', status: 'pending', tag: 'tool_call' },
        { type: 'acpx.tool_call', name: 'Edit src\\math.js', toolCallId: 't1', tag: 'tool_call_update' },
        { type: 'acpx.tool_call', name: 'Edit', toolCallId: 't1', status: 'completed', text: 'done', tag: 'tool_call_update' }
      ),
      1000
    )
    expect(summary(out)).toEqual(['start edit src/math.js', 'end true'])
    expect(out[0].touches).toEqual([{ path: 'src/math.js', mode: 'write', kind: 'file' }])
  })

  it('reads the command from a terminal call and finds files in it', () => {
    const parser = createClaudeParser(ctx)
    const out = parser.push(
      lines(
        { type: 'acpx.tool_call', name: 'Terminal', toolCallId: 't2', status: 'pending', tag: 'tool_call' },
        { type: 'acpx.tool_call', name: 'cat src/math.js', toolCallId: 't2', tag: 'tool_call_update' },
        { type: 'acpx.tool_call', name: 'Terminal', toolCallId: 't2', status: 'completed', text: 'ok', tag: 'tool_call_update' }
      ),
      2000
    )
    expect(out[0].label).toBe('$ cat src/math.js')
    expect(out[0].touches.map((t) => t.path)).toEqual(['src/math.js'])
  })

  it('marks a failing test run as failed', () => {
    const parser = createClaudeParser(ctx)
    const out = parser.push(
      lines(
        { type: 'acpx.tool_call', name: 'Terminal', toolCallId: 't3', status: 'pending', tag: 'tool_call' },
        { type: 'acpx.tool_call', name: 'node --test', toolCallId: 't3', tag: 'tool_call_update' },
        { type: 'acpx.tool_call', name: 'Terminal', toolCallId: 't3', status: 'completed', text: '\u2716 add sums two numbers', tag: 'tool_call_update' }
      ),
      3000
    )
    expect(out[out.length - 1]).toMatchObject({ type: 'tool.end', ok: false })
  })

  it('ignores a file outside the project but still reports the call', () => {
    const parser = createClaudeParser(ctx)
    const out = parser.push(
      lines({ type: 'acpx.tool_call', name: 'Read C:\\Users\\user\\.paperclip\\SKILL.md', toolCallId: 't4', tag: 'tool_call_update' }),
      4000
    )
    expect(out[0].touches).toEqual([])
    expect(out[0].label).toBe('read SKILL.md')
  })

  it('waits for a line that arrives in two chunks', () => {
    const parser = createClaudeParser(ctx)
    const full = JSON.stringify({ type: 'acpx.tool_call', name: 'Read src\\math.js', toolCallId: 't5', tag: 'tool_call_update' })
    expect(parser.push(full.slice(0, 20), 1)).toEqual([])
    expect(summary(parser.push(full.slice(20) + '\n', 2))).toEqual(['start read src/math.js'])
  })
})

describe('hermes parser', () => {
  it('resolves a bare file name and ends the call at the line time', () => {
    const parser = createHermesParser(ctx)
    const out = parser.push('  \u250a \ud83d\udcd6 read      strings.js  1.2s\n', 10000)
    expect(summary(out)).toEqual(['start read src/strings.js', 'end true'])
    expect(out[0].time).toBe(8800)
    expect(out[1].time).toBe(10000)
  })

  it('reports a shell command with its files and a failed exit', () => {
    const parser = createHermesParser(ctx)
    const out = parser.push('  \u250a \ud83d\udcbb $         cat src/math.js + 2 commands  1.0s [exit 1]\n', 5000)
    expect(out[0].label).toBe('$ cat src/math.js')
    expect(out[0].touches.map((t) => t.path)).toEqual(['src/math.js'])
    expect(out[1].ok).toBe(false)
  })

  it('ignores progress lines without a duration', () => {
    const parser = createHermesParser(ctx)
    expect(parser.push('  \u250a \ud83d\udcbb preparing terminal\u2026\n', 1)).toEqual([])
  })
})

describe('opencode parser', () => {
  it('maps a read tool_use to a read touch', () => {
    const parser = createOpencodeParser(ctx)
    const out = parser.push(
      lines({ type: 'tool_use', part: { id: 'p1', tool: 'read', state: { status: 'completed', input: { path: 'C:\\Temp\\agent-sandbox\\src\\math.js' }, output: 'x' } } }),
      9000
    )
    expect(summary(out)).toEqual(['start read src/math.js', 'end true'])
  })

  it('takes the path of a write from the output when the input has none', () => {
    const parser = createOpencodeParser(ctx)
    const out = parser.push(
      lines({ type: 'tool_use', part: { id: 'p2', tool: 'write', state: { status: 'completed', input: { content: 'x' }, output: 'Created file successfully: test/strings.test.js' } } }),
      9000
    )
    expect(out[0].touches).toEqual([{ path: 'test/strings.test.js', mode: 'write', kind: 'file' }])
  })

  it('turns an error event into an error activity', () => {
    const parser = createOpencodeParser(ctx)
    const out = parser.push(lines({ type: 'error', error: { message: 'Upstream request failed' } }), 7000)
    expect(out).toEqual([{ time: 7000, type: 'error', text: 'Upstream request failed' }])
  })
})

describe('agy parser', () => {
  const step = (state, name, parameters, output = '') => ({
    event: 'step_update',
    step_update: { conversation_id: 'c1', step_index: 4, state, step_type: 'tool', tool_name: name, tool_info: { name, parameters, output } },
  })

  it('starts on ACTIVE and ends on DONE', () => {
    const parser = createAgyParser(ctx)
    const first = parser.push(lines(step('ACTIVE', 'view_file', { AbsolutePath: 'C:\\Temp\\agent-sandbox\\src\\math.js' })), 100)
    const second = parser.push(lines(step('DONE', 'view_file', { AbsolutePath: 'C:\\Temp\\agent-sandbox\\src\\math.js' })), 200)
    expect(summary(first)).toEqual(['start read src/math.js'])
    expect(summary(second)).toEqual(['end true'])
  })

  it('fails a command whose output shows a failing test', () => {
    const parser = createAgyParser(ctx)
    const out = parser.push(lines(step('DONE', 'run_command', { CommandLine: 'npm test' }, '\u2716 add sums two numbers')), 300)
    expect(out[out.length - 1]).toMatchObject({ type: 'tool.end', ok: false })
  })

  it('maps write_to_file to a write touch', () => {
    const parser = createAgyParser(ctx)
    const out = parser.push(lines(step('ACTIVE', 'write_to_file', { TargetFile: 'C:\\Temp\\agent-sandbox\\docs\\agy-report.md' })), 400)
    expect(out[0].touches).toEqual([{ path: 'docs/agy-report.md', mode: 'write', kind: 'file' }])
  })
})
