import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { commandFor, formatSummary, parseRunArgs, runListLine, runRecord, summarizeRun, UNATTENDED_NOTE, unattendedPrompt } from '../src/briefs/run.js'

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
      args: ['run', '--format', 'json', '--model', 'opencode-go/mimo-v2.6-pro#max', '--auto', '--title', title, prompt],
      cwd: lanes.opencode.worktree,
    })
  })

  it('leaves out the usage file and the reasoning when the lane has none', () => {
    const lane = { ...lanes.hermes, reasoning: undefined }
    const command = commandFor({ lane, prompt, env, title })
    expect(command.args).toEqual(['-z', prompt, '-m', 'deepseek/deepseek-v4.1-flash-1017', '--provider', 'openrouter', '-t', 'file,terminal'])
    expect(commandFor({ lane: { ...lanes.opencode, reasoning: undefined }, prompt, env, title }).args).toEqual([
      'run', '--format', 'json', '--model', 'opencode-go/mimo-v2.6-pro', '--auto', '--title', title, prompt,
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
    expect(summary).toEqual({ harness: 'opencode', toolCalls: 2, failed: 0, written: [], read: [], head: [], costUsd: 0 })
    expect(formatSummary(summary)).toEqual([
      'summary: 2 tool calls, 0 failed',
      'estimated cost: 0.0000 USD',
      'written: none',
      'read: none',
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

  it('handles an empty log for both harnesses', () => {
    expect(summarizeRun({ harness: 'opencode', log: '', worktree: 'C:\\scratch' })).toEqual({
      harness: 'opencode', toolCalls: 0, failed: 0, written: [], read: [], head: [], costUsd: null,
    })
    expect(summarizeRun({ harness: 'hermes', log: '', worktree: 'C:\\scratch' }).head).toEqual([])
    expect(formatSummary(summarizeRun({ harness: 'hermes', log: '', worktree: '' }))).toEqual(['summary: the log holds no report'])
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
    expect(runListLine(record)).toBe('2026-10-19T12:00:00.000Z | hermes | T3 | 12.4 min | exit 0 | 0.0421 USD | feat/t3')
    const bare = runRecord({ lane: 'opencode', briefs: ['T3'], startedAt: '2026-10-19T12:00:00.000Z', minutes: 3, exitCode: 1, killed: true })
    expect(runListLine(bare)).toBe('2026-10-19T12:00:00.000Z | opencode | T3 | 3 min | exit 1 (killed) | not reported | no branch')
  })
})
