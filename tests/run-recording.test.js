import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { agentsFile, framesFromRun, recordingIndex, treeFile } from '../src/briefs/recording.js'
import { prepare } from '../src/model/source.js'
import { writeRecording } from '../scripts/recording-files.mjs'

const lanes = JSON.parse(readFileSync(new URL('../docs/agents/lanes.json', import.meta.url), 'utf8'))
const scenarioTree = JSON.parse(readFileSync(new URL('../public/fixtures/scenario-a-tree.json', import.meta.url), 'utf8'))
const scenarioChunks = readFileSync(new URL('../public/fixtures/scenario-a-run.jsonl', import.meta.url), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .filter((frame) => frame.type === 'heartbeat.run.log')
  .map((frame) => frame.payload.chunk)
  .join('')
  .split(/\r?\n/)
  .filter((line) => {
    try {
      return JSON.parse(line).type === 'tool_use'
    } catch {
      return false
    }
  })

const opencodeLanes = { opencode: { ...lanes.opencode, worktree: 'C:\\scratch\\agent-sandbox' } }
const opencodeRecord = {
  lane: 'opencode',
  startedAt: '2026-10-17T15:03:47.863Z',
  minutes: 5,
  exitCode: 0,
  killed: false,
}

describe('framesFromRun for OpenCode', () => {
  const log = scenarioChunks.slice(0, 3).join('\n')
  const frames = framesFromRun({ harness: 'opencode', log, record: opencodeRecord })

  it('builds the queued frame, the running frame, one log frame per tool line and the end frame', () => {
    expect(frames.map((frame) => frame.type)).toEqual([
      'heartbeat.run.queued',
      'heartbeat.run.status',
      'heartbeat.run.log',
      'heartbeat.run.log',
      'heartbeat.run.log',
      'heartbeat.run.status',
    ])
    expect(frames.map((frame) => frame.id)).toEqual([1, 2, 3, 4, 5, 6])
    expect(frames[0].createdAt).toBe('2026-10-17T15:03:47.863Z')
    expect(frames[1].payload.status).toBe('running')
    expect(frames[5].payload.status).toBe('succeeded')
    expect(frames[2].payload.chunk).toBe(`${scenarioChunks[0]}\n`)
    expect(frames[2].payload.ts).toBe(frames[2].createdAt)
  })

  it('keeps the frames in time order with ISO times and made-up ids', () => {
    const times = frames.map((frame) => Date.parse(frame.createdAt))
    expect(times).toEqual([...times].sort((a, b) => a - b))
    expect(frames[0].payload.runId).toMatch(/^run-opencode-/)
    expect(frames[0].companyId).toMatch(/^company-opencode-/)
    expect(frames[0].payload.issueId).toMatch(/^issue-opencode-/)
    expect(frames[0].payload.agentId).toBe('agent-opencode')
    expect(frames[2].payload.seq).toBe(1)
    expect(frames[4].payload.seq).toBe(3)
  })

  it('prepares the frames into tool starts, touches and a run end', () => {
    const agents = agentsFile('opencode', opencodeLanes)
    const tree = treeFile('C:\\scratch\\agent-sandbox', scenarioTree.files)
    const { activities } = prepare({ frames, agentsFile: agents, treeFile: tree })
    expect(activities[0].type).toBe('run.queued')
    const starts = activities.filter((activity) => activity.type === 'tool.start')
    expect(starts.map((activity) => activity.label)).toEqual([
      '$ dir /b',
      '$ Get-ChildItem -Force | Select-Object Mode, Name',
      'read src/strings.js',
    ])
    expect(starts.map((activity) => activity.touches)).toEqual([
      [{ path: '', mode: 'list', kind: 'dir' }],
      [{ path: '', mode: 'list', kind: 'dir' }],
      [{ path: 'src/strings.js', mode: 'read', kind: 'file' }],
    ])
    expect(activities.find((activity) => activity.type === 'run.end')).toMatchObject({ ok: true, error: null })
  })
})

describe('framesFromRun for Hermes', () => {
  const session = readFileSync(new URL('./fixtures/hermes-session.jsonl', import.meta.url), 'utf8')
  const hermesLanes = { hermes: { ...lanes.hermes, worktree: 'C:\\work\\MachineRoom-hermes' } }
  const record = { lane: 'hermes', startedAt: '2026-10-19T15:05:15.000Z', minutes: 4, exitCode: 0, killed: false }
  const frames = framesFromRun({ harness: 'hermes', log: '', session, record })

  it('takes the time of each tool line from the result in the session export', () => {
    expect(frames).toHaveLength(5)
    expect(frames[2].createdAt).toBe('2026-10-19T15:05:21.150Z')
    expect(frames[3].createdAt).toBe('2026-10-19T15:05:26.806Z')
    expect(frames[2].payload.chunk.startsWith('┊')).toBe(true)
    expect(frames[2].payload.chunk).toContain('src\\briefs\\run.js')
    expect(frames[4].payload.status).toBe('succeeded')
  })

  it('prepares the frames into relative reads and writes and a run end', () => {
    const agents = agentsFile('hermes', hermesLanes)
    expect(frames[0].payload.agentId).toBe(agents.agents[0].id)
    const tree = treeFile('C:\\work\\MachineRoom-hermes', ['src/briefs/run.js', 'docs/agents/CHANGELOG.md'])
    const { activities } = prepare({ frames, agentsFile: agents, treeFile: tree })
    const starts = activities.filter((activity) => activity.type === 'tool.start')
    expect(starts.map((activity) => activity.label)).toEqual([
      'read src/briefs/run.js',
      'write docs/agents/CHANGELOG.md',
    ])
    expect(starts.map((activity) => activity.touches)).toEqual([
      [{ path: 'src/briefs/run.js', mode: 'read', kind: 'file' }],
      [{ path: 'docs/agents/CHANGELOG.md', mode: 'write', kind: 'file' }],
    ])
    expect(activities.find((activity) => activity.type === 'run.end')).toMatchObject({ ok: true, error: null })
  })
})

describe('the run end follows the record', () => {
  const log = scenarioChunks.slice(0, 1).join('\n')

  it('marks a non-zero exit as failed', () => {
    const frames = framesFromRun({ harness: 'opencode', log, record: { ...opencodeRecord, exitCode: 1 } })
    expect(frames[frames.length - 1].payload).toMatchObject({ status: 'failed', error: 'exit 1' })
  })

  it('marks a killed run as failed even when the exit code is zero', () => {
    const frames = framesFromRun({ harness: 'opencode', log, record: { ...opencodeRecord, killed: true } })
    expect(frames[frames.length - 1].payload).toMatchObject({ status: 'failed', error: 'killed' })
  })

  it('marks a run with no exit code as failed', () => {
    const frames = framesFromRun({ harness: 'opencode', log, record: { ...opencodeRecord, exitCode: null } })
    expect(frames[frames.length - 1].payload).toMatchObject({ status: 'failed', error: 'no exit code' })
  })
})

describe('agentsFile and treeFile', () => {
  it('names the agent and the worktree the same way the frames do', () => {
    const agents = agentsFile('hermes', lanes)
    expect(agents).toEqual({
      projectRoot: 'MachineRoom-hermes',
      agents: [
        {
          id: 'agent-hermes',
          key: 'hermes',
          name: 'Hermes',
          adapterType: 'hermes_local',
          parser: 'hermes',
        },
      ],
    })
    const frames = framesFromRun({
      harness: 'hermes',
      log: '',
      session: readFileSync(new URL('./fixtures/hermes-session.jsonl', import.meta.url), 'utf8'),
      record: { lane: 'hermes', startedAt: '2026-10-19T15:05:15.000Z', exitCode: 0 },
    })
    expect(frames[0].payload.agentId).toBe(agents.agents[0].id)
  })

  it('takes the root from the base name of the worktree', () => {
    expect(treeFile('C:\\GitHub\\MachineRoom-hermes\\', ['src/a.js'])).toEqual({
      root: 'MachineRoom-hermes',
      files: ['src/a.js'],
    })
  })

  it('refuses an unknown lane and an unknown harness', () => {
    expect(() => agentsFile('claude', lanes)).toThrow(/no lane named claude/)
    expect(() => framesFromRun({ harness: 'claude', log: '', record: { lane: 'claude', startedAt: '2026-10-19T00:00:00.000Z' } })).toThrow(/does not know/)
    expect(() => framesFromRun({ harness: 'opencode', log: '', record: {} })).toThrow(/start time/)
  })
})

const temporary = []

function tempFolder() {
  const dir = mkdtempSync(join(tmpdir(), 'mr-recording-'))
  temporary.push(dir)
  return dir
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, shell: false })
  if (result.error || result.status !== 0) throw new Error(`git ${args[0]} failed: ${String(result.stderr ?? '').trim()}`)
  return String(result.stdout ?? '').trim()
}

function worktreeWith(files) {
  const dir = tempFolder()
  git(dir, ['init', '-q', '-b', 'main'])
  for (const [name, text] of Object.entries(files)) {
    const path = join(dir, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  }
  git(dir, ['add', '-A'])
  git(dir, ['-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-q', '-m', 'one'])
  return { dir, sha: git(dir, ['rev-parse', 'HEAD']) }
}

function sessionFor(worktree) {
  const text = readFileSync(new URL('./fixtures/hermes-session.jsonl', import.meta.url), 'utf8')
  return text.replaceAll('C:\\\\work\\\\MachineRoom-hermes', worktree.replace(/\\/g, '\\\\'))
}

function readFrames(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function recordingOnce({ root, worktree, sha, name, startedAt = '2026-10-19T15:05:15.000Z', exitCode = 0 }) {
  const logPath = join(root, `${name}.log`)
  writeFileSync(logPath, 'the report\n')
  const record = {
    lane: 'hermes',
    briefs: ['T11'],
    model: 'deepseek/deepseek-v4.1-flash-1017',
    startedAt,
    minutes: 4,
    exitCode,
    killed: false,
    log: logPath,
    branch: 'feat/t11',
    commits: [`${sha} one`],
  }
  return writeRecording({ record, lanes: { hermes: { ...lanes.hermes, worktree } }, root, env: {}, session: sessionFor(worktree) })
}

describe('recordingIndex', () => {
  const entry = (name) => ({ name, lane: 'hermes', briefs: [], model: 'm', start: 's', minutes: 1, exitCode: 0, frames: 1, toolCalls: 1 })

  it('puts the new entry first and keeps the older ones in order', () => {
    const next = recordingIndex([entry('a'), entry('b')], entry('c'))
    expect(next.map((item) => item.name)).toEqual(['c', 'a', 'b'])
    expect(next[0].frames).toBe(1)
  })

  it('replaces an older entry with the same name', () => {
    const older = { ...entry('a'), minutes: 9 }
    const next = recordingIndex([older, entry('b')], entry('a'))
    expect(next.map((item) => item.name)).toEqual(['a', 'b'])
    expect(next[0].minutes).toBe(1)
  })

  it('cuts the list to the limit and to 50 by default', () => {
    const many = Array.from({ length: 60 }, (unused, index) => entry(`r${index}`))
    expect(recordingIndex(many, entry('new'), 3).map((item) => item.name)).toEqual(['new', 'r0', 'r1'])
    expect(recordingIndex(many, entry('new'))).toHaveLength(50)
    expect(recordingIndex(many, entry('new'))[0].name).toBe('new')
  })

  it('drops junk entries and names that are not plain', () => {
    const junk = [null, 'x', 42, [], {}, { name: 5 }, { name: '../x' }, { name: 'a/b' }, { name: '' }, { name: '.hidden' }]
    const next = recordingIndex([...junk, entry('a')], entry('b'))
    expect(next.map((item) => item.name)).toEqual(['b', 'a'])
  })

  it('drops a new entry with no plain name and keeps the older list', () => {
    expect(recordingIndex([entry('a')], { name: '../x' }).map((item) => item.name)).toEqual(['a'])
    expect(recordingIndex([entry('a')], null).map((item) => item.name)).toEqual(['a'])
    expect(recordingIndex(null, entry('a')).map((item) => item.name)).toEqual(['a'])
  })
})

describe('writeRecording', () => {
  afterEach(() => {
    for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('writes the three recording files for a Hermes record from the session export it is given', () => {
    const { dir, sha } = worktreeWith({ 'src/briefs/run.js': 'x\n', 'docs/agents/CHANGELOG.md': 'y\n' })
    const root = tempFolder()
    const logPath = join(root, 'hermes-T10-20261020-101010.log')
    writeFileSync(logPath, 'the report\n')
    const record = {
      lane: 'hermes',
      startedAt: '2026-10-19T15:05:15.000Z',
      minutes: 4,
      exitCode: 0,
      killed: false,
      log: logPath,
      branch: 'feat/t10',
      commits: [`${sha} one`],
    }
    const written = writeRecording({ record, lanes: { hermes: { ...lanes.hermes, worktree: dir } }, root, env: {}, session: sessionFor(dir) })

    expect(written.name).toBe('hermes-T10-20261020-101010')
    expect(written.runPath).toBe(join(root, 'public', 'recordings', 'hermes-T10-20261020-101010-run.jsonl'))
    expect(written.agentsPath).toBe(join(root, 'public', 'recordings', 'hermes-T10-20261020-101010-agents.json'))
    expect(written.treePath).toBe(join(root, 'public', 'recordings', 'hermes-T10-20261020-101010-tree.json'))
    expect(written.frames).toBe(5)
    expect(written.toolCalls).toBe(2)

    const frames = readFrames(written.runPath)
    expect(frames).toHaveLength(5)
    expect(frames[frames.length - 1].payload).toMatchObject({ status: 'succeeded', error: null })
    const agents = JSON.parse(readFileSync(written.agentsPath, 'utf8'))
    expect(agents.agents[0]).toMatchObject({ key: 'hermes', parser: 'hermes' })
    const tree = JSON.parse(readFileSync(written.treePath, 'utf8'))
    expect([...tree.files].sort()).toEqual(['docs/agents/CHANGELOG.md', 'src/briefs/run.js'])
  })

  it('writes the three recording files for an OpenCode record and marks a failed run', () => {
    const { dir, sha } = worktreeWith({ 'README.md': 'x\n' })
    const root = tempFolder()
    const logPath = join(root, 'opencode-T10-20261020-101010.log')
    writeFileSync(logPath, readFileSync(new URL('./fixtures/opencode-run-json.jsonl', import.meta.url), 'utf8'))
    const record = {
      lane: 'opencode',
      startedAt: '2026-10-20T10:10:10.000Z',
      minutes: 3,
      exitCode: 1,
      killed: false,
      log: logPath,
      branch: 'feat/t10',
      commits: [`${sha} one`],
    }
    const written = writeRecording({ record, lanes: { opencode: { ...lanes.opencode, worktree: dir } }, root, env: {} })

    expect(written.name).toBe('opencode-T10-20261020-101010')
    expect(written.frames).toBe(5)
    expect(written.toolCalls).toBe(2)
    const frames = readFrames(written.runPath)
    expect(frames[frames.length - 1].payload).toMatchObject({ status: 'failed', error: 'exit 1' })
    const tree = JSON.parse(readFileSync(written.treePath, 'utf8'))
    expect(tree.files).toEqual(['README.md'])
  })

  it('refuses a record whose log is gone and writes nothing', () => {
    const { dir, sha } = worktreeWith({ 'README.md': 'x\n' })
    const root = tempFolder()
    const record = { lane: 'opencode', log: join(root, 'gone.log'), branch: 'main', commits: [`${sha} one`] }
    expect(() => writeRecording({ record, lanes: { opencode: { ...lanes.opencode, worktree: dir } }, root, env: {} })).toThrow('The log for that run is gone.')
    expect(existsSync(join(root, 'public'))).toBe(false)
  })

  it('refuses an unknown lane and a lane with no command line', () => {
    const root = tempFolder()
    expect(() => writeRecording({ record: { lane: 'claude' }, lanes, root, env: {} })).toThrow(/no lane named claude/)
    expect(() => writeRecording({ record: { lane: 'agy' }, lanes, root, env: {} })).toThrow(/no command line/)
  })

  it('writes an index with the new entry and no index error', () => {
    const { dir, sha } = worktreeWith({ 'src/briefs/run.js': 'x\n', 'docs/agents/CHANGELOG.md': 'y\n' })
    const root = tempFolder()
    const written = recordingOnce({ root, worktree: dir, sha, name: 'hermes-T11-20261020-101010' })

    expect(written.indexError).toBeNull()
    const index = JSON.parse(readFileSync(join(root, 'public', 'recordings', 'index.json'), 'utf8'))
    expect(index).toEqual([
      {
        name: 'hermes-T11-20261020-101010',
        lane: 'hermes',
        briefs: ['T11'],
        model: 'deepseek/deepseek-v4.1-flash-1017',
        start: '2026-10-19T15:05:15.000Z',
        minutes: 4,
        exitCode: 0,
        frames: 5,
        toolCalls: 2,
      },
    ])
  })

  it('puts a second recording first in the index', () => {
    const { dir, sha } = worktreeWith({ 'src/briefs/run.js': 'x\n', 'docs/agents/CHANGELOG.md': 'y\n' })
    const root = tempFolder()
    recordingOnce({ root, worktree: dir, sha, name: 'hermes-T11-20261020-101010' })
    recordingOnce({ root, worktree: dir, sha, name: 'hermes-T11-20261020-111111', startedAt: '2026-10-19T16:05:15.000Z' })

    const index = JSON.parse(readFileSync(join(root, 'public', 'recordings', 'index.json'), 'utf8'))
    expect(index.map((item) => item.name)).toEqual(['hermes-T11-20261020-111111', 'hermes-T11-20261020-101010'])
    expect(index[0].start).toBe('2026-10-19T16:05:15.000Z')
  })

  it('drops an entry whose run file is gone', () => {
    const { dir, sha } = worktreeWith({ 'src/briefs/run.js': 'x\n', 'docs/agents/CHANGELOG.md': 'y\n' })
    const root = tempFolder()
    const first = recordingOnce({ root, worktree: dir, sha, name: 'hermes-T11-20261020-101010' })
    rmSync(first.runPath)
    recordingOnce({ root, worktree: dir, sha, name: 'hermes-T11-20261020-111111', startedAt: '2026-10-19T16:05:15.000Z' })

    const index = JSON.parse(readFileSync(join(root, 'public', 'recordings', 'index.json'), 'utf8'))
    expect(index.map((item) => item.name)).toEqual(['hermes-T11-20261020-111111'])
  })

  it('replaces an index it cannot read', () => {
    const { dir, sha } = worktreeWith({ 'src/briefs/run.js': 'x\n', 'docs/agents/CHANGELOG.md': 'y\n' })
    const root = tempFolder()
    const folder = join(root, 'public', 'recordings')
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'index.json'), 'not json at all\n')
    const written = recordingOnce({ root, worktree: dir, sha, name: 'hermes-T11-20261020-101010' })

    expect(written.indexError).toBeNull()
    const index = JSON.parse(readFileSync(join(folder, 'index.json'), 'utf8'))
    expect(index.map((item) => item.name)).toEqual(['hermes-T11-20261020-101010'])
  })

  it('keeps the recording and returns an index error when the index cannot be written', () => {
    const { dir, sha } = worktreeWith({ 'src/briefs/run.js': 'x\n', 'docs/agents/CHANGELOG.md': 'y\n' })
    const root = tempFolder()
    const folder = join(root, 'public', 'recordings')
    mkdirSync(join(folder, 'index.json'), { recursive: true })
    const written = recordingOnce({ root, worktree: dir, sha, name: 'hermes-T11-20261020-101010' })

    expect(written.name).toBe('hermes-T11-20261020-101010')
    expect(existsSync(written.runPath)).toBe(true)
    expect(existsSync(written.treePath)).toBe(true)
    expect(written.indexError).toMatch(/^The index of the recordings could not be written: /)
  })
})
