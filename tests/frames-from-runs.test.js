import { describe, expect, it } from 'vitest'
import { buildRunFrames, parseLog, selectRuns, sortAndNumber } from '../scripts/frames-from-runs.mjs'

const COMPANY = 'company-1'
const RUN_ID = 'run-1'
const AGENT_ID = 'agent-1'
const ISSUE_ID = 'issue-1'

const runAnswer = (over = {}) => ({
  createdAt: '2026-10-17T12:00:00.000Z',
  startedAt: '2026-10-17T12:00:01.000Z',
  finishedAt: '2026-10-17T12:00:09.000Z',
  status: 'succeeded',
  errorCode: null,
  error: null,
  agentId: AGENT_ID,
  issueId: ISSUE_ID,
  ...over,
})

const logAnswer = (...entries) => ({
  content: entries.map((entry) => JSON.stringify({ stream: 'stdout', ...entry })).join('\n') + '\n',
})

const eventsAnswer = (events) => events

const line = (seq, chunk, ts) => ({ ts, stream: 'stdout', chunk, seq })

describe('selectRuns', () => {
  const list = {
    runs: [
      { runId: 'a', startedAt: '2026-10-17T11:00:00.000Z' },
      { runId: 'b', startedAt: '2026-10-17T12:00:00.000Z' },
      { runId: 'c', startedAt: '2026-10-17T13:00:00.000Z' },
    ],
  }

  it('keeps runs that start at or after the cutoff', () => {
    expect(selectRuns(list, '2026-10-17T12:00:00.000Z').map((run) => run.runId)).toEqual(['b', 'c'])
  })

  it('accepts a plain array as the answer', () => {
    expect(selectRuns(list.runs, '2026-10-17T13:00:00.000Z').map((run) => run.runId)).toEqual(['c'])
  })

  it('drops runs without a usable start time', () => {
    expect(selectRuns({ runs: [{ runId: 'x' }] }, '2026-01-01T00:00:00.000Z')).toEqual([])
  })
})

describe('parseLog', () => {
  it('reads one JSON object per line', () => {
    const parsed = parseLog(`${JSON.stringify(line(1, 'a', '2026-10-17T12:00:02.000Z'))}\n${JSON.stringify(line(2, 'b', '2026-10-17T12:00:03.000Z'))}\n`)
    expect(parsed.map((entry) => entry.chunk)).toEqual(['a', 'b'])
  })

  it('reads an empty log as no lines', () => {
    expect(parseLog('')).toEqual([])
  })
})

describe('buildRunFrames', () => {
  it('builds the queued, running, log and final frames in the live shape', () => {
    const frames = buildRunFrames({
      companyId: COMPANY,
      runId: RUN_ID,
      run: runAnswer(),
      log: logAnswer(line(1, 'hello\n', '2026-10-17T12:00:02.000Z')),
      events: eventsAnswer([]),
    })
    expect(frames.map((frame) => frame.type)).toEqual([
      'heartbeat.run.queued',
      'heartbeat.run.status',
      'heartbeat.run.log',
      'heartbeat.run.status',
    ])
    expect(frames[0]).toEqual({
      id: null,
      companyId: COMPANY,
      type: 'heartbeat.run.queued',
      createdAt: '2026-10-17T12:00:00.000Z',
      payload: { runId: RUN_ID, agentId: AGENT_ID, issueId: ISSUE_ID },
    })
    expect(frames[1].payload).toMatchObject({ status: 'running', startedAt: '2026-10-17T12:00:01.000Z', finishedAt: null })
    expect(frames[2].payload).toEqual({
      runId: RUN_ID,
      agentId: AGENT_ID,
      issueId: ISSUE_ID,
      ts: '2026-10-17T12:00:02.000Z',
      seq: 1,
      stream: 'stdout',
      chunk: 'hello\n',
      truncated: false,
    })
    expect(frames[3].payload).toMatchObject({ status: 'succeeded', error: null, errorCode: null, finishedAt: '2026-10-17T12:00:09.000Z' })
    expect(frames[3].createdAt).toBe('2026-10-17T12:00:09.000Z')
  })

  it('writes one log frame per NDJSON line', () => {
    const frames = buildRunFrames({
      companyId: COMPANY,
      runId: RUN_ID,
      run: runAnswer(),
      log: logAnswer(line(1, 'a', '2026-10-17T12:00:02.000Z'), line(2, 'b', '2026-10-17T12:00:03.000Z')),
      events: eventsAnswer([]),
    })
    const logs = frames.filter((frame) => frame.type === 'heartbeat.run.log')
    expect(logs.map((frame) => frame.payload.chunk)).toEqual(['a', 'b'])
    expect(logs.every((frame) => frame.payload.truncated === false)).toBe(true)
  })

  it('writes a frame only for events with level error', () => {
    const frames = buildRunFrames({
      companyId: COMPANY,
      runId: RUN_ID,
      run: runAnswer(),
      log: logAnswer(),
      events: eventsAnswer([
        { level: 'info', seq: 1, message: 'started', createdAt: '2026-10-17T12:00:02.000Z' },
        { level: 'error', seq: 2, message: 'spawn failed', createdAt: '2026-10-17T12:00:03.000Z' },
      ]),
    })
    const events = frames.filter((frame) => frame.type === 'heartbeat.run.event')
    expect(events).toHaveLength(1)
    expect(events[0].payload).toEqual({ runId: RUN_ID, agentId: AGENT_ID, issueId: ISSUE_ID, seq: 2, level: 'error', message: 'spawn failed' })
  })

  it('carries the failure onto the final status frame', () => {
    const frames = buildRunFrames({
      companyId: COMPANY,
      runId: RUN_ID,
      run: runAnswer({ status: 'failed', errorCode: 'spawn_failed', error: 'spawn node ENOENT' }),
      log: logAnswer(),
      events: eventsAnswer([]),
    })
    const last = frames[frames.length - 1]
    expect(last.type).toBe('heartbeat.run.status')
    expect(last.payload).toMatchObject({ status: 'failed', errorCode: 'spawn_failed', error: 'spawn node ENOENT' })
  })

  it('leaves out the final status while the run has not ended', () => {
    const frames = buildRunFrames({
      companyId: COMPANY,
      runId: RUN_ID,
      run: runAnswer({ status: 'running', finishedAt: null }),
      log: logAnswer(),
      events: eventsAnswer([]),
    })
    expect(frames.map((frame) => frame.type)).toEqual(['heartbeat.run.queued', 'heartbeat.run.status'])
  })
})

describe('sortAndNumber', () => {
  it('sorts by time and numbers the ids from 1', () => {
    const frames = buildRunFrames({
      companyId: COMPANY,
      runId: 'run-2',
      run: runAnswer({
        createdAt: '2026-10-17T11:00:00.000Z',
        startedAt: '2026-10-17T11:00:01.000Z',
        finishedAt: '2026-10-17T11:00:02.000Z',
      }),
      log: logAnswer(line(1, 'early', '2026-10-17T11:00:01.500Z')),
      events: eventsAnswer([]),
    }).concat(
      buildRunFrames({
        companyId: COMPANY,
        runId: RUN_ID,
        run: runAnswer(),
        log: logAnswer(line(1, 'late', '2026-10-17T12:00:02.000Z')),
        events: eventsAnswer([]),
      })
    )
    const ordered = sortAndNumber(frames)
    expect(ordered.map((frame) => frame.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(ordered.every((frame, index) => frame.id === index + 1)).toBe(true)
    expect(ordered[0].payload.runId).toBe('run-2')
    expect(ordered[7].payload.runId).toBe(RUN_ID)
    expect(ordered.map((frame) => Date.parse(frame.createdAt))).toEqual([...ordered.map((frame) => Date.parse(frame.createdAt))].sort((a, b) => a - b))
  })

  it('keeps log lines in seq order when their timestamps match', () => {
    const frames = buildRunFrames({
      companyId: COMPANY,
      runId: RUN_ID,
      run: runAnswer(),
      log: logAnswer(line(1, 'first', '2026-10-17T12:00:02.000Z'), line(2, 'second', '2026-10-17T12:00:02.000Z')),
      events: eventsAnswer([]),
    })
    const ordered = sortAndNumber(frames)
    const chunks = ordered.filter((frame) => frame.type === 'heartbeat.run.log').map((frame) => frame.payload.chunk)
    expect(chunks).toEqual(['first', 'second'])
  })
})
