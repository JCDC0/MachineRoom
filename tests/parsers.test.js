import { describe, expect, it } from 'vitest'
import { createAgyParser } from '../src/model/parsers/agy.js'
import { createClaudeParser } from '../src/model/parsers/claude.js'
import { createHermesParser } from '../src/model/parsers/hermes.js'
import { createParser } from '../src/model/parsers/index.js'
import { createOpencodeParser } from '../src/model/parsers/opencode.js'
import { looksFailed } from '../src/model/parsers/common.js'
import { unreadableLines } from '../src/model/parsers/unreadable.js'
import { testContext } from './helpers.js'

const ctx = testContext()
const lines = (...items) => items.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join('\n') + '\n'
const summary = (activities) =>
  activities.filter((a) => a.type === 'tool.start' || a.type === 'tool.end').map((a) => (a.type === 'tool.start' ? `start ${a.label}` : `end ${a.ok}`))

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

  it('gives a Task tool call the task kind', () => {
    const parser = createClaudeParser(ctx)
    const out = parser.push(
      lines({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 't-task', name: 'Task', input: { description: 'Search files' } }],
        },
      }),
      1000
    )
    expect(out[0]).toMatchObject({ type: 'tool.start', id: 't-task', tool: 'task', label: 'task: Search files' })
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

  it('recognizes a known relative path with no directory through indexFor', () => {
    const parser = createHermesParser({ ...ctx, files: ['root.js', 'src/index.js'] })
    const out = parser.push('  \u250a \ud83d\udcd6 read      root.js  0.4s\n', 1000)
    expect(out[0].touches).toEqual([{ path: 'root.js', mode: 'read', kind: 'file' }])
  })

  it('maps a web search and a web fetch line to the web kind with no touch', () => {
    const parser = createHermesParser(ctx)
    const searched = parser.push('  \u250a \ud83d\udd0d search    hermes web tools  1.4s\n', 3000)
    expect(searched[0]).toMatchObject({ tool: 'web', label: 'web search hermes web tools', touches: [] })
    const fetched = parser.push('  \u250a \ud83d\udcc4 fetch     example.com  0.8s\n', 4000)
    expect(fetched[0]).toMatchObject({ tool: 'web', label: 'web fetch example.com', touches: [] })
  })

  it('reports a delegate line as one child at the line time', () => {
    const parser = createHermesParser({ ...ctx, agentKey: 'hermes' })
    const line = '  \u250a \ud83d\udd00 delegate  1x: Count the exported functions...  14.4s\n'
    const out = parser.push(line, 10000)
    expect(summary(out)).toEqual(['start delegate 1x: Count the exported functions...', 'end true'])
    expect(unreadableLines('hermes', line)).toEqual([])
    expect(out.filter((a) => a.type === 'agent.spawn')).toEqual([
      {
        time: 10000,
        type: 'agent.spawn',
        agent: 'hermes',
        child: 'hermes~1',
        name: 'Count the exported functions',
        label: 'delegate 1x: Count the exported functions...',
      },
    ])
    expect(out.filter((a) => a.type === 'agent.end')).toEqual([{ time: 10000, type: 'agent.end', agent: 'hermes~1', ok: true }])
  })
})

describe('opencode parser', () => {
  it('maps a read of a folder to a dir touch', () => {
    const parser = createOpencodeParser(ctx)
    const out = parser.push(
      lines({ type: 'tool_use', part: { id: 'p0', tool: 'read', state: { status: 'completed', input: { path: 'C:\\Temp\\agent-sandbox\\src' }, output: '' } } }),
      9000
    )
    expect(out[0].touches).toEqual([{ path: 'src', mode: 'list', kind: 'dir' }])
  })

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

  it('maps the websearch and webfetch tools to the web kind with the query or url', () => {
    const parser = createOpencodeParser(ctx)
    const out = parser.push(
      lines(
        { type: 'tool_use', part: { id: 'w1', tool: 'websearch', state: { status: 'completed', input: { query: 'hermes web tools' } } } },
        { type: 'tool_use', part: { id: 'w2', tool: 'webfetch', state: { status: 'completed', input: { url: 'https://example.com/docs' } } } }
      ),
      9000
    )
    expect(out[0]).toMatchObject({ tool: 'web', label: 'web search hermes web tools', touches: [] })
    expect(out[2]).toMatchObject({ tool: 'web', label: 'web fetch https://example.com/docs', touches: [] })
  })

  it('maps an opencode search to a folder touch and names the folder in its label', () => {
    const parser = createOpencodeParser(ctx)
    const out = parser.push(
      lines({
        type: 'tool_use',
        part: {
          id: 's1',
          tool: 'grep',
          state: { status: 'completed', input: { pattern: 'render', path: 'C:\\Temp\\agent-sandbox\\src' } },
        },
      }),
      9000
    )
    expect(out[0]).toMatchObject({
      tool: 'search',
      label: 'grep src',
      touches: [{ path: 'src', mode: 'list', kind: 'dir' }],
    })
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

  it('names a subagent call by its description and touches no file', () => {
    const parser = createOpencodeParser({ ...ctx, agentKey: 'opencode' })
    const line = lines({
      type: 'tool_use',
      timestamp: 8000,
      sessionID: 'ses_a',
      part: {
        type: 'tool',
        tool: 'subagent',
        id: 'call_1',
        state: {
          status: 'completed',
          input: { agent: 'general', description: 'Count exported functions', prompt: 'Read src/model/paths.js and src/model/commands.js' },
          metadata: { sessionID: 'ses_b' },
          time: { start: 1000, end: 8000 },
        },
      },
    })
    const out = parser.push(line, 8000)
    expect(summary(out)).toEqual(['start subagent: Count exported functions', 'end true'])
    expect(unreadableLines('opencode', line)).toEqual([])
    expect(out[0].tool).toBe('other')
    expect(out[0].touches).toEqual([])
    expect(out[0].time).toBe(7700)
    expect(out[1]).toMatchObject({ type: 'tool.end', id: 'call_1', ok: true, time: 8000 })
    expect(out.filter((a) => a.type === 'agent.spawn')).toEqual([
      {
        time: 8000,
        type: 'agent.spawn',
        agent: 'opencode',
        child: 'opencode~1',
        name: 'Count exported functions',
        label: 'subagent: Count exported functions',
      },
    ])
    expect(out.filter((a) => a.type === 'agent.end')).toEqual([{ time: 8000, type: 'agent.end', agent: 'opencode~1', ok: true }])
  })

  it('fails a subagent call whose status is error', () => {
    const parser = createOpencodeParser(ctx)
    const out = parser.push(
      lines({ type: 'tool_use', part: { id: 'call_2', tool: 'subagent', state: { status: 'error', input: { agent: 'general', description: 'Count exported functions' } } } }),
      8000
    )
    expect(out[1]).toMatchObject({ type: 'tool.end', ok: false })
  })

  it('labels a subagent call with no description as subagent', () => {
    const parser = createOpencodeParser(ctx)
    const out = parser.push(lines({ type: 'tool_use', part: { id: 'call_3', tool: 'subagent', state: { status: 'completed', input: { agent: 'general' } } } }), 8000)
    expect(out[0].label).toBe('subagent')
    expect(out[0].touches).toEqual([])
  })

  it('looks up a tool name with mixed case', () => {
    const parser = createOpencodeParser(ctx)
    const out = parser.push(lines({ type: 'tool_use', part: { id: 'call_4', tool: 'Read', state: { status: 'completed', input: { path: 'src/math.js' } } } }), 8000)
    expect(out[0].tool).toBe('read')
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

  it('ends an error step as failed with the error in its label', () => {
    const parser = createAgyParser(ctx)
    const out = parser.push(
      lines({
        event: 'step_update',
        step_update: {
          conversation_id: 'c1',
          step_index: 4,
          state: 'ERROR',
          step_type: 'tool',
          tool_name: 'read_file',
          tool_info: { error: 'file not found', parameters: { Path: 'src/missing.js' } },
        },
      }),
      350
    )
    expect(out[0]).toMatchObject({ type: 'tool.start', label: 'read src/missing.js: file not found' })
    expect(out[1]).toMatchObject({ type: 'tool.end', ok: false, label: 'read src/missing.js: file not found' })
  })

  it('ends an active step that errors as failed with the error in its label', () => {
    const parser = createAgyParser(ctx)
    const first = parser.push(lines(step('ACTIVE', 'read_file', { Path: 'src/missing.js' })), 360)
    expect(first[0]).toMatchObject({ type: 'tool.start', label: 'read src/missing.js' })
    const second = parser.push(
      lines({
        event: 'step_update',
        step_update: {
          conversation_id: 'c1',
          step_index: 4,
          state: 'ERROR',
          step_type: 'tool',
          tool_name: 'read_file',
          tool_info: { error: 'permission denied', parameters: { Path: 'src/missing.js' } },
        },
      }),
      370
    )
    expect(second[0]).toMatchObject({ type: 'tool.end', ok: false, label: 'read src/missing.js: permission denied' })
  })

  it('forgets a label once its call ends', () => {
    const parser = createAgyParser(ctx)
    parser.push(lines(step('ACTIVE', 'read_file', { Path: 'src/a.js' })), 500)
    parser.push(lines(step('DONE', 'read_file', { Path: 'src/a.js' })), 510)
    const out = parser.push(
      lines({
        event: 'step_update',
        step_update: {
          conversation_id: 'c1',
          step_index: 4,
          state: 'ERROR',
          step_type: 'tool',
          tool_name: 'write_to_file',
          tool_info: { error: 'denied', parameters: { TargetFile: 'src/b.js' } },
        },
      }),
      520
    )
    expect(out[0]).toMatchObject({ type: 'tool.end', label: 'write_to_file: denied', error: 'denied' })
  })

  it('maps write_to_file to a write touch', () => {
    const parser = createAgyParser(ctx)
    const out = parser.push(lines(step('ACTIVE', 'write_to_file', { TargetFile: 'C:\\Temp\\agent-sandbox\\docs\\agy-report.md' })), 400)
    expect(out[0].touches).toEqual([{ path: 'docs/agy-report.md', mode: 'write', kind: 'file' }])
  })

  it('maps read_file, write_file and edit_file by Path', () => {
    const parser = createAgyParser(ctx)
    const tool = (index, name, path) => ({
      event: 'step_update',
      step_update: { conversation_id: 'c1', step_index: index, state: 'ACTIVE', step_type: 'tool', tool_name: name, tool_info: { parameters: { Path: path } } },
    })
    const out = parser.push(
      lines(
        tool(1, 'read_file', 'C:\\Temp\\agent-sandbox\\src\\strings.js'),
        tool(2, 'write_file', 'C:\\Temp\\agent-sandbox\\docs\\main-notes.md'),
        tool(3, 'edit_file', 'C:\\Temp\\agent-sandbox\\docs\\main-notes.md')
      ),
      450
    )
    expect(out.map((activity) => `${activity.tool} ${activity.label}`)).toEqual([
      'read read src/strings.js',
      'write write docs/main-notes.md',
      'edit edit docs/main-notes.md',
    ])
    expect(out[2].touches).toEqual([{ path: 'docs/main-notes.md', mode: 'write', kind: 'file' }])
  })

  it('maps search_web and read_url_content to the web kind with no touch', () => {
    const parser = createAgyParser(ctx)
    const webStep = (index, name, parameters) => ({
      event: 'step_update',
      step_update: { conversation_id: 'c1', step_index: index, state: 'ACTIVE', step_type: 'tool', tool_name: name, tool_info: { parameters } },
    })
    const out = parser.push(
      lines(
        webStep(1, 'search_web', { query: 'hermes web tools' }),
        webStep(2, 'read_url_content', { url: 'https://example.com/docs' })
      ),
      500
    )
    expect(out[0]).toMatchObject({ tool: 'web', label: 'web search hermes web tools', touches: [] })
    expect(out[1]).toMatchObject({ tool: 'web', label: 'web fetch https://example.com/docs', touches: [] })
  })

  it('maps call_mcp_tool to mcp kind and keeps server tool and path in label', () => {
    const parser = createAgyParser(ctx)
    const out = parser.push(
      lines({
        event: 'step_update',
        step_update: {
          conversation_id: 'c1',
          step_index: 1,
          state: 'ACTIVE',
          step_type: 'tool',
          tool_name: 'call_mcp_tool',
          tool_info: {
            parameters: {
              ServerName: 'git',
              ToolName: 'read_file',
              Arguments: { Path: 'C:\\Temp\\agent-sandbox\\src\\math.js' },
            },
          },
        },
      }),
      550
    )
    expect(out[0]).toMatchObject({
      tool: 'mcp',
      label: 'mcp git read_file src/math.js',
      touches: [{ path: 'src/math.js', mode: 'read', kind: 'file' }],
    })
  })

  it('maps manage_task and schedule to plan and wait kinds with useful labels', () => {
    const parser = createAgyParser(ctx)
    const out = parser.push(
      lines(
        {
          event: 'step_update',
          step_update: {
            conversation_id: 'c1',
            step_index: 1,
            state: 'ACTIVE',
            step_type: 'tool',
            tool_name: 'manage_task',
            tool_info: { parameters: { Action: 'status', TaskId: 'task-9' } },
          },
        },
        {
          event: 'step_update',
          step_update: {
            conversation_id: 'c1',
            step_index: 2,
            state: 'ACTIVE',
            step_type: 'tool',
            tool_name: 'schedule',
            tool_info: { parameters: { DurationSeconds: 30 } },
          },
        }
      ),
      560
    )
    expect(out[0]).toMatchObject({ tool: 'plan', label: 'task status task-9' })
    expect(out[1]).toMatchObject({ tool: 'wait', label: 'wait 30s' })
  })

  it('spawns an invoked subagent and ends it when a listing shows it idle', () => {
    const parser = createAgyParser({ ...ctx, agentKey: 'agy' })
    const active = {
      event: 'step_update',
      step_update: {
        conversation_id: 'c1',
        step_index: 4,
        state: 'ACTIVE',
        step_type: 'tool',
        tool_name: 'invoke_subagent',
        tool_info: { parameters: { Role: 'Math Documenter', TypeName: 'self' } },
      },
    }
    const done = {
      event: 'step_update',
      step_update: {
        conversation_id: 'c1',
        step_index: 4,
        state: 'DONE',
        step_type: 'subagent',
        tool_name: 'invoke_subagent',
        subagent_info: { subagents: [{ role: 'Math Documenter', initial_prompt: 'Read src/strings.js.', conversation_id: 'child-1' }] },
      },
    }
    const list = (index, state) => ({
      event: 'step_update',
      step_update: {
        conversation_id: 'c1',
        step_index: index,
        state: 'DONE',
        step_type: 'tool',
        tool_name: 'manage_subagents',
        tool_info: { parameters: { Action: 'list' }, output: `You have 1 active subagent(s):\n[{"role":"Math Documenter","conversationId":"child-1","state":"${state}"}]` },
      },
    })
    expect(parser.push(lines(active), 100).map((activity) => activity.type)).toEqual(['tool.start'])
    const afterDone = parser.push(lines(done), 200)
    expect(afterDone.map((activity) => activity.type)).toEqual(['tool.end', 'agent.spawn'])
    expect(afterDone[1]).toMatchObject({ agent: 'agy', child: 'agy~1', name: 'Math Documenter', label: 'Read src/strings.js.' })
    const running = parser.push(lines(list(10, 'running')), 300)
    expect(running.some((activity) => activity.type === 'agent.end')).toBe(false)
    const idle = parser.push(lines(list(12, 'idle')), 400)
    expect(idle.find((activity) => activity.type === 'agent.end')).toMatchObject({ agent: 'agy~1', ok: true, time: 400 })
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

describe('looksFailed failure anchoring', () => {
  it('does not fail a read-only command quoting failure words', () => {
    expect(looksFailed('diff --git a/foo.js b/foo.js\n+ const FAILED = false')).toBe(false)
    expect(looksFailed('+ // FAIL on empty input')).toBe(false)
    expect(looksFailed('src/app.js:20: catch (Exception) {')).toBe(false)
    expect(looksFailed('echo "this was not ok"')).toBe(false)
  })

  it('still detects real failed test outputs', () => {
    expect(looksFailed('FAIL tests/math.test.js')).toBe(true)
    expect(looksFailed('FAILED: test_math')).toBe(true)
    expect(looksFailed('  \u2716 add two numbers')).toBe(true)
    expect(looksFailed('not ok 1 - subtract numbers')).toBe(true)
    expect(looksFailed('[exit 1]')).toBe(true)
    expect(looksFailed('fatal: remote repository not found')).toBe(true)
  })
})
