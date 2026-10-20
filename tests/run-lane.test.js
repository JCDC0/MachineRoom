import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { commandFor, formatSummary, laneWithOverrides, parseRunArgs, runListLine, runRecord, sessionToolLines, summarizeRun, UNATTENDED_NOTE, unattendedPrompt } from '../src/briefs/run.js'

const lanes = JSON.parse(readFileSync(new URL('../docs/agents/lanes.json', import.meta.url), 'utf8'))
const env = { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }
const prompt = 'Do the task.'
const usageFile = 'C:\\Temp\\machineroom-runs\\hermes-T2.usage.json'
const title = 'hermes-T2-20261019-120000'

describe('commandFor', () => {
  it('builds the Hermes command from the lane and the environment', () => {
    expect(commandFor({ lane: lanes.hermes, prompt, env, usageFile, title })).toEqual({
      file: 'C:\\Users\\me\\AppData\\Local\\hermes\\bin\\hermes.exe',
      args: ['-z', prompt, '-m', 'deepseek/deepseek-v4.1-flash-1017', '--provider', 'openrouter', '-t', 'file,terminal', '--reasoning', 'xhigh', '--usage-file', usageFile],
      cwd: lanes.hermes.worktree,
    })
  })

  it('builds the OpenCode command with the reasoning as the model variant', () => {
    expect(commandFor({ lane: { ...lanes.opencode, reasoning: 'max' }, prompt, env, usageFile, title })).toEqual({
      file: 'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@opencode\\cli\\bin\\opencode.exe',
      args: ['run', '--format', 'json', '--model', 'opencode-go/deepseek-v4.1-flash#max', '--auto', '--title', title, prompt],
      cwd: lanes.opencode.worktree,
    })
  })

  it('leaves out the usage file and the reasoning when the lane has none', () => {
    const lane = { ...lanes.hermes, reasoning: undefined }
    const command = commandFor({ lane, prompt, env, title })
    expect(command.args).toEqual(['-z', prompt, '-m', 'deepseek/deepseek-v4.1-flash-1017', '--provider', 'openrouter', '-t', 'file,terminal'])
    expect(commandFor({ lane: { ...lanes.opencode, reasoning: undefined }, prompt, env, title }).args).toEqual([
      'run', '--format', 'json', '--model', 'opencode-go/deepseek-v4.1-flash', '--auto', '--title', title, prompt,
    ])
  })

  it('leaves out the toolsets when the block has none', () => {
    const lane = { ...lanes.hermes, cli: { ...lanes.hermes.cli, toolsets: undefined } }
    expect(commandFor({ lane, prompt, env, title }).args).toEqual([
      '-z', prompt, '-m', 'deepseek/deepseek-v4.1-flash-1017', '--provider', 'openrouter', '--reasoning', 'xhigh',
    ])
  })

  it('names the environment variable that is missing', () => {
    expect(() => commandFor({ lane: lanes.hermes, prompt, env: {}, title })).toThrow(/LOCALAPPDATA/)
    expect(() => commandFor({ lane: lanes.opencode, prompt, env: { APPDATA: '' }, title })).toThrow(/APPDATA/)
  })

  it('refuses a lane with no command line', () => {
    expect(() => commandFor({ lane: lanes.agy, prompt, env, title })).toThrow(/no command line/)
  })
})

describe('unattendedPrompt', () => {
  it('adds the note after two newlines', () => {
    expect(unattendedPrompt('Do it.')).toBe(`Do it.\n\n${UNATTENDED_NOTE}`)
    expect(UNATTENDED_NOTE).toMatch(/^You are running unattended/)
    expect(UNATTENDED_NOTE).toMatch(/Nobody can answer a question\./)
  })
})

describe('parseRunArgs', () => {
  it('takes a model and a reasoning level for one run', () => {
    expect(parseRunArgs(['hermes', 'T9', '--model', 'minimax/minimax-m3.1-flash:free', '--reasoning=high'])).toEqual({
      lane: 'hermes', briefs: ['T9'], dryRun: false, minutes: 100, list: false, model: 'minimax/minimax-m3.1-flash:free', reasoning: 'high',
    })
    expect(() => parseRunArgs(['hermes', 'T9', '--model'])).toThrow('--model needs a model id')
    expect(() => parseRunArgs(['hermes', 'T9', '--model', '-z'])).toThrow('--model needs a model id')
    expect(() => parseRunArgs(['hermes', 'T9', '--reasoning', 'HIGH; calc'])).toThrow('--reasoning needs a level')
  })

  it('puts the override on a copy of the lane', () => {
    const lane = { name: 'Hermes', model: 'DeepSeek', models: { T1: 'Other' }, reasoning: 'xhigh', cli: { harness: 'hermes', model: 'deepseek/x' } }
    const next = laneWithOverrides(lane, { model: 'minimax/minimax-m3.1-flash:free', reasoning: 'high' })
    expect(next).toMatchObject({ model: 'minimax/minimax-m3.1-flash:free', reasoning: 'high', cli: { model: 'minimax/minimax-m3.1-flash:free' } })
    expect(next.models).toBeUndefined()
    expect(lane.cli.model).toBe('deepseek/x')
    expect(laneWithOverrides(lane, {})).toEqual(lane)
  })

  it('reads a lane and one or more briefs', () => {
    expect(parseRunArgs(['hermes', 'T2'])).toEqual({ lane: 'hermes', briefs: ['T2'], dryRun: false, minutes: 100, list: false })
    expect(parseRunArgs(['opencode', 'T2', 'G7', '--dry-run', '--minutes', '45'])).toEqual({
      lane: 'opencode', briefs: ['T2', 'G7'], dryRun: true, minutes: 45, list: false,
    })
    expect(parseRunArgs(['--dry-run', 'hermes', 'T2', '--minutes=5'])).toMatchObject({ lane: 'hermes', dryRun: true, minutes: 5 })
  })

  it('accepts --list without a lane or a brief', () => {
    expect(parseRunArgs(['--list'])).toEqual({ lane: '', briefs: [], dryRun: false, minutes: 100, list: true })
    expect(parseRunArgs(['--list', '--minutes', '5'])).toMatchObject({ list: true, minutes: 5 })
  })

  it('refuses input that names no lane, no brief or a bad time', () => {
    expect(() => parseRunArgs([])).toThrow(/lane/)
    expect(() => parseRunArgs(['hermes'])).toThrow(/brief/)
    expect(() => parseRunArgs(['hermes', 'T2', '--minutes'])).toThrow(/minutes/)
    expect(() => parseRunArgs(['hermes', 'T2', '--minutes', 'soon'])).toThrow(/minutes/)
    expect(() => parseRunArgs(['hermes', 'T2', '--minutes', '0'])).toThrow(/minutes/)
    expect(() => parseRunArgs(['hermes', 'T2', '--fast'])).toThrow(/Unknown option/)
  })
})

const fixture = readFileSync(new URL('./fixtures/opencode-run-json.jsonl', import.meta.url), 'utf8')
const opencodeLog = (items) => items.map((item) => JSON.stringify(item)).join('\n')

describe('summarizeRun', () => {
  it('counts the tool calls of a real OpenCode JSON log', () => {
    const summary = summarizeRun({ harness: 'opencode', log: fixture, worktree: 'C:\\scratch' })
    expect(summary).toEqual({
      harness: 'opencode',
      toolCalls: 2,
      failed: 0,
      written: [],
      read: [],
      head: [
        'Files in `C:\\scratch`:',
        '',
        '- `run.mjs`',
        '- `run.jsonl`',
        '- `err.txt`',
        '',
        'Stopping here as instructed.',
      ],
      costUsd: 0,
    })
    expect(formatSummary(summary)).toEqual([
      'summary: 2 tool calls, 0 failed',
      'estimated cost: 0.0000 USD',
      'written: none',
      'read: none',
      'report: first 7 lines',
      '  Files in `C:\\scratch`:',
      '  ',
      '  - `run.mjs`',
      '  - `run.jsonl`',
      '  - `err.txt`',
      '  ',
      '  Stopping here as instructed.',
    ])
  })

  it('adds up the cost of every step that carries one', () => {
    const log = opencodeLog([
      { type: 'step_start', part: { type: 'step-start' } },
      { type: 'step_finish', part: { type: 'step-finish', cost: 0.0123 } },
      { type: 'tool_use', part: { id: 'c1', tool: 'read', state: { status: 'completed', input: { path: 'C:\\scratch\\a.js' } } } },
      { type: 'step_finish', part: { type: 'step-finish', cost: 0.0456 } },
      { type: 'step_finish', part: { type: 'step-finish', reason: 'stop' } },
    ])
    const summary = summarizeRun({ harness: 'opencode', log, worktree: 'C:\\scratch' })
    expect(summary.costUsd).toBe(0.0579)
    expect(formatSummary(summary)).toContain('estimated cost: 0.0579 USD')
  })

  it('reports no cost when no step carries a number', () => {
    const log = opencodeLog([
      { type: 'step_start', part: { type: 'step-start' } },
      { type: 'step_finish', part: { type: 'step-finish', cost: null } },
      { type: 'step_finish', part: { type: 'step-finish', cost: '0.0100' } },
      { type: 'text', part: { type: 'text', text: 'done' } },
    ])
    const summary = summarizeRun({ harness: 'opencode', log, worktree: 'C:\\scratch' })
    expect(summary.costUsd).toBeNull()
    expect(formatSummary(summary)).toContain('estimated cost: not reported')
    expect(summarizeRun({ harness: 'hermes', log: 'report', worktree: '' }).costUsd).toBeNull()
  })

  it('lists the files read and written, relative to the worktree, and the failed calls', () => {
    const log = opencodeLog([
      { type: 'tool_use', part: { id: 'c1', tool: 'read', state: { status: 'completed', input: { path: 'C:\\GitHub\\MachineRoom-hermes\\src\\briefs\\run.js' } } } },
      { type: 'tool_use', part: { id: 'c2', tool: 'write', state: { status: 'completed', input: { path: 'C:\\GitHub\\MachineRoom-hermes\\docs\\agents\\CHANGELOG.md' }, output: 'ok' } } },
      { type: 'tool_use', part: { id: 'c3', tool: 'shell', state: { status: 'error', input: { command: 'npm test' }, output: 'FAIL' } } },
    ])
    const summary = summarizeRun({ harness: 'opencode', log, worktree: 'C:\\GitHub\\MachineRoom-hermes' })
    expect(summary.toolCalls).toBe(3)
    expect(summary.failed).toBe(1)
    expect(summary.written).toEqual(['docs/agents/CHANGELOG.md'])
    expect(summary.read).toEqual(['src/briefs/run.js'])
  })

  it('reports the first 20 lines of a Hermes log', () => {
    const log = Array.from({ length: 25 }, (_, index) => `line ${index + 1}`).join('\n')
    const summary = summarizeRun({ harness: 'hermes', log, worktree: 'C:\\GitHub\\MachineRoom-hermes' })
    expect(summary.harness).toBe('hermes')
    expect(summary.head).toHaveLength(20)
    expect(summary.head[0]).toBe('line 1')
    expect(summary.head[19]).toBe('line 20')
    expect(summarizeRun({ harness: 'hermes', log: 'a\nb\n', worktree: '' }).head).toEqual(['a', 'b'])
  })

  it('counts the tool lines of a real Hermes run and still shows the report', () => {
    const log = readFileSync(new URL('./fixtures/hermes-run.log', import.meta.url), 'utf8')
    const summary = summarizeRun({ harness: 'hermes', log, worktree: 'C:\\scratch' })
    expect(summary).toEqual({
      harness: 'hermes',
      toolCalls: 1,
      failed: 0,
      written: [],
      read: [],
      head: ['Files in current directory:', '- err.txt', '- out.txt'],
      costUsd: null,
    })
    expect(formatSummary(summary)).toEqual([
      'summary: 1 tool calls, 0 failed',
      'written: none',
      'read: none',
      'report: first 3 lines',
      '  Files in current directory:',
      '  - err.txt',
      '  - out.txt',
    ])
  })

  it('reads, writes and failures from Hermes tool lines, relative to the worktree', () => {
    const log = [
      'Done with the work.',
      '┊ 📖 read      C:\\GitHub\\MachineRoom-hermes\\src\\briefs\\run.js  0.4s',
      '┊ ✍️  write     C:\\GitHub\\MachineRoom-hermes\\docs\\agents\\CHANGELOG.md  0.2s',
      '┊ 💻 $         npm test  12.0s [exit 1]',
    ].join('\n')
    const summary = summarizeRun({ harness: 'hermes', log, worktree: 'C:\\GitHub\\MachineRoom-hermes' })
    expect(summary.toolCalls).toBe(3)
    expect(summary.failed).toBe(1)
    expect(summary.read).toEqual(['src/briefs/run.js'])
    expect(summary.written).toEqual(['docs/agents/CHANGELOG.md'])
    expect(summary.head).toEqual(['Done with the work.'])
    expect(formatSummary(summary)).toContain('report: first 1 line')
  })

  it('takes the report of an OpenCode log from the last text line', () => {
    const log = opencodeLog([
      { type: 'text', part: { type: 'text', text: 'The first report.' } },
      { type: 'tool_use', part: { id: 'c1', tool: 'read', state: { status: 'completed', input: { path: 'C:\\scratch\\a.js' } } } },
      { type: 'text', part: { type: 'text', text: 'The last report.\nIt has two lines.' } },
    ])
    const summary = summarizeRun({ harness: 'opencode', log, worktree: 'C:\\scratch' })
    expect(summary.head).toEqual(['The last report.', 'It has two lines.'])
    expect(formatSummary(summary)).toEqual([
      'summary: 1 tool calls, 0 failed',
      'estimated cost: not reported',
      'written: none',
      'read: a.js',
      'report: first 2 lines',
      '  The last report.',
      '  It has two lines.',
    ])
  })

  it('reports no report when an OpenCode log holds no text line', () => {
    const log = opencodeLog([
      { type: 'step_start', part: { type: 'step-start' } },
      { type: 'tool_use', part: { id: 'c1', tool: 'read', state: { status: 'completed', input: { path: 'C:\\scratch\\a.js' } } } },
    ])
    const summary = summarizeRun({ harness: 'opencode', log, worktree: 'C:\\scratch' })
    expect(summary.head).toEqual([])
    expect(formatSummary(summary)).toContain('report: none')
  })

  it('keeps the blank lines inside the text of an OpenCode report', () => {
    const log = opencodeLog([
      { type: 'text', part: { type: 'text', text: 'First paragraph.\n\nSecond paragraph.\n\n' } },
    ])
    const summary = summarizeRun({ harness: 'opencode', log, worktree: 'C:\\scratch' })
    expect(summary.head).toEqual(['First paragraph.', '', 'Second paragraph.'])
  })

  it('skips a line of an OpenCode log that does not parse', () => {
    const log = [
      'not json at all',
      JSON.stringify({ type: 'text', part: { type: 'text', text: 'The report.' } }),
      '{ broken',
    ].join('\n')
    const summary = summarizeRun({ harness: 'opencode', log, worktree: 'C:\\scratch' })
    expect(summary.head).toEqual(['The report.'])
  })

  it('keeps the last OpenCode text line that carries words', () => {
    const log = opencodeLog([
      { type: 'text', part: { type: 'text', text: 'The report.' } },
      { type: 'text', part: { type: 'text', text: '   ' } },
    ])
    const summary = summarizeRun({ harness: 'opencode', log, worktree: 'C:\\scratch' })
    expect(summary.head).toEqual(['The report.'])
  })

  it('handles an empty log for both harnesses', () => {
    expect(summarizeRun({ harness: 'opencode', log: '', worktree: 'C:\\scratch' })).toEqual({
      harness: 'opencode', toolCalls: 0, failed: 0, written: [], read: [], head: [], costUsd: null,
    })
    expect(summarizeRun({ harness: 'hermes', log: '', worktree: 'C:\\scratch' }).head).toEqual([])
    expect(formatSummary(summarizeRun({ harness: 'hermes', log: '', worktree: '' }))).toEqual([
      'summary: 0 tool calls, 0 failed',
      'written: none',
      'read: none',
      'report: none',
    ])
  })
})

const exported = (messages) => JSON.stringify({ id: 's1', source: 'oneshot', messages })
const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
const answer = (timestamp, calls) => ({ role: 'assistant', timestamp, content: '', tool_calls: calls })
const result = (id, timestamp, content) => ({ role: 'tool', tool_call_id: id, timestamp, content: JSON.stringify(content) })

describe('sessionToolLines', () => {
  it('turns the tool calls of a session export into Hermes lines', () => {
    const text = exported([
      { role: 'user', timestamp: 1000, content: 'Do the work.' },
      answer(1010, [call('c1', 'read_file', { path: 'C:\\GitHub\\MachineRoom-hermes\\src\\a.js' })]),
      result('c1', 1012.4, { output: 'ok', exit_code: 0 }),
      answer(1020, [call('c2', 'terminal', { command: 'npm test' })]),
      result('c2', 1043, { output: 'FAIL', exit_code: 1 }),
      answer(1050, [call('c3', 'patch', { path: 'C:\\GitHub\\MachineRoom-hermes\\src\\b.js' })]),
      result('c3', 1050.6, { output: 'ok' }),
    ])
    expect(sessionToolLines(text)).toEqual([
      '┊ 📖 read      C:\\GitHub\\MachineRoom-hermes\\src\\a.js  2.4s',
      '┊ 💻 $         npm test  23.0s [exit 1]',
      '┊ 🔧 patch     C:\\GitHub\\MachineRoom-hermes\\src\\b.js  0.6s',
    ])
  })

  it('keeps a call that never returned and skips lines that are not a session', () => {
    const text = [
      'not json',
      exported([answer(10, [call('c1', 'write_file', { path: '/w/notes.md' })])]),
      '',
    ].join('\n')
    expect(sessionToolLines(text)).toEqual(['┊ ✍️ write     /w/notes.md  0.0s'])
    expect(sessionToolLines('')).toEqual([])
    expect(sessionToolLines(JSON.stringify({ id: 's2' }))).toEqual([])
  })

  it('marks a failed file call and names a tool it does not know', () => {
    const text = exported([
      answer(10, [call('c1', 'write_file', { path: '/w/notes.md' }), call('c2', 'browser_click', { ref: 'e12' })]),
      result('c1', 11, { output: 'Error: denied', error: 'denied' }),
      result('c2', 11.5, { output: 'ok' }),
    ])
    expect(sessionToolLines(text)).toEqual([
      '┊ ✍️ write     /w/notes.md  1.0s [error]',
      '┊ ⚡ browser_c browser_click  1.5s',
    ])
  })

  it('searches files by name when the target is files', () => {
    const text = exported([answer(10, [call('c1', 'search_files', { pattern: '*.js', target: 'files' })])])
    expect(sessionToolLines(text)).toEqual(['┊ 🔎 find      *.js  0.0s'])
  })
})

describe('runRecord', () => {
  it('builds the record in the documented order', () => {
    const record = runRecord({
      lane: 'hermes',
      briefs: ['T3'],
      model: 'deepseek/deepseek-v4.1-flash-1017',
      reasoning: 'xhigh',
      startedAt: '2026-10-19T12:00:00.000Z',
      minutes: 12.4,
      exitCode: 0,
      killed: false,
      costUsd: 0.0421,
      log: 'C:\\Temp\\machineroom-runs\\hermes-T3.log',
      branch: 'feat/t3-run-records-and',
      commits: ['abc1234 0.1.44: Record each lane run'],
    })
    expect(record).toEqual({
      lane: 'hermes',
      briefs: ['T3'],
      model: 'deepseek/deepseek-v4.1-flash-1017',
      reasoning: 'xhigh',
      startedAt: '2026-10-19T12:00:00.000Z',
      minutes: 12.4,
      exitCode: 0,
      killed: false,
      costUsd: 0.0421,
      log: 'C:\\Temp\\machineroom-runs\\hermes-T3.log',
      branch: 'feat/t3-run-records-and',
      commits: ['abc1234 0.1.44: Record each lane run'],
    })
    expect(Object.keys(record)).toEqual([
      'lane', 'briefs', 'model', 'reasoning', 'startedAt', 'minutes', 'exitCode', 'killed', 'costUsd', 'log', 'branch', 'commits',
    ])
  })

  it('writes nulls where the run reported nothing', () => {
    const record = runRecord({ lane: 'opencode', briefs: 'T3', startedAt: 1760000000000, exitCode: null, costUsd: undefined })
    expect(record.briefs).toEqual([])
    expect(record.commits).toEqual([])
    expect(record.model).toBeNull()
    expect(record.reasoning).toBeNull()
    expect(record.exitCode).toBeNull()
    expect(record.costUsd).toBeNull()
    expect(record.killed).toBe(false)
    expect(record.startedAt).toBe('2025-10-09T08:53:20.000Z')
  })
})

describe('runListLine', () => {
  it('prints one line with the cost or not reported', () => {
    const record = runRecord({ lane: 'hermes', briefs: ['T3'], startedAt: '2026-10-19T12:00:00.000Z', minutes: 12.4, exitCode: 0, costUsd: 0.0421, branch: 'feat/t3' })
    expect(runListLine(record)).toBe('2026-10-19T12:00:00.000Z | hermes | model unknown | T3 | 12.4 min | exit 0 | 0.0421 USD | feat/t3')
    const bare = runRecord({ lane: 'opencode', briefs: ['T3'], startedAt: '2026-10-19T12:00:00.000Z', minutes: 3, exitCode: 1, killed: true })
    expect(runListLine(bare)).toBe('2026-10-19T12:00:00.000Z | opencode | model unknown | T3 | 3 min | exit 1 (killed) | not reported | no branch')
  })

  it('names the model right after the lane', () => {
    const record = runRecord({ lane: 'hermes', briefs: ['T9'], model: 'minimax/minimax-m3.1-flash:free', startedAt: '2026-10-19T12:00:00.000Z', minutes: 3, exitCode: 0, branch: 'feat/t9' })
    expect(runListLine(record)).toBe('2026-10-19T12:00:00.000Z | hermes | minimax/minimax-m3.1-flash:free | T9 | 3 min | exit 0 | not reported | feat/t9')
  })
})
