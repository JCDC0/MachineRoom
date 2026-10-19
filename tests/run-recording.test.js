import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { agentsFile, framesFromRun, treeFile } from '../src/briefs/recording.js'
import { prepare } from '../src/model/source.js'

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
