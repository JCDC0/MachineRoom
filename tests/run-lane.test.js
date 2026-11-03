import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { gitPath } from '../server/programPath.js'
import { briefProblems, briefWorktreeProblems, commandFor, DEFAULT_MINUTES, filterRunsSince, laneCommandProblem, readinessLine, retryStartProblem, SINCE_PROBLEM, startFailureText, worktreeFor, formatOutcomes, formatStats, formatSummary, laneLockPids, laneLockText, laneStats, laneStopProblem, laneWithOverrides, nextTestStep, parseRunArgs, projectRunGit, runListLine, runRecord, sessionToolLines, summarizeRun, UNATTENDED_NOTE, unattendedPrompt } from '../src/briefs/run.js'
import { branchFor, parseBriefs } from '../src/briefs/briefs.js'
import { harnessByKey } from '../src/harnesses/index.js'
import { startLane } from '../scripts/run-lane.mjs'
import { makeTempDir } from './helpers/tempRoot.js'

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
      args: ['run', '--standalone', '--format', 'json', '--model', 'opencode-go/deepseek-v4.1-flash#max', '--auto', '--title', title, prompt],
      cwd: lanes.opencode.worktree,
    })
  })

  it('builds the AGY command in the lane worktree', () => {
    expect(commandFor({ lane: lanes.agy, prompt, env, usageFile, title })).toEqual({
      file: 'C:\\Users\\me\\AppData\\Local\\agy\\bin\\agy.exe',
      args: ['--print', prompt, '--output-format', 'stream-json', '--model', 'gemini-3.8-flash-high', '--dangerously-skip-permissions'],
      cwd: lanes.agy.worktree,
    })
  })

  it('leaves the AGY model flag out when the lane names no model', () => {
    const lane = { ...lanes.agy, cli: { ...lanes.agy.cli, model: undefined } }
    expect(commandFor({ lane, prompt, env, title }).args).toEqual([
      '--print', prompt, '--output-format', 'stream-json', '--dangerously-skip-permissions',
    ])
  })

  it('builds the Claude Code command for a headless stream-json run', () => {
    expect(commandFor({ lane: lanes.claude, prompt, env, usageFile, title })).toEqual({
      file: 'claude',
      args: ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--model', 'sonnet', '--dangerously-skip-permissions'],
      cwd: lanes.claude.worktree,
    })
  })

  it('adds the run session id to the Claude Code command so the room can skip it', () => {
    const command = commandFor({ lane: lanes.claude, prompt, env, usageFile, title, sessionId: 'abc-123' })
    expect(command.args.slice(-2)).toEqual(['--session-id', 'abc-123'])
    expect(commandFor({ lane: lanes.claude, prompt, env, usageFile, title }).args).not.toContain('--session-id')
    expect(commandFor({ lane: lanes.claude, prompt, env, usageFile, title, sessionId: '' }).args).not.toContain('--session-id')
  })

  it('leaves out the usage file and the reasoning when the lane has none', () => {
    const lane = { ...lanes.hermes, reasoning: undefined }
    const command = commandFor({ lane, prompt, env, title })
    expect(command.args).toEqual(['-z', prompt, '-m', 'deepseek/deepseek-v4.1-flash-1017', '--provider', 'openrouter', '-t', 'file,terminal'])
    expect(commandFor({ lane: { ...lanes.opencode, reasoning: undefined }, prompt, env, title }).args).toEqual([
      'run', '--standalone', '--format', 'json', '--model', 'opencode-go/deepseek-v4.1-flash', '--auto', '--title', title, prompt,
    ])
  })

  it('leaves out the toolsets when the block has none', () => {
    const lane = { ...lanes.hermes, cli: { ...lanes.hermes.cli, toolsets: undefined } }
    expect(commandFor({ lane, prompt, env, title }).args).toEqual([
      '-z', prompt, '-m', 'deepseek/deepseek-v4.1-flash-1017', '--provider', 'openrouter', '--reasoning', 'xhigh',
    ])
  })

  it('passes a saved endpoint to the MachineRoom agent', () => {
    const lane = {
      name: 'MachineRoom Local',
      worktree: 'C:\\work\\mr',
      cli: { harness: 'machineroom', model: 'Local/alpha', endpoint: 'Local' },
    }
    const command = commandFor({ lane, prompt, env, title })
    expect(command.args.slice(1)).toEqual([
      '--model', 'Local/alpha', '--cwd', 'C:\\work\\mr', '--endpoint', 'Local', prompt,
    ])
  })

  it('names the environment variable that is missing', () => {
    expect(() => commandFor({ lane: lanes.hermes, prompt, env: {}, title })).toThrow(/LOCALAPPDATA/)
    expect(() => commandFor({ lane: lanes.opencode, prompt, env: { APPDATA: '' }, title })).toThrow(/APPDATA/)
  })

  it('refuses a lane with no command line', () => {
    expect(() => commandFor({ lane: { ...lanes.hermes, cli: undefined }, prompt, env, title })).toThrow(/no command line/)
  })

  it('refuses a lane with no worktree, so the harness never starts in the folder the runner was started from', () => {
    for (const worktree of [undefined, '', '  ', 42]) {
      expect(() => commandFor({ lane: { ...lanes.hermes, worktree }, prompt, env, title })).toThrow('The lane Hermes has no worktree, so the runner cannot start it.')
    }
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
    expect(parseRunArgs(['--stats'])).toEqual({ lane: '', briefs: [], dryRun: false, minutes: DEFAULT_MINUTES, list: false, stats: true })
    expect(parseRunArgs(['--stats', '--minutes', '5'])).toMatchObject({ stats: true, minutes: 5 })
  })

  it('accepts --outcomes without a lane or a brief', () => {
    expect(parseRunArgs(['--outcomes'])).toEqual({ lane: '', briefs: [], dryRun: false, minutes: DEFAULT_MINUTES, list: false, outcomes: true })
    expect(parseRunArgs(['--outcomes', '--minutes', '5'])).toMatchObject({ outcomes: true, minutes: 5 })
    expect(parseRunArgs(['--outcomes', '--since', '2026-10-19'])).toEqual({
      lane: '', briefs: [], dryRun: false, minutes: DEFAULT_MINUTES, list: false, outcomes: true, since: '2026-10-19',
    })
    expect(parseRunArgs(['--outcomes', '--since=2026-01-02'])).toMatchObject({ outcomes: true, since: '2026-01-02' })
    expect(() => parseRunArgs(['--outcomes', '--since', 'yesterday'])).toThrow(SINCE_PROBLEM)
  })

  it('takes --since with a day', () => {
    expect(parseRunArgs(['--stats', '--since', '2026-10-19'])).toEqual({
      lane: '', briefs: [], dryRun: false, minutes: DEFAULT_MINUTES, list: false, stats: true, since: '2026-10-19',
    })
    expect(parseRunArgs(['--stats', '--since=2026-01-02'])).toMatchObject({ since: '2026-01-02' })
  })

  it('refuses a since that is not a day', () => {
    expect(() => parseRunArgs(['--stats', '--since'])).toThrow(SINCE_PROBLEM)
    expect(() => parseRunArgs(['--stats', '--since', '19-10-2026'])).toThrow(SINCE_PROBLEM)
    expect(() => parseRunArgs(['--stats', '--since', '2026-10-19T00:00:00Z'])).toThrow(SINCE_PROBLEM)
    expect(() => parseRunArgs(['--stats', '--since', '2026-13-01'])).toThrow(SINCE_PROBLEM)
    expect(() => parseRunArgs(['--stats', '--since', '2026-02-30'])).toThrow(SINCE_PROBLEM)
    expect(() => parseRunArgs(['--stats', '--since', 'yesterday'])).toThrow(SINCE_PROBLEM)
    expect(() => parseRunArgs(['--stats', '--since', '--list'])).toThrow(SINCE_PROBLEM)
  })

  it('refuses input that names no lane, no brief or a bad time', () => {
    expect(() => parseRunArgs([])).toThrow(/lane/)
    expect(() => parseRunArgs(['hermes'])).toThrow(/brief/)
    expect(() => parseRunArgs(['hermes', 'T2', '--minutes'])).toThrow(/minutes/)
    expect(() => parseRunArgs(['hermes', 'T2', '--minutes', 'soon'])).toThrow(/minutes/)
    expect(() => parseRunArgs(['hermes', 'T2', '--minutes', '0'])).toThrow(/minutes/)
    expect(() => parseRunArgs(['hermes', 'T2', '--fast'])).toThrow(/Unknown option/)
  })

  it('takes --force for a run', () => {
    expect(parseRunArgs(['hermes', 'W3a', '--force'])).toEqual({
      lane: 'hermes', briefs: ['W3a'], dryRun: false, minutes: 100, list: false, force: true,
    })
    expect(parseRunArgs(['hermes', 'W3a'])).not.toHaveProperty('force')
    expect(parseRunArgs(['hermes', 'W3a', '--dry-run', '--force'])).toMatchObject({ dryRun: true, force: true })
  })
})

const sampleBrief = (id, title, ownerText, extra = {}) => ({
  id,
  title,
  ownerText,
  owners: [],
  done: false,
  section: 'Open work',
  text: '',
  ...extra,
})

const mergedW3a = sampleBrief('W3a', 'Read the lane branches from the bridge', 'OpenCode, merged as 0.1.52', { owners: ['opencode'], done: true })
const repeatedW3a = sampleBrief('W3a', 'Read the lane branches again', 'OpenCode', { owners: ['opencode'] })
const mergedB6 = sampleBrief('B6', 'Late join replay and agent roles', 'OpenCode, merged as 0.1.57', { owners: ['opencode'], done: true })
const openB6 = sampleBrief('B6', 'Late join replay and agent roles', 'OpenCode', { owners: ['opencode'] })
const hermesT2 = sampleBrief('T2', 'Lane runner', 'Hermes', { owners: ['hermes'] })
const hermesT3 = sampleBrief('T3', 'Run records and summaries', 'Hermes', { owners: ['hermes'] })

describe('briefProblems', () => {
  it('lets a brief the lane owns through when no branch holds it', () => {
    expect(briefProblems({ briefs: [openB6], ids: ['B6'], laneKey: 'opencode', branchExists: () => false })).toEqual([])
  })

  it('names an id that is not in TASKS.md', () => {
    expect(briefProblems({ briefs: [openB6], ids: ['T99'], laneKey: 'opencode', branchExists: () => false }))
      .toEqual(['There is no brief named T99.'])
  })

  it('names an id that appears more than once', () => {
    expect(briefProblems({ briefs: [mergedW3a, repeatedW3a], ids: ['W3a'], laneKey: 'opencode', branchExists: () => false }))
      .toEqual(['Brief W3a appears 2 times in TASKS.md. Give each brief its own id.'])
  })

  it('refuses a brief that is marked done, with its owner text as written', () => {
    expect(briefProblems({ briefs: [mergedW3a], ids: ['W3a'], laneKey: 'opencode', branchExists: () => false }))
      .toEqual(['Brief W3a is marked OpenCode, merged as 0.1.52. Pick another brief, or pass --force to run it again.'])
  })

  it('refuses a brief that belongs to other lanes', () => {
    const shared = sampleBrief('W3', 'Review and merge', 'OpenCode for the bridge, AGY for the panel', { owners: ['opencode', 'agy'] })
    expect(briefProblems({ briefs: [shared], ids: ['W3'], laneKey: 'hermes', branchExists: () => false }))
      .toEqual(['Brief W3 is for opencode and agy, not hermes. Pass --force to run it anyway.'])
  })

  it('gives a second lane of one harness that harness briefs', () => {
    const shared = sampleBrief('W3', 'Review and merge', 'OpenCode for the bridge, AGY for the panel', { owners: ['opencode', 'agy'] })
    expect(briefProblems({ briefs: [shared], ids: ['W3'], laneKey: 'opencode2', branchExists: () => false })).toEqual([])
    expect(briefProblems({ briefs: [shared], ids: ['W3'], laneKey: 'hermes2', branchExists: () => false }))
      .toEqual(['Brief W3 is for opencode and agy, not hermes2. Pass --force to run it anyway.'])
  })

  it('refuses a brief whose branch is already there', () => {
    const name = branchFor(hermesT3)
    expect(briefProblems({ briefs: [hermesT3], ids: ['T3'], laneKey: 'hermes', branchExists: (branch) => branch === name }))
      .toEqual([`The branch ${name} already exists. Rename or delete it first, or pick another brief.`])
  })

  it('drops only the done and owner sentences with force', () => {
    const other = sampleBrief('T3', 'Run records and summaries', 'OpenCode, merged as 0.1.44', { owners: ['opencode'], done: true })
    const name = branchFor(other)
    expect(briefProblems({ briefs: [other], ids: ['T3'], laneKey: 'hermes', branchExists: () => true, force: true }))
      .toEqual([`The branch ${name} already exists. Rename or delete it first, or pick another brief.`])
    expect(briefProblems({ briefs: [other], ids: ['T3'], laneKey: 'hermes', branchExists: () => false, force: true })).toEqual([])
  })

  it('lists several problems in one fixed order', () => {
    const briefs = [mergedW3a, repeatedW3a, mergedB6, hermesT2, hermesT3]
    expect(briefProblems({
      briefs,
      ids: ['T3', 'B6', 'T2', 'W3a', 'Z9'],
      laneKey: 'opencode',
      branchExists: (branch) => branch === branchFor(hermesT3),
    })).toEqual([
      'There is no brief named Z9.',
      'Brief W3a appears 2 times in TASKS.md. Give each brief its own id.',
      'Brief B6 is marked OpenCode, merged as 0.1.57. Pick another brief, or pass --force to run it again.',
      'Brief T3 is for hermes, not opencode. Pass --force to run it anyway.',
      'Brief T2 is for hermes, not opencode. Pass --force to run it anyway.',
      `The branch ${branchFor(hermesT3)} already exists. Rename or delete it first, or pick another brief.`,
    ])
  })

  it('compares an id without case', () => {
    expect(briefProblems({ briefs: [mergedB6], ids: ['b6'], laneKey: 'opencode', branchExists: () => false }))
      .toEqual(['Brief B6 is marked OpenCode, merged as 0.1.57. Pick another brief, or pass --force to run it again.'])
  })

  it('compares the lane without case', () => {
    expect(briefProblems({ briefs: [openB6], ids: ['B6'], laneKey: 'OpenCode', branchExists: () => false })).toEqual([])
  })

  it('lets a relative Files: list through', () => {
    const brief = sampleBrief('F1', 'Files check', 'OpenCode', {
      owners: ['opencode'],
      text: 'Files: `src/briefs/run.js`, `src/briefs/briefs.js`, `scripts/run-lane.mjs` (the call only), their tests, `docs/agents/CHANGELOG.md`.',
    })
    expect(briefProblems({ briefs: [brief], ids: ['F1'], laneKey: 'opencode', forbidden: [], branchExists: () => false })).toEqual([])
  })

  it('refuses an absolute path in the Files: list and names the entry', () => {
    const brief = sampleBrief('F2', 'Absolute file', 'OpenCode', {
      owners: ['opencode'],
      text: 'Files: C:\\work\\outside.txt and /etc/passwd.',
    })
    expect(briefProblems({ briefs: [brief], ids: ['F2'], laneKey: 'opencode', forbidden: [], branchExists: () => false })).toEqual([
      'Brief F2 lists the absolute path C:\\work\\outside.txt, and a brief names only paths inside the repository.',
      'Brief F2 lists the absolute path /etc/passwd, and a brief names only paths inside the repository.',
    ])
  })

  it('refuses a Files: entry that holds ..', () => {
    const brief = sampleBrief('F3', 'Climbing file', 'OpenCode', {
      owners: ['opencode'],
      text: 'Files: `src/../server/index.js`, `..\\outside.txt`.',
    })
    expect(briefProblems({ briefs: [brief], ids: ['F3'], laneKey: 'opencode', forbidden: [], branchExists: () => false })).toEqual([
      'Brief F3 lists src/../server/index.js, which holds .. and climbs out of the repository.',
      'Brief F3 lists ..\\outside.txt, which holds .. and climbs out of the repository.',
    ])
  })

  it('refuses a Files: entry the lane may not touch', () => {
    const brief = sampleBrief('F4', 'Forbidden file', 'Hermes', {
      owners: ['hermes'],
      text: 'Files: `server/index.js`, `docs/agents/CHANGELOG.md`.',
    })
    expect(briefProblems({
      briefs: [brief],
      ids: ['F4'],
      laneKey: 'hermes',
      forbidden: ['server/**'],
      branchExists: () => false,
    })).toEqual(['Brief F4 lists server/index.js, which lanes.json forbids for hermes.'])
  })

  it('catches the files in a plain Files: list without backticks', () => {
    const brief = sampleBrief('F5', 'Plain files', 'Hermes', {
      owners: ['hermes'],
      text: 'Files: server/index.js and ..\\..\\outside.txt',
    })
    expect(briefProblems({
      briefs: [brief],
      ids: ['F5'],
      laneKey: 'hermes',
      forbidden: ['server/**'],
      branchExists: () => false,
    })).toEqual([
      'Brief F5 lists server/index.js, which lanes.json forbids for hermes.',
      'Brief F5 lists ..\\..\\outside.txt, which holds .. and climbs out of the repository.',
    ])
  })

  it('checks the Files: list even with force', () => {
    const brief = sampleBrief('F6', 'Forced file', 'Hermes', {
      owners: ['opencode'],
      done: true,
      ownerText: 'OpenCode, merged as 0.1.1',
      text: 'Files: `server/index.js`.',
    })
    expect(briefProblems({
      briefs: [brief],
      ids: ['F6'],
      laneKey: 'hermes',
      forbidden: ['server/**'],
      branchExists: () => false,
      force: true,
    })).toEqual(['Brief F6 lists server/index.js, which lanes.json forbids for hermes.'])
  })
})

describe('briefWorktreeProblems', () => {
  const base = 'C:\\GitHub'
  const main = `${base}\\MachineRoom`
  const lanes = {
    opencode: { worktree: `${main}\\.worktrees\\opencode` },
    opencode4: { worktree: `${main}\\.worktrees\\opencode4` },
  }
  const data = { laneKey: 'opencode4', mainCheckout: main, lanes }

  it('lets this lane worktree through', () => {
    expect(briefWorktreeProblems({ ...data, worktree: `${main}\\.worktrees\\opencode4` })).toEqual([])
  })

  it('lets a folder under .worktrees through when no lane names it', () => {
    expect(briefWorktreeProblems({ ...data, worktree: `${main}\\.worktrees\\scratch` })).toEqual([])
  })

  it('refuses the main checkout', () => {
    expect(briefWorktreeProblems({ ...data, worktree: main }))
      .toEqual([`The lane worktree ${main} is the main checkout, so the runner will not start there.`])
  })

  it('refuses another lane worktree', () => {
    expect(briefWorktreeProblems({ ...data, worktree: `${main}\\.worktrees\\opencode` }))
      .toEqual([`The lane worktree ${main}\\.worktrees\\opencode is the opencode lane worktree, not this lane's.`])
  })

  it('refuses the user profile, the OS temp folder and the runs folder', () => {
    const home = 'C:\\Users\\me'
    const temp = `${home}\\AppData\\Local\\Temp`
    const runs = `${temp}\\machineroom-runs`
    const places = { ...data, home, temp, runs }
    expect(briefWorktreeProblems({ ...places, worktree: home }))
      .toEqual([`The lane worktree ${home} is the user profile, so the runner will not start there.`])
    expect(briefWorktreeProblems({ ...places, worktree: temp }))
      .toEqual([`The lane worktree ${temp} is the OS temp folder, so the runner will not start there.`])
    expect(briefWorktreeProblems({ ...places, worktree: runs }))
      .toEqual([`The lane worktree ${runs} is the runs folder or inside it, so the runner will not start there.`])
    expect(briefWorktreeProblems({ ...places, worktree: `${runs}\\run-1` }))
      .toEqual([`The lane worktree ${runs}\\run-1 is the runs folder or inside it, so the runner will not start there.`])
  })

  it('refuses a folder outside .worktrees of this repository', () => {
    expect(briefWorktreeProblems({ ...data, worktree: `${base}\\Other` }))
      .toEqual([`The lane worktree ${base}\\Other is not under .worktrees of this repository.`])
    expect(briefWorktreeProblems({ ...data, worktree: `${main}\\.worktrees` }))
      .toEqual([`The lane worktree ${main}\\.worktrees is not under .worktrees of this repository.`])
  })

  it('lets a lane with no worktree through so the command builder names it', () => {
    expect(briefWorktreeProblems({ ...data, worktree: '' })).toEqual([])
  })
})

const fixture = readFileSync(new URL('./fixtures/opencode-run-json.jsonl', import.meta.url), 'utf8')
const opencodeLog = (items) => items.map((item) => JSON.stringify(item)).join('\n')
const agyChunks = readFileSync(new URL('../public/fixtures/scenario-g-run.jsonl', import.meta.url), 'utf8')
  .trim()
  .split(/\r?\n/)
  .map((line) => JSON.parse(line))
  .filter((frame) => frame.type === 'heartbeat.run.log')
  .map((frame) => frame.payload.chunk)
const agyLog = agyChunks.join('\n')

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
      inputTokens: 8427,
      outputTokens: 107,
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

  it('counts the tool calls of a Claude Code stream-json log', () => {
    const log = [
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'C:\\GitHub\\MachineRoom-claude\\src\\math.js' } }] },
        parent_tool_use_id: null,
      },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false }] }, parent_tool_use_id: null },
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test' } }] },
        parent_tool_use_id: null,
      },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true }] }, parent_tool_use_id: null },
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 't3', name: 'Task', input: { description: 'Read the notes', subagent_type: 'Explore' } }] },
        parent_tool_use_id: null,
      },
    ].map((item) => JSON.stringify(item)).join('\n')
    const summary = summarizeRun({ harness: 'claude', log, worktree: 'C:\\GitHub\\MachineRoom-claude' })
    expect(summary).toEqual({
      harness: 'claude', toolCalls: 3, failed: 1, written: [], read: ['src/math.js'], head: [], costUsd: null, inputTokens: null, outputTokens: null,
    })
  })

  it('reads the cost and tokens of the last Claude Code result line', () => {
    const log = [
      JSON.stringify({
        type: 'result',
        total_cost_usd: 0.0123,
        usage: { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 40 },
      }),
      'not json',
      JSON.stringify({
        type: 'result',
        total_cost_usd: 0.25,
        usage: { input_tokens: 100, cache_creation_input_tokens: 200, cache_read_input_tokens: 300, output_tokens: 400 },
      }),
    ].join('\n')
    const summary = summarizeRun({ harness: 'claude', log, worktree: 'C:\\scratch' })
    expect(summary.costUsd).toBe(0.25)
    expect(summary.inputTokens).toBe(600)
    expect(summary.outputTokens).toBe(400)
  })

  it('takes the run totals from modelUsage over the last turn in usage', () => {
    const log = JSON.stringify({
      type: 'result',
      total_cost_usd: 0.29,
      usage: { input_tokens: 2, cache_creation_input_tokens: 1, cache_read_input_tokens: 3, output_tokens: 82 },
      modelUsage: {
        a: { inputTokens: 12, cacheReadInputTokens: 100, cacheCreationInputTokens: 50, outputTokens: 700 },
        b: { inputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 38 },
      },
    })
    const summary = summarizeRun({ harness: 'claude', log, worktree: 'C:\\scratch' })
    expect(summary.inputTokens).toBe(163)
    expect(summary.outputTokens).toBe(738)
  })

  it('reports the reply of the last top-level Claude result line', () => {
    const log = [
      JSON.stringify({ type: 'result', result: 'child words', parent_tool_use_id: 'toolu_1' }),
      JSON.stringify({ type: 'result', result: 'Added clamp.\nNothing else changed.\n' }),
    ].join('\n')
    const summary = summarizeRun({ harness: 'claude', log, worktree: 'C:\\scratch' })
    expect(summary.head).toEqual(['Added clamp.', 'Nothing else changed.'])
    expect(formatSummary(summary)).toContain('report: first 2 lines')
  })

  it('reads the tokens of the last AGY result line and counts thinking as output', () => {
    const log = [
      JSON.stringify({ event: 'result', result: { usage: { input_tokens: 1, output_tokens: 2, thinking_tokens: 3, total_tokens: 6 } } }),
      JSON.stringify({ event: 'result', result: { usage: { input_tokens: 100, output_tokens: 40, thinking_tokens: 20, total_tokens: 160 } } }),
    ].join('\n')
    const summary = summarizeRun({ harness: 'agy', log, worktree: 'C:\\scratch' })
    expect(summary.inputTokens).toBe(100)
    expect(summary.outputTokens).toBe(60)
    expect(summary.costUsd).toBeNull()
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

  it('counts the tool steps and files of a real AGY log', () => {
    const summary = summarizeRun({ harness: 'agy', log: agyLog, worktree: 'C:\\Users\\user\\AppData\\Local\\Temp\\agent-sandbox' })
    expect(summary.harness).toBe('agy')
    expect(summary.toolCalls).toBe(13)
    expect(summary.failed).toBe(0)
    expect(summary.written).toEqual(['docs/main-notes.md'])
    expect(summary.read).toEqual(['docs/main-notes.md', 'docs/subagent-notes.md', 'src/strings.js', 'test/strings.test.js'])
    expect(summary.costUsd).toBeNull()
    expect(summary.head[0]).toMatch(/^I have started the subagent/)
    expect(formatSummary(summary)).toContain('estimated cost: not reported')
  })

  it('handles an empty AGY log', () => {
    expect(summarizeRun({ harness: 'agy', log: '', worktree: 'C:\\scratch' })).toEqual({
      harness: 'agy', toolCalls: 0, failed: 0, written: [], read: [], head: [], costUsd: null, inputTokens: null, outputTokens: null,
    })
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
      inputTokens: null,
      outputTokens: null,
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
      harness: 'opencode', toolCalls: 0, failed: 0, written: [], read: [], head: [], costUsd: null, inputTokens: null, outputTokens: null,
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

describe('laneLockText and laneLockPids', () => {
  it('writes one JSON line with the run, the harness and the worktree', () => {
    expect(laneLockText({ pid: 12, child: 34, folder: 'C:\\work\\lane' })).toBe('{"pid":12,"child":34,"folder":"C:\\\\work\\\\lane"}\n')
    expect(laneLockText({ pid: 12, folder: '' })).toBe('{"pid":12}\n')
    expect(laneLockText({ pid: 12, child: 0 })).toBe('{"pid":12}\n')
    expect(laneLockText({ pid: 0, child: 34 })).toBe('')
    expect(laneLockText()).toBe('')
  })

  it('reads the new line and the old plain pid', () => {
    expect(laneLockPids('{"pid":12,"child":34,"folder":"C:\\\\work\\\\lane"}')).toEqual({ pid: 12, child: 34, folder: 'C:\\work\\lane', projectRun: false })
    expect(laneLockPids('{"pid":12}')).toEqual({ pid: 12, child: null, folder: '', projectRun: false })
    expect(laneLockPids('12')).toEqual({ pid: 12, child: null, folder: '', projectRun: false })
    expect(laneLockPids('12\r\n')).toEqual({ pid: 12, child: null, folder: '', projectRun: false })
    expect(laneLockPids('')).toEqual({ pid: null, child: null, folder: '', projectRun: false })
    expect(laneLockPids('{"pid":-1,"child":"x"}')).toEqual({ pid: null, child: null, folder: '', projectRun: false })
    expect(laneLockPids('{ broken')).toEqual({ pid: null, child: null, folder: '', projectRun: false })
    expect(laneLockPids(null)).toEqual({ pid: null, child: null, folder: '', projectRun: false })
  })
})

describe('laneStopProblem', () => {
  it('names the pid and the stop command in one sentence', () => {
    expect(laneStopProblem({ lane: 'opencode2', pid: 4242 }))
      .toBe('The opencode2 lane still has harness process 4242; stop it with npm run run-lane -- --stop opencode2.')
    expect(laneStopProblem({ lane: 'opencode2', pid: 4242, leftover: true }))
      .toBe('The opencode2 lane still has leftover process 4242; stop it with npm run run-lane -- --stop opencode2.')
    expect(laneStopProblem({ lane: '', pid: 4242 })).toBe('')
    expect(laneStopProblem({ lane: 'opencode2', pid: 0 })).toBe('')
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
      inputTokens: 1500,
      outputTokens: 300,
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
      inputTokens: 1500,
      outputTokens: 300,
      log: 'C:\\Temp\\machineroom-runs\\hermes-T3.log',
      branch: 'feat/t3-run-records-and',
      commits: ['abc1234 0.1.44: Record each lane run'],
    })
    expect(Object.keys(record)).toEqual([
      'lane', 'briefs', 'model', 'reasoning', 'startedAt', 'minutes', 'exitCode', 'killed', 'costUsd', 'inputTokens', 'outputTokens', 'log', 'branch', 'commits',
    ])
  })

  it('writes the count of stopped leftovers only when there were some', () => {
    const record = runRecord({ lane: 'opencode2', briefs: ['U75'], stoppedLeftovers: 3 })
    expect(record.stoppedLeftovers).toBe(3)
    expect(Object.keys(record).slice(-1)).toEqual(['stoppedLeftovers'])
    expect(runRecord({ lane: 'opencode2', briefs: [] })).not.toHaveProperty('stoppedLeftovers')
    expect(runRecord({ lane: 'opencode2', briefs: [], stoppedLeftovers: 0 })).not.toHaveProperty('stoppedLeftovers')
    expect(runRecord({ lane: 'opencode2', briefs: [], stoppedLeftovers: -2 })).not.toHaveProperty('stoppedLeftovers')
    expect(runRecord({ lane: 'opencode2', briefs: [], stoppedLeftovers: '2' })).not.toHaveProperty('stoppedLeftovers')
  })

  it('records retried runs with retried: true', () => {
    const record = runRecord({ lane: 'opencode', retried: true })
    expect(record.retried).toBe(true)
    expect(runRecord({ lane: 'opencode' })).not.toHaveProperty('retried')
  })

  it('writes nulls where the run reported nothing', () => {
    const record = runRecord({ lane: 'opencode', briefs: 'T3', startedAt: 1760000000000, exitCode: null, costUsd: undefined })
    expect(record.briefs).toEqual([])
    expect(record.commits).toEqual([])
    expect(record.model).toBeNull()
    expect(record.reasoning).toBeNull()
    expect(record.exitCode).toBeNull()
    expect(record.costUsd).toBeNull()
    expect(record.inputTokens).toBeNull()
    expect(record.outputTokens).toBeNull()
    expect(record.killed).toBe(false)
    expect(record.startedAt).toBe('2025-10-09T08:53:20.000Z')
  })
})

describe('projectRunGit', () => {
  it('names the branch only when it changed and keeps the commits it was given', () => {
    expect(projectRunGit({ branch: 'machineroom/queue-opencode-20261029-120000', startBranch: 'main', commits: 'abc1234 Write the lane note.' }))
      .toEqual({ branch: 'machineroom/queue-opencode-20261029-120000', commits: ['abc1234 Write the lane note.'] })
    expect(projectRunGit({ branch: 'main', startBranch: 'main', commits: 'abc1234 Write the lane note.' }))
      .toEqual({ branch: '', commits: ['abc1234 Write the lane note.'] })
    expect(projectRunGit({ branch: '', startBranch: 'main', commits: [] })).toEqual({ branch: '', commits: [] })
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

describe('formatOutcomes', () => {
  it('prints one line per row with the merge rate, the fixes and the cost per merge', () => {
    const rows = [
      { lane: 'hermes', model: 'deepseek/x', runs: 5, merged: 4, rejected: 1, pending: 0, mergeRate: 0.8, averageFixes: 0.5, costUsd: 0.4, decidedCostUsd: 0.24, costPerMerge: 0.06 },
      { lane: 'opencode', model: 'model unknown', runs: 1, merged: 0, rejected: 1, pending: 0, mergeRate: 0, averageFixes: null, costUsd: 0.2, decidedCostUsd: 0.2, costPerMerge: null },
    ]

    expect(formatOutcomes(rows)).toEqual([
      'hermes  deepseek/x  runs 5, merged 4, rejected 1, pending 0, merge rate 80%, fixes 0.5, $0.06 a merge',
      'opencode  model unknown  runs 1, merged 0, rejected 1, pending 0, merge rate 0%, fixes -, - a merge',
    ])
  })

  it('prints a dash for a null rate and says so with no rows', () => {
    expect(formatOutcomes([
      { lane: 'hermes', model: 'm', runs: 1, merged: 1, rejected: 0, pending: 0, mergeRate: null, averageFixes: 1, costPerMerge: 1 },
    ])).toEqual(['hermes  m  runs 1, merged 1, rejected 0, pending 0, merge rate -, fixes 1, $1.00 a merge'])
    expect(formatOutcomes([])).toEqual(['No runs yet.'])
    expect(formatOutcomes(null)).toEqual(['No runs yet.'])
  })
})

describe('filterRunsSince', () => {
  it('keeps the runs that started on or after the day', () => {
    const records = [
      { lane: 'hermes', startedAt: '2026-10-18T23:59:59.999Z' },
      { lane: 'hermes', startedAt: '2026-10-19T00:00:00.000Z' },
      { lane: 'hermes', startedAt: 'not a time' },
      null,
    ]

    expect(filterRunsSince(records, '2026-10-19').map((record) => record.startedAt)).toEqual(['2026-10-19T00:00:00.000Z'])
    expect(filterRunsSince(records)).toHaveLength(3)
    expect(filterRunsSince('nope', '2026-10-19')).toEqual([])
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
  it('runs the tests again after the crash and keeps the second result', async (context) => {
    context.skip(process.platform !== 'win32', 'Only Windows keeps a 32 bit exit code. Linux keeps the low 8 bits, so 0xC0000409 arrives as 9.')
    const folder = makeTempDir('machine-room-test-')
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
      rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('runs a failing test once and keeps its code', async () => {
    const folder = makeTempDir('machine-room-test-')
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
      rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })
})

const RUN_LANE_SCRIPT = fileURLToPath(new URL('../scripts/run-lane.mjs', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const TASKS_MARKDOWN = readFileSync(new URL('../docs/agents/TASKS.md', import.meta.url), 'utf8')

function checkoutRoot() {
  const found = spawnSync(gitPath(), ['rev-parse', '--git-common-dir'], { cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true })
  if (found.status !== 0) throw new Error(String(found.stderr ?? '').trim() || 'git rev-parse failed.')
  return realpathSync.native(dirname(resolve(REPO_ROOT, String(found.stdout ?? '').trim())))
}

function lanesFileUnderWorktrees(folder) {
  const worktrees = join(checkoutRoot(), '.worktrees')
  const copy = JSON.parse(JSON.stringify(lanes))
  for (const [key, lane] of Object.entries(copy)) {
    if (!lane || typeof lane !== 'object') continue
    if (typeof lane.worktree !== 'string' || lane.worktree.trim() === '') continue
    lane.worktree = join(worktrees, `q13-${key}-${process.pid}`)
  }
  const path = join(folder, 'lanes.json')
  writeFileSync(path, `${JSON.stringify(copy, null, 2)}\n`)
  return path
}

function runLane(args, env = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [RUN_LANE_SCRIPT, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      rejectRun(new Error(`run-lane did not exit. stderr: ${stderr}`))
    }, 30000)
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

describe('scripts/run-lane.mjs', () => {
  it('prints the outcome table from a temp runs folder, with --since filtering the runs', async () => {
    const folder = makeTempDir('machine-room-outcomes-')
    try {
      const runsFolder = join(folder, 'machineroom-runs')
      mkdirSync(runsFolder, { recursive: true })
      writeFileSync(join(runsFolder, 'runs.jsonl'), [
        JSON.stringify({ lane: 'hermes', model: 'deepseek/x', branch: 'feat/a', costUsd: 0.5, startedAt: '2026-10-19T10:00:00.000Z' }),
        JSON.stringify({ lane: 'hermes', model: 'deepseek/x', branch: 'feat/b', costUsd: 0.1, startedAt: '2026-10-19T11:00:00.000Z' }),
        JSON.stringify({ lane: 'hermes', model: 'deepseek/x', branch: 'feat/c', costUsd: 0.4, startedAt: '2026-10-18T09:00:00.000Z' }),
      ].join('\n'))
      writeFileSync(join(runsFolder, 'outcomes.jsonl'), `${JSON.stringify({ branch: 'feat/a', outcome: 'merged', fixes: 1 })}\n`)

      const all = await runLane(['--outcomes'], { TEMP: folder, MACHINEROOM_RUNS: runsFolder })
      expect(all.code).toBe(0)
      expect(all.stdout.trim()).toBe('hermes  deepseek/x  runs 3, merged 1, rejected 0, pending 2, merge rate 100%, fixes 1, $0.50 a merge')

      const since = await runLane(['--outcomes', '--since', '2026-10-19'], { TEMP: folder, MACHINEROOM_RUNS: runsFolder })
      expect(since.code).toBe(0)
      expect(since.stdout.trim()).toBe('hermes  deepseek/x  runs 2, merged 1, rejected 0, pending 1, merge rate 100%, fixes 1, $0.50 a merge')

      const emptyTemp = join(folder, 'empty')
      mkdirSync(emptyTemp, { recursive: true })
      const empty = await runLane(['--outcomes'], { TEMP: emptyTemp, MACHINEROOM_RUNS: join(emptyTemp, 'machineroom-runs') })
      expect(empty.code).toBe(0)
      expect(empty.stdout.trim()).toBe('No runs yet.')
    } finally {
      rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('reads its records from the runs folder MACHINEROOM_RUNS names', async () => {
    const folder = makeTempDir('machine-room-env-runs-')
    try {
      const runsFolder = join(folder, 'named-runs')
      mkdirSync(runsFolder, { recursive: true })
      writeFileSync(
        join(runsFolder, 'runs.jsonl'),
        `${JSON.stringify({ lane: 'hermes', model: 'deepseek/x', branch: 'feat/a', costUsd: 0.2, startedAt: '2026-10-19T10:00:00.000Z' })}\n`
      )
      writeFileSync(join(runsFolder, 'outcomes.jsonl'), `${JSON.stringify({ branch: 'feat/a', outcome: 'merged', fixes: 0 })}\n`)
      const emptyTemp = join(folder, 'empty')
      mkdirSync(emptyTemp, { recursive: true })

      const result = await runLane(['--outcomes'], { TEMP: emptyTemp, MACHINEROOM_RUNS: runsFolder })
      expect(result.code).toBe(0)
      expect(result.stdout.trim()).toContain('hermes  deepseek/x  runs 1, merged 1, rejected 0, pending 0, merge rate 100%')
    } finally {
      rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('refuses a merged brief before it prints the dry run', async () => {
    const merged = parseBriefs(TASKS_MARKDOWN).find(
      (brief) => brief.done && Array.isArray(brief.owners) && brief.owners.includes('opencode')
    )
    expect(merged).toBeTruthy()
    const folder = makeTempDir('machine-room-merged-brief-')
    try {
      const result = await runLane(['opencode', merged.id, '--dry-run'], {
        MACHINEROOM_LANES_FILE: lanesFileUnderWorktrees(folder),
        MACHINEROOM_RUNS: join(folder, 'runs'),
      })
      expect(result.code).toBe(1)
      expect(result.stdout).toContain(`Brief ${merged.id} is marked ${merged.ownerText}.`)
      expect(result.stdout).not.toContain('args:')
      expect(result.stdout).not.toContain('cwd:')
    } finally {
      rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('refuses a retired lane before anything starts, and runs it with --force', async () => {
    const folder = makeTempDir('machine-room-retired-lane-')
    try {
      const runEnv = {
        MACHINEROOM_LANES_FILE: lanesFileUnderWorktrees(folder),
        MACHINEROOM_RUNS: join(folder, 'runs'),
        LOCALAPPDATA: process.env.LOCALAPPDATA ?? folder,
      }
      const refused = await runLane(['hermes', 'S2a', '--dry-run'], runEnv)
      expect(refused.code).toBe(1)
      expect(refused.stdout).toContain('The hermes lane is retired.')
      expect(refused.stdout).not.toContain('args:')
      expect(refused.stdout).not.toContain('cwd:')

      const forced = await runLane(['hermes', 'S2a', '--dry-run', '--force'], runEnv)
      expect(forced.code).toBe(0)
      expect(forced.stdout).toContain('file:')
      expect(forced.stdout).toContain('args:')
      expect(forced.stdout).toContain('cwd:')
    } finally {
      rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('refuses a dry run whose lane worktree is the main checkout', async () => {
    const folder = makeTempDir('machine-room-brief-worktree-')
    try {
      const checkout = checkoutRoot()
      const lanesFile = join(folder, 'lanes.json')
      writeFileSync(lanesFile, JSON.stringify({
        opencode: {
          name: 'OpenCode',
          worktree: checkout,
          cli: { harness: 'opencode', bin: 'opencode' },
        },
      }))
      const result = await runLane(['opencode', 'U77', '--force', '--dry-run'], {
        MACHINEROOM_LANES_FILE: lanesFile,
        MACHINEROOM_RUNS: join(folder, 'runs'),
      })
      expect(result.code).toBe(1)
      expect(result.stdout).toContain(`The lane worktree ${checkout} is the main checkout`)
      expect(result.stdout).not.toContain('args:')
      expect(result.stdout).not.toContain('cwd:')
    } finally {
      rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('prints MCP config and servers on dry run without exposing env values, and omits them when none are enabled', async () => {
    const folder = makeTempDir('machine-room-mcp-dry-')
    try {
      const runs = join(folder, 'runs')
      mkdirSync(runs, { recursive: true })
      const lanesFile = lanesFileUnderWorktrees(folder)

      const noMcp = await runLane(['opencode', 'S2a', '--dry-run', '--force'], {
        MACHINEROOM_LANES_FILE: lanesFile,
        MACHINEROOM_RUNS: runs,
        APPDATA: process.env.APPDATA ?? folder,
      })
      expect(noMcp.code).toBe(0)
      expect(noMcp.stdout).not.toContain('mcp config:')
      expect(noMcp.stdout).not.toContain('mcp servers:')

      writeFileSync(join(runs, 'mcp.json'), JSON.stringify({
        servers: [
          { name: 'browser', transport: 'http', url: 'https://example.com/mcp', enabled: true },
          { name: 'db', transport: 'stdio', command: 'node', args: ['db.js'], env: { SECRET_KEY: 'topsecret' }, enabled: true },
          { name: 'disabled_srv', transport: 'stdio', command: 'node', enabled: false },
        ],
      }))

      const withMcp = await runLane(['opencode', 'S2a', '--dry-run', '--force'], {
        MACHINEROOM_LANES_FILE: lanesFile,
        MACHINEROOM_RUNS: runs,
        APPDATA: process.env.APPDATA ?? folder,
      })
      expect(withMcp.code).toBe(0)
      expect(withMcp.stdout).toContain('mcp config:')
      expect(withMcp.stdout).toContain('mcp servers: browser, db')
      expect(withMcp.stdout).not.toContain('disabled_srv')
      expect(withMcp.stdout).not.toContain('topsecret')
    } finally {
      rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('writes and cleans up MCP config during lane run and writes nothing when none is enabled', async () => {
    const folder = makeTempDir('machine-room-mcp-run-')
    try {
      const runs = join(folder, 'runs')
      const project = join(folder, 'project')
      mkdirSync(runs, { recursive: true })
      mkdirSync(project, { recursive: true })
      const previous = process.env.MACHINEROOM_RUNS
      process.env.MACHINEROOM_RUNS = runs
      const checkFile = join(folder, 'mcp-existed.txt')
      const script = join(project, 'run')
      writeFileSync(script, [
        "const { writeFileSync, existsSync } = require('node:fs')",
        "const cfg = process.env.OPENCODE_CONFIG || ''",
        "const existed = cfg ? existsSync(cfg) : false",
        `writeFileSync(${JSON.stringify(checkFile)}, JSON.stringify({ cfg, existed }))`,
        "console.log('{\"type\":\"step_finish\",\"part\":{\"cost\":0,\"tokens\":{\"input\":1,\"output\":1}}}')",
        '',
      ].join('\n'))
      const lane = {
        name: 'test-opencode',
        worktree: project,
        cli: { harness: 'opencode', bin: process.execPath, model: 'fake/model' },
      }

      await startLane({
        options: { lane: 'test-opencode', minutes: 1 },
        lane,
        lanes: { 'test-opencode': lane },
        wanted: [],
        prompt: 'test prompt',
        logPath: join(runs, 'run-no-mcp.log'),
        usageFile: join(runs, 'run-no-mcp.usage.json'),
        name: 'run-no-mcp',
        project,
        task: 'task',
      })
      const noMcpResult = JSON.parse(readFileSync(checkFile, 'utf8'))
      expect(noMcpResult.cfg).toBe('')
      expect(noMcpResult.existed).toBe(false)
      expect(existsSync(join(runs, 'run-no-mcp.mcp.json'))).toBe(false)

      writeFileSync(join(runs, 'mcp.json'), JSON.stringify({
        servers: [
          { name: 'browser', transport: 'http', url: 'https://example.com/mcp', enabled: true },
        ],
      }))
      await startLane({
        options: { lane: 'test-opencode', minutes: 1 },
        lane,
        lanes: { 'test-opencode': lane },
        wanted: [],
        prompt: 'test prompt',
        logPath: join(runs, 'run-with-mcp.log'),
        usageFile: join(runs, 'run-with-mcp.usage.json'),
        name: 'run-with-mcp',
        project,
        task: 'task',
      })
      const withMcpResult = JSON.parse(readFileSync(checkFile, 'utf8'))
      expect(withMcpResult.cfg).toBe(join(runs, 'run-with-mcp.mcp.json'))
      expect(withMcpResult.existed).toBe(true)
      expect(existsSync(join(runs, 'run-with-mcp.mcp.json'))).toBe(false)

      if (previous === undefined) delete process.env.MACHINEROOM_RUNS
      else process.env.MACHINEROOM_RUNS = previous
    } finally {
      rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('omits bridge API keys for a machineroom lane when model names a saved endpoint', async () => {
    const folder = makeTempDir('mr-lane-env-endpoints-')
    const runs = join(folder, 'runs')
    mkdirSync(runs, { recursive: true })
    const checkFile = join(folder, 'env.json')
    const script = join(folder, 'record-env.mjs')
    writeFileSync(
      script,
      `import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[2], JSON.stringify({
        hasOpenRouter: Object.hasOwn(process.env, 'OPENROUTER_API_KEY'),
        hasMrKey: Object.hasOwn(process.env, 'MACHINEROOM_API_KEY'),
        hasMrUrl: Object.hasOwn(process.env, 'MACHINEROOM_API_URL'),
      }));\n`
    )

    writeFileSync(
      join(runs, 'endpoints.json'),
      JSON.stringify([
        { name: 'Ollama', baseUrl: 'http://localhost:11434/v1', provider: 'Custom', keyName: '', models: ['llama3'] },
      ])
    )

    const prevOpenRouter = process.env.OPENROUTER_API_KEY
    const prevMrKey = process.env.MACHINEROOM_API_KEY
    const prevMrUrl = process.env.MACHINEROOM_API_URL
    process.env.OPENROUTER_API_KEY = 'placeholder'
    process.env.MACHINEROOM_API_KEY = 'placeholder'
    process.env.MACHINEROOM_API_URL = 'http://127.0.0.1:9999'

    const previousCmd = harnessByKey.machineroom.command
    harnessByKey.machineroom.command = () => ({
      file: process.execPath,
      args: [script, checkFile],
      cwd: folder,
    })

    try {
      const lane = {
        name: 'test-machineroom',
        worktree: folder,
        cli: { harness: 'machineroom', bin: process.execPath, model: 'Ollama/llama3' },
      }

      await startLane({
        options: { lane: 'test-machineroom', minutes: 1, runs },
        lane,
        lanes: { 'test-machineroom': lane },
        wanted: [],
        prompt: 'prompt',
        logPath: join(runs, 'run.log'),
        usageFile: join(runs, 'run.usage.json'),
        name: 'run-mr-endpoint',
        project: folder,
        task: 'task',
      })
      const envResult = JSON.parse(readFileSync(checkFile, 'utf8'))
      expect(envResult.hasOpenRouter).toBe(false)
      expect(envResult.hasMrKey).toBe(false)
      expect(envResult.hasMrUrl).toBe(false)
    } finally {
      harnessByKey.machineroom.command = previousCmd
      for (const [name, value] of [['OPENROUTER_API_KEY', prevOpenRouter], ['MACHINEROOM_API_KEY', prevMrKey], ['MACHINEROOM_API_URL', prevMrUrl]]) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
      rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('writes a retried: true record for the first log before retrying on readiness exit', async () => {
    const folder = makeTempDir('machine-room-retry-run-')
    try {
      const runs = join(folder, 'runs')
      const project = join(folder, 'project')
      mkdirSync(runs, { recursive: true })
      mkdirSync(project, { recursive: true })
      const previous = process.env.MACHINEROOM_RUNS
      process.env.MACHINEROOM_RUNS = runs
      const countFile = join(folder, 'count.txt')
      writeFileSync(countFile, '0')
      const script = join(project, 'run')
      writeFileSync(script, [
        "const { readFileSync, writeFileSync } = require('node:fs')",
        `const count = Number(readFileSync(${JSON.stringify(countFile)}, 'utf8')) + 1`,
        `writeFileSync(${JSON.stringify(countFile)}, String(count))`,
        "if (count === 1) {",
        "  console.log('Standalone server exited before reporting readiness')",
        "  process.exit(1)",
        "} else {",
        "  console.log('{\"type\":\"step_finish\",\"part\":{\"cost\":0,\"tokens\":{\"input\":1,\"output\":1}}}')",
        "  process.exit(0)",
        "}",
      ].join('\n'))
      const lane = {
        name: 'test-opencode',
        worktree: project,
        cli: { harness: 'opencode', bin: process.execPath, model: 'fake/model' },
      }
      await startLane({
        options: { lane: 'test-opencode', minutes: 1 },
        lane,
        lanes: { 'test-opencode': lane },
        wanted: [],
        prompt: 'test prompt',
        logPath: join(runs, 'run-retry.log'),
        usageFile: join(runs, 'run-retry.usage.json'),
        name: 'run-retry',
        project,
        task: 'task',
      })
      const records = readFileSync(join(runs, 'runs.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      expect(records.length).toBe(2)
      expect(records[0].retried).toBe(true)
      expect(records[0].log).toBe(join(runs, 'run-retry.log'))
      expect(records[1].retried).toBeUndefined()
      expect(records[1].log).toBe(join(runs, 'run-retry-retry.log'))
      if (previous === undefined) delete process.env.MACHINEROOM_RUNS
      else process.env.MACHINEROOM_RUNS = previous
    } finally {
      rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })
})

describe('the record of a project run on a git project', { timeout: 30000 }, () => {
  const FAKE_LANE = fileURLToPath(new URL('fixtures/fake-lane.cjs', import.meta.url))

  function gitIn(folder, args) {
    const result = spawnSync(gitPath(), ['-c', 'user.name=MachineRoom Test', '-c', 'user.email=machineroom@example.invalid', '-c', 'commit.gpgsign=false', ...args], {
      cwd: folder,
      encoding: 'utf8',
      windowsHide: true,
    })
    if (result.error) throw result.error
    if (result.status !== 0) {
      const stderr = String(result.stderr ?? '').trim()
      if (stderr !== '') throw new Error(`git ${args.join(' ')} failed in ${folder}: ${stderr}`)
      throw new Error(`git ${args.join(' ')} failed in ${folder} with exit ${result.status} and signal ${result.signal ?? 'none'}.`)
    }
    return String(result.stdout ?? '').trim()
  }

  function setupProject(base) {
    const project = join(base, 'Other')
    mkdirSync(project, { recursive: true })
    gitIn(project, ['init', '-q', '-b', 'main'])
    writeFileSync(join(project, 'readme.txt'), 'start\n')
    writeFileSync(join(project, 'package.json'), `${JSON.stringify({ scripts: { test: 'node --version' } })}\n`)
    copyFileSync(FAKE_LANE, join(project, 'run'))
    gitIn(project, ['add', '-A'])
    gitIn(project, ['commit', '-q', '-m', 'Start the project'])
    const runs = join(base, 'runs')
    mkdirSync(runs, { recursive: true })
    const lanesFile = join(base, 'lanes.json')
    writeFileSync(lanesFile, `${JSON.stringify({
      opencode: {
        name: 'Fake lane',
        cli: { harness: 'opencode', bin: process.execPath, model: 'opencode/fake' },
      },
    }, null, 2)}\n`)
    return {
      project,
      runs,
      env: {
        TEMP: base,
        MACHINEROOM_RUNS: runs,
        MACHINEROOM_LANES_FILE: lanesFile,
        GIT_AUTHOR_NAME: 'MachineRoom Test',
        GIT_AUTHOR_EMAIL: 'test@example.invalid',
        GIT_COMMITTER_NAME: 'MachineRoom Test',
        GIT_COMMITTER_EMAIL: 'test@example.invalid',
      },
    }
  }

  function readLatestRecord(runs) {
    const lines = readFileSync(join(runs, 'runs.jsonl'), 'utf8').trim().split(/\r?\n/)
    return JSON.parse(lines[lines.length - 1])
  }

  it('records its branch and one commit for a queue run with one committed task', async () => {
    const base = makeTempDir('machine-room-project-record-')
    try {
      const { project, runs, env } = setupProject(base)
      const file = join(base, 'queue.txt')
      writeFileSync(file, 'Write the lane note.\n')
      const result = await runLane(['opencode', '--project', project, '--queue', file], env)
      expect(result.code).toBe(0)
      const record = readLatestRecord(runs)
      expect(record.project).toBe(realpathSync.native(project))
      expect(record.branch).toMatch(/^machineroom\/queue-opencode-/)
      expect(record.queue).toBe(record.branch)
      expect(record.commits).toHaveLength(1)
      expect(record.commits[0]).toContain('Write the lane note.')
      expect(gitIn(project, ['branch', '--show-current'])).toBe(record.branch)
      expect(gitIn(project, ['log', '--oneline', 'refs/heads/main..HEAD'])).toBe(record.commits[0])
    } finally {
      rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('records the commits on the worktree branch of a worktree run', async () => {
    const base = makeTempDir('machine-room-worktree-record-')
    try {
      const { project, runs, env } = setupProject(base)
      const result = await runLane(['opencode', '--project', project, '--task', 'Write the lane note.', '--worktree'], env)
      expect(result.code).toBe(0)
      const path = join(project, '.worktrees', 'opencode')
      const record = readLatestRecord(runs)
      expect(record.project).toBe(realpathSync.native(path))
      expect(record.branch).toMatch(/^machineroom\/queue-opencode-/)
      expect(record.queue).toBe(record.branch)
      expect(record.commits).toHaveLength(1)
      expect(record.commits[0]).toContain('Write the lane note.')
      expect(gitIn(path, ['branch', '--show-current'])).toBe(record.branch)
      expect(gitIn(path, ['log', '--oneline', 'refs/heads/main..HEAD'])).toBe(record.commits[0])
      expect(gitIn(project, ['branch', '--show-current'])).toBe('main')
    } finally {
      rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('records no branch and no commits for a run on the project branch with no commit', async () => {
    const base = makeTempDir('machine-room-project-nocommit-')
    try {
      const { project, runs, env } = setupProject(base)
      const result = await runLane(['opencode', '--project', project, '--task', 'Write the lane note.'], env)
      expect(result.code).toBe(0)
      const record = readLatestRecord(runs)
      expect(record.project).toBe(realpathSync.native(project))
      expect(record.branch).toBe('')
      expect(record.commits).toEqual([])
      expect(gitIn(project, ['branch', '--show-current'])).toBe('main')
    } finally {
      rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })
})

describe('a harness that fails before it starts', () => {
  it('reads the readiness sentence from the log', () => {
    const log = 'booting\n{"type":"text"}\nStandalone server exited before reporting readiness\n'
    expect(readinessLine(log)).toContain('Standalone server exited')
    expect(readinessLine('nothing here')).toBe('')
    expect(startFailureText({ harness: 'opencode', log })).toContain('Standalone server exited')
  })

  it('retries only a short run with no tool call, no commit and the readiness sentence', () => {
    const log = 'Standalone server exited before reporting readiness\n'
    const quiet = { exitCode: 1, minutes: 0, toolCalls: 0, commits: [], log }
    expect(retryStartProblem(quiet)).toBe('')
    expect(retryStartProblem({ ...quiet, exitCode: 0 })).toBe('the run ended well')
    expect(retryStartProblem({ ...quiet, toolCalls: 1 })).toBe('the run made a tool call')
    expect(retryStartProblem({ ...quiet, minutes: 1 })).toBe('the run lasted a minute or more')
    expect(retryStartProblem({ ...quiet, commits: ['abc1234 subject'] })).toBe('the run made a commit')
    expect(retryStartProblem({ ...quiet, log: 'plain stop' })).toBe('the log has no readiness sentence')
  })

  it('refuses a lane with no command line before a queue makes its branch', () => {
    expect(laneCommandProblem({ name: 'Bad lane' })).toBe('The lane Bad lane has no command line, so the runner cannot start it.')
    expect(() => commandFor({ lane: { name: 'Bad lane' }, prompt })).toThrow('The lane Bad lane has no command line, so the runner cannot start it.')
    expect(laneCommandProblem(lanes.hermes)).toBe('')
  })
})

describe('a lane key used in a path and a branch', () => {
  it('takes only one safe path component', () => {
    expect(worktreeFor('/work/sample', 'opencode')).toBe('/work/sample/.worktrees/opencode')
    expect(worktreeFor('/work/sample', '../escape')).toBe('')
    expect(worktreeFor('/work/sample', 'Bad lane')).toBe('')
    expect(worktreeFor('/work/sample', 'a/b')).toBe('')
  })
})
