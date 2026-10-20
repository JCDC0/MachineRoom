import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { commandFor, formatStats, formatSummary, laneStats, laneWithOverrides, nextTestStep, parseRunArgs, runListLine, runRecord, sessionToolLines, summarizeRun, UNATTENDED_NOTE, unattendedPrompt } from '../src/briefs/run.js'

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

  it('accepts --stats without a lane or a brief', () => {
    expect(parseRunArgs(['--stats'])).toEqual({ lane: '', briefs: [], dryRun: false, minutes: 100, list: false, stats: true })
    expect(parseRunArgs(['--stats', '--minutes', '5'])).toMatchObject({ stats: true, minutes: 5 })
  })

  it('takes --since with a day', () => {
    expect(parseRunArgs(['--stats', '--since', '2026-10-19'])).toEqual({
      lane: '', briefs: [], dryRun: false, minutes: 100, list: false, stats: true, since: '2026-10-19',
    })
    expect(parseRunArgs(['--stats', '--since=2026-01-02'])).toMatchObject({ since: '2026-01-02' })
  })

  it('refuses a since that is not a day', () => {
    expect(() => parseRunArgs(['--stats', '--since'])).toThrow('--since needs a date like 2026-10-19.')
    expect(() => parseRunArgs(['--stats', '--since', '19-10-2026'])).toThrow('--since needs a date like 2026-10-19.')
    expect(() => parseRunArgs(['--stats', '--since', '2026-10-19T00:00:00Z'])).toThrow('--since needs a date like 2026-10-19.')
    expect(() => parseRunArgs(['--stats', '--since', '2026-13-01'])).toThrow('--since needs a date like 2026-10-19.')
    expect(() => parseRunArgs(['--stats', '--since', '2026-02-30'])).toThrow('--since needs a date like 2026-10-19.')
    expect(() => parseRunArgs(['--stats', '--since', 'yesterday'])).toThrow('--since needs a date like 2026-10-19.')
    expect(() => parseRunArgs(['--stats', '--since', '--list'])).toThrow('--since needs a date like 2026-10-19.')
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

const record = (over = {}) => ({
  lane: 'hermes',
  model: 'deepseek/deepseek-v4.1-flash-1017',
  startedAt: '2026-10-19T10:00:00.000Z',
  minutes: 5,
  exitCode: 0,
  killed: false,
  costUsd: 0.01,
  ...over,
})

describe('laneStats', () => {
  it('groups one row per lane and model, sorted by lane and then model', () => {
    const stats = laneStats([
      record({ lane: 'opencode', model: 'opencode-go/mimo-v2.6-pro' }),
      record({ lane: 'hermes', model: 'minimax/minimax-m3.1-flash:free' }),
      record({ lane: 'hermes', model: 'deepseek/deepseek-v4.1-flash-1017' }),
      record({ lane: 'hermes', model: 'deepseek/deepseek-v4.1-flash-1017' }),
    ])
    expect(stats.rows.map((row) => `${row.lane} ${row.model}`)).toEqual([
      'hermes deepseek/deepseek-v4.1-flash-1017',
      'hermes minimax/minimax-m3.1-flash:free',
      'opencode opencode-go/mimo-v2.6-pro',
    ])
    expect(stats.rows[0].runs).toBe(2)
    expect(stats.rows[1].runs).toBe(1)
  })

  it('counts finished, killed and failed runs', () => {
    const stats = laneStats([
      record({ exitCode: 0, killed: false }),
      record({ exitCode: 0, killed: false }),
      record({ exitCode: 0, killed: true }),
      record({ exitCode: 1, killed: false }),
      record({ exitCode: null, killed: false }),
    ])
    expect(stats.rows[0]).toMatchObject({ runs: 5, finished: 2, killed: 1, failed: 2 })
  })

  it('takes the median of an odd number of runs', () => {
    const stats = laneStats([record({ minutes: 7 }), record({ minutes: 3 }), record({ minutes: 5 })])
    expect(stats.rows[0]).toMatchObject({ minutesTotal: 15, minutesMedian: 5 })
  })

  it('takes the median of an even number of runs', () => {
    const stats = laneStats([record({ minutes: 9 }), record({ minutes: 3 }), record({ minutes: 7 }), record({ minutes: 5 })])
    expect(stats.rows[0]).toMatchObject({ minutesTotal: 24, minutesMedian: 6 })
  })

  it('leaves a minute or a cost that is not a number out of the sums and the median', () => {
    const stats = laneStats([
      record({ minutes: 4, costUsd: 0.2 }),
      record({ minutes: 6, costUsd: 0.1 }),
      record({ minutes: null, costUsd: null }),
      record({ minutes: '8', costUsd: '0.5' }),
      record({ minutes: Number.NaN, costUsd: Number.POSITIVE_INFINITY }),
    ])
    expect(stats.rows[0]).toMatchObject({ runs: 5, minutesTotal: 10, minutesMedian: 5, costTotal: 0.3, costRuns: 2 })
  })

  it('counts a run that reported a cost of zero', () => {
    const stats = laneStats([record({ costUsd: 0 }), record({ costUsd: 0.5 })])
    expect(stats.rows[0]).toMatchObject({ costTotal: 0.5, costRuns: 2 })
  })

  it('counts a run with no model as model unknown', () => {
    const stats = laneStats([record({ model: undefined }), record({ model: '' }), record({ model: 'deepseek/x' })])
    expect(stats.rows.map((row) => row.model)).toEqual(['deepseek/x', 'model unknown'])
    expect(stats.rows[1].runs).toBe(2)
  })

  it('rounds minutes to one decimal and costs to four', () => {
    const stats = laneStats([record({ minutes: 0.04, costUsd: 0.00006 }), record({ minutes: 0.04, costUsd: 0.00006 })])
    expect(stats.rows[0]).toMatchObject({ minutesTotal: 0.1, minutesMedian: 0, costTotal: 0.0001, costRuns: 2 })
    const thirds = laneStats([record({ costUsd: 0.1 }), record({ costUsd: 0.2 })])
    expect(thirds.rows[0].costTotal).toBe(0.3)
  })

  it('leaves out records from before the day and records with no start', () => {
    const stats = laneStats([
      record({ startedAt: '2026-10-18T23:59:59.999Z', minutes: 1 }),
      record({ startedAt: '2026-10-19T00:00:00.000Z', minutes: 2 }),
      record({ startedAt: '2026-10-20T08:00:00.000Z', minutes: 3 }),
      record({ startedAt: null, minutes: 4 }),
      record({ startedAt: 'not a time', minutes: 5 }),
      record({ startedAt: undefined, minutes: 6 }),
    ], { since: '2026-10-19' })
    expect(stats.rows[0]).toMatchObject({ runs: 2, minutesTotal: 5 })
    expect(laneStats([record({ startedAt: '2026-10-18T23:59:59.999Z' })], { since: '2026-10-19' }).rows).toEqual([])
  })

  it('keeps every record when there is no since', () => {
    const records = [record({ startedAt: null }), record({ startedAt: '2020-01-01T00:00:00.000Z' })]
    expect(laneStats(records).rows[0].runs).toBe(2)
    expect(laneStats(records, {}).rows[0].runs).toBe(2)
  })

  it('skips junk records', () => {
    const stats = laneStats([
      null,
      undefined,
      'a run',
      42,
      [],
      {},
      { model: 'deepseek/x' },
      { lane: '' },
      { lane: '   ' },
      { lane: null },
      record({ minutes: 2 }),
    ])
    expect(stats.rows).toHaveLength(1)
    expect(stats.rows[0]).toMatchObject({ lane: 'hermes', runs: 1 })
    expect(stats.total).toMatchObject({ runs: 1 })
    expect(laneStats(null).rows).toEqual([])
    expect(laneStats('nope').rows).toEqual([])
  })

  it('totals every row', () => {
    const stats = laneStats([
      record({ lane: 'hermes', model: 'a', minutes: 4.9, costUsd: 0.2, exitCode: 0 }),
      record({ lane: 'hermes', model: 'a', minutes: 6.1, costUsd: 0.312, exitCode: 1 }),
      record({ lane: 'opencode', model: 'b', minutes: 2, costUsd: null, exitCode: 0, killed: true }),
    ])
    expect(stats.total).toEqual({
      lane: 'all',
      model: 'all',
      runs: 3,
      finished: 1,
      killed: 1,
      failed: 1,
      minutesTotal: 13,
      minutesMedian: 4.9,
      costTotal: 0.512,
      costRuns: 2,
    })
  })
})

describe('formatStats', () => {
  const stats = laneStats([
    record({ lane: 'hermes', model: 'deepseek/x', minutes: 4.9, costUsd: 0.2, exitCode: 0 }),
    record({ lane: 'hermes', model: 'deepseek/x', minutes: 6.1, costUsd: 0.312, exitCode: 1 }),
    record({ lane: 'opencode', model: undefined, minutes: 2, costUsd: null, exitCode: 0, killed: true }),
  ])

  it('prints one line per row and then the total', () => {
    expect(formatStats(stats)).toEqual([
      'hermes | deepseek/x | 2 runs | 1 finished, 0 killed, 1 failed | 11.0 min, median 5.5 | 0.5120 USD over 2 runs',
      'opencode | model unknown | 1 run | 0 finished, 1 killed, 0 failed | 2.0 min, median 2.0 | 0.0000 USD over 0 runs',
      'all | all | 3 runs | 1 finished, 1 killed, 1 failed | 13.0 min, median 4.9 | 0.5120 USD over 2 runs',
    ])
  })

  it('says so when there are no runs', () => {
    expect(formatStats(laneStats([]))).toEqual(['No runs recorded.'])
    expect(formatStats({ rows: [], total: null })).toEqual(['No runs recorded.'])
    expect(formatStats(null)).toEqual(['No runs recorded.'])
  })
})

const CRASH = 3221226505
const CRASH_SIGNED = -1073740791
const CRASH_RETRY = 'The test worker crashed inside Node (0xC0000409), not in a test. Running the tests again'
const CRASH_GAVE_UP = 'The test worker crashed inside Node three times. See Known limits in docs/agents/ARCHITECTURE.md.'

describe('nextTestStep', () => {
  it('ends with the code of a run that did not crash', () => {
    expect(nextTestStep(0, 1)).toEqual({ action: 'done', code: 0 })
    expect(nextTestStep(1, 1)).toEqual({ action: 'done', code: 1 })
    expect(nextTestStep(2, 2)).toEqual({ action: 'done', code: 2 })
  })

  it('never retries a test failure', () => {
    expect(nextTestStep(1, 1)).not.toHaveProperty('message')
    expect(nextTestStep(2, 1)).not.toHaveProperty('message')
  })

  it('ends with code 1 when the run has no exit code', () => {
    expect(nextTestStep(null, 1)).toEqual({ action: 'done', code: 1 })
  })

  it('asks for another try after a crash', () => {
    expect(nextTestStep(CRASH, 1)).toEqual({
      action: 'retry',
      message: `${CRASH_RETRY} (try 2 of 3).`,
    })
    expect(nextTestStep(CRASH_SIGNED, 2)).toEqual({
      action: 'retry',
      message: `${CRASH_RETRY} (try 3 of 3).`,
    })
  })

  it('gives up after the third crash', () => {
    expect(nextTestStep(CRASH, 3)).toEqual({ action: 'done', code: 1, message: CRASH_GAVE_UP })
    expect(nextTestStep(CRASH_SIGNED, 4)).toEqual({ action: 'done', code: 1, message: CRASH_GAVE_UP })
  })
})

const TEST_SCRIPT = fileURLToPath(new URL('../scripts/test.mjs', import.meta.url))
const FAKE_SCRIPT = `import { readFileSync, writeFileSync } from 'node:fs'
const file = process.env.FAKE_COUNT_FILE
const count = Number(readFileSync(file, 'utf8')) + 1
writeFileSync(file, String(count))
console.log('fake test run ' + count)
process.exit(Number(count === 1 ? process.env.FAKE_FIRST_EXIT : process.env.FAKE_SECOND_EXIT))
`

function runTestScript(extra) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [TEST_SCRIPT], { env: { ...process.env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      rejectRun(new Error(`the test runner did not exit. stderr: ${stderr}`))
    }, 20000)
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      rejectRun(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolveRun({ code, stdout, stderr })
    })
  })
}

describe('scripts/test.mjs', () => {
  it('runs the tests again after the crash and keeps the second result', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'machine-room-test-'))
    try {
      const counter = join(folder, 'count.txt')
      const fake = join(folder, 'fake-test.mjs')
      writeFileSync(counter, '0')
      writeFileSync(fake, FAKE_SCRIPT)
      const result = await runTestScript({
        MACHINEROOM_TEST_COMMAND: JSON.stringify([process.execPath, fake]),
        FAKE_COUNT_FILE: counter,
        FAKE_FIRST_EXIT: String(CRASH),
        FAKE_SECOND_EXIT: '0',
      })
      expect(result.code).toBe(0)
      expect(readFileSync(counter, 'utf8')).toBe('2')
      expect(result.stdout).toContain('fake test run 1')
      expect(result.stdout).toContain(`${CRASH_RETRY} (try 2 of 3).`)
      expect(result.stdout).toContain('fake test run 2')
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })

  it('runs a failing test once and keeps its code', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'machine-room-test-'))
    try {
      const counter = join(folder, 'count.txt')
      const fake = join(folder, 'fake-test.mjs')
      writeFileSync(counter, '0')
      writeFileSync(fake, FAKE_SCRIPT)
      const result = await runTestScript({
        MACHINEROOM_TEST_COMMAND: JSON.stringify([process.execPath, fake]),
        FAKE_COUNT_FILE: counter,
        FAKE_FIRST_EXIT: '1',
        FAKE_SECOND_EXIT: '0',
      })
      expect(result.code).toBe(1)
      expect(readFileSync(counter, 'utf8')).toBe('1')
      expect(result.stdout).toContain('fake test run 1')
      expect(result.stdout).not.toContain('crashed inside Node')
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})
