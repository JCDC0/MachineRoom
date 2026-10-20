import { describe, expect, it } from 'vitest'
import { createAgyParser } from '../src/model/parsers/agy.js'
import { createClaudeParser } from '../src/model/parsers/claude.js'
import { createHermesParser } from '../src/model/parsers/hermes.js'
import { createParser } from '../src/model/parsers/index.js'
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

  it('maps a grep line to the search kind and keeps the pattern', () => {
    const parser = createHermesParser(ctx)
    const out = parser.push('  \u250a \ud83d\udd0e grep      notes\\.md  1.7s\n', 2000)
    expect(out[0].tool).toBe('search')
    expect(out[0].label).toBe('grep notes\\.md')
    expect(summary(out)).toEqual(['start grep notes\\.md', 'end true'])
  })

  it('reads an [error] suffix as a failed call and [exit 0] as a pass', () => {
    const parser = createHermesParser(ctx)
    const failed = parser.push('  \u250a \ud83d\udcd6 read      strings.js  1.2s [error]\n', 10000)
    expect(summary(failed)).toEqual(['start read src/strings.js', 'end false'])
    expect(failed[0].label).toBe('read src/strings.js')
    const passed = parser.push('  \u250a \ud83d\udcbb $         npm test  2.0s [exit 0]\n', 20000)
    expect(summary(passed)).toEqual(['start $ npm test', 'end true'])
  })

  it('resolves a bare name from the folder of the last read', () => {
    const parser = createHermesParser({ ...ctx, files: [...ctx.files, 'src/a.js', 'src/index.js', 'test/index.js'] })
    parser.push('  \u250a \ud83d\udcd6 read      src/a.js  0.4s\n', 1000)
    const out = parser.push('  \u250a \ud83d\udcd6 read      index.js  0.2s\n', 3000)
    expect(out[0].touches).toEqual([{ path: 'src/index.js', mode: 'read', kind: 'file' }])
    expect(out[0].label).toBe('read src/index.js')
  })

  it('lets a full path decide even after a read in another folder', () => {
    const parser = createHermesParser({ ...ctx, files: [...ctx.files, 'src/a.js', 'src/index.js', 'test/index.js'] })
    parser.push('  \u250a \ud83d\udcd6 read      src/a.js  0.4s\n', 1000)
    const out = parser.push('  \u250a \ud83d\udcd6 read      C:\\Temp\\agent-sandbox\\test\\index.js  0.2s\n', 3000)
    expect(out[0].touches).toEqual([{ path: 'test/index.js', mode: 'read', kind: 'file' }])
  })

  it('keeps a bare name for a first read with no folder yet', () => {
    const parser = createHermesParser({ ...ctx, files: [...ctx.files, 'src/index.js', 'test/index.js'] })
    const out = parser.push('  \u250a \ud83d\udcd6 read      index.js  0.2s\n', 1000)
    expect(out[0].touches).toEqual([{ path: 'index.js', mode: 'read', kind: 'file' }])
    expect(out[0].label).toBe('read index.js')
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

  it('recovers a shell call whose JSON breaks where the mask swallowed a quote', () => {
    const parser = createOpencodeParser(ctx)
    const broken = '{"type":"tool_use","part":{"id":"p9","tool":"shell","state":{"status":"completed","input":{"command":"cat docs/notes.md -H \\"Authorization: ***REDACTED***'
    const out = parser.push(broken + '\n', 9000)
    expect(out[0].tool).toBe('shell')
    expect(out[0].label).toBe('$ cat docs/notes.md -H "Authorization:')
    expect(out[0].touches).toEqual([{ path: 'docs/notes.md', mode: 'read', kind: 'file' }])
    expect(out[1]).toMatchObject({ type: 'tool.end', ok: true })
  })

  it('recovers a shell call whose JSON breaks on the quotes the mask left behind', () => {
    const parser = createOpencodeParser(ctx)
    const broken = '{"type":"tool_use","part":{"id":"p10","tool":"shell","state":{"status":"completed","input":{"command":"Get-Content docs/notes.md -Headers @{ Authorization = \\\\"***REDACTED***\\\\"; ok = 1 }'
    const out = parser.push(broken + '\n', 9000)
    expect(out[0].tool).toBe('shell')
    expect(out[0].touches).toEqual([{ path: 'docs/notes.md', mode: 'read', kind: 'file' }])
    expect(out[1]).toMatchObject({ type: 'tool.end', ok: true })
  })

  it('recovers a file call from a broken line that still holds a complete path', () => {
    const parser = createOpencodeParser(ctx)
    const broken = '{"type":"tool_use","part":{"id":"p11","tool":"read","state":{"status":"completed","input":{"path":"docs/notes.md"},"output":"Authorization: ***REDACTED***'
    const out = parser.push(broken + '\n', 9000)
    expect(summary(out)).toEqual(['start read docs/notes.md', 'end true'])
  })

  it('drops a broken line that holds no tool name or no path or command', () => {
    const parser = createOpencodeParser(ctx)
    const skill = '{"type":"tool_use","part":{"id":"p12","tool":"skill","state":{"status":"completed","input":{"id":"paperclip"},"output":"<skill_content> Authorization: ***REDACTED***'
    expect(parser.push(skill + '\n', 1)).toEqual([])
    const cut = '{"type":"tool_use","part":{"id":"p13","tool":"shell","state":{"input":{"command":"cat docs/notes.md"'
    expect(parser.push(cut + '\n', 1)).toEqual([])
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

describe('tool names that are only inherited names', () => {
  const INHERITED = ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']

  it('reads a Hermes verb such as __proto__ or constructor as other', () => {
    for (const verb of ['__proto__', 'constructor', 'valueof']) {
      const out = createHermesParser(ctx).push(`  \u250a \u2699 ${verb}  thing  0.5s\n`, 1000)
      expect(out[0].tool, verb).toBe('other')
      expect(out[0].touches).toEqual([])
    }
  })

  it('reads an OpenCode tool with such a name as other', () => {
    for (const tool of INHERITED) {
      const out = createOpencodeParser(ctx).push(lines({ type: 'tool_use', part: { id: 'x', tool, state: { status: 'completed', input: {} } } }), 1000)
      expect(out[0].tool, tool).toBe('other')
    }
  })

  it('reads an agy tool with such a name as other instead of throwing', () => {
    for (const name of INHERITED) {
      const out = createAgyParser(ctx).push(lines({ event: 'step_update', step_update: { conversation_id: 'c', step_index: 1, state: 'DONE', step_type: 'tool', tool_name: name, tool_info: {} } }), 1000)
      expect(out[0].tool, name).toBe('other')
      expect(out[1]).toMatchObject({ type: 'tool.end', ok: true })
    }
  })

  it('gives an agent whose parser or adapter is such a name a parser that reads nothing', () => {
    for (const name of INHERITED) {
      const parser = createParser({ parser: name, adapterType: name }, ctx)
      expect(parser.push(lines({ type: 'tool_use', part: { tool: 'read' } }), 1000), name).toEqual([])
      expect(parser.flush(1000)).toEqual([])
    }
  })
})
