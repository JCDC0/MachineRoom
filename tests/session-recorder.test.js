import { describe, expect, it } from 'vitest'
import {
  RECORD_MINUTES_DEFAULT,
  RECORD_MINUTES_MAX,
  RECORD_MINUTES_MIN,
  clampRecordMinutes,
  createSessionRecorder,
  recorderToReplay,
} from '../src/model/sessionRecorder.js'

const BASE = Date.parse('2026-10-26T10:00:00.000Z')
const MINUTE = 60000
const TOOL_LINE = '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tool-1","name":"Read","input":{"file_path":"src/app.js"}}]}}\n'

let nextId = 1

function at(ms) {
  return new Date(BASE + ms).toISOString()
}

function runFrame(type, ms, payload = {}) {
  return {
    id: nextId++,
    companyId: 'company-1',
    type,
    createdAt: at(ms),
    payload: { runId: 'run-1', agentId: 'agent-1', ...payload },
  }
}

function notice(ms) {
  return { id: nextId++, companyId: 'company-1', type: 'room.tick', createdAt: at(ms), payload: { at: at(ms) } }
}

function timesOf(recorder) {
  return recorder.frames().map((frame) => Date.parse(frame.createdAt) - BASE)
}

const AGENTS = {
  projectRoot: 'agent-sandbox',
  agents: [{ id: 'agent-1', key: 'claude', name: 'Claude Code', parser: 'claude' }],
}
const TREE = { root: 'agent-sandbox', files: ['src/app.js'], created: [] }

describe('clampRecordMinutes', () => {
  it('keeps the limits as they are', () => {
    expect(RECORD_MINUTES_DEFAULT).toBe(10)
    expect(RECORD_MINUTES_MIN).toBe(1)
    expect(RECORD_MINUTES_MAX).toBe(240)
    expect(clampRecordMinutes(RECORD_MINUTES_DEFAULT)).toBe(10)
    expect(clampRecordMinutes(RECORD_MINUTES_MIN)).toBe(1)
    expect(clampRecordMinutes(RECORD_MINUTES_MAX)).toBe(240)
  })

  it('clamps to the range and floors', () => {
    expect(clampRecordMinutes(0)).toBe(1)
    expect(clampRecordMinutes(-5)).toBe(1)
    expect(clampRecordMinutes(0.5)).toBe(1)
    expect(clampRecordMinutes(2.9)).toBe(2)
    expect(clampRecordMinutes(999)).toBe(240)
    expect(clampRecordMinutes(1e6)).toBe(240)
  })

  it('answers the default for anything that is not a number', () => {
    expect(clampRecordMinutes('abc')).toBe(10)
    expect(clampRecordMinutes('')).toBe(10)
    expect(clampRecordMinutes(null)).toBe(10)
    expect(clampRecordMinutes(undefined)).toBe(10)
    expect(clampRecordMinutes(NaN)).toBe(10)
    expect(clampRecordMinutes(Infinity)).toBe(10)
    expect(clampRecordMinutes(true)).toBe(10)
    expect(clampRecordMinutes({})).toBe(10)
    expect(clampRecordMinutes([])).toBe(10)
  })

  it('reads a numeric string', () => {
    expect(clampRecordMinutes('5')).toBe(5)
    expect(clampRecordMinutes('7.8')).toBe(7)
  })
})

describe('createSessionRecorder', () => {
  it('keeps nothing before the first run or conversation frame', () => {
    const recorder = createSessionRecorder()
    expect(recorder.push(notice(0))).toBe(false)
    expect(recorder.push(notice(1000))).toBe(false)
    expect(recorder.frames()).toEqual([])
    expect(recorder.started()).toBe(false)
    expect(recorder.span()).toBe(0)

    expect(recorder.push(runFrame('heartbeat.run.queued', 2000))).toBe(true)
    expect(recorder.started()).toBe(true)
    expect(timesOf(recorder)).toEqual([2000])
  })

  it('keeps every frame after the first activity, activity or not', () => {
    const recorder = createSessionRecorder()
    recorder.push(runFrame('heartbeat.run.queued', 0))
    recorder.push(notice(4000))
    recorder.push(runFrame('heartbeat.run.status', 5000, { status: 'running' }))
    expect(timesOf(recorder)).toEqual([0, 4000, 5000])
    expect(recorder.started()).toBe(true)
    expect(recorder.span()).toBe(5000)
  })

  it('drops a frame with no usable time', () => {
    const recorder = createSessionRecorder()
    expect(recorder.push({ type: 'heartbeat.run.queued', createdAt: 'not a time', payload: { runId: 'run-1' } })).toBe(false)
    expect(recorder.frames()).toEqual([])
  })

  it('keeps a ten minute window behind the newest frame', () => {
    const recorder = createSessionRecorder()
    recorder.push(runFrame('heartbeat.run.queued', 0))
    recorder.push(notice(5 * MINUTE))
    recorder.push(notice(10 * MINUTE))
    expect(timesOf(recorder)).toEqual([0, 5 * MINUTE, 10 * MINUTE])

    recorder.push(notice(10 * MINUTE + 1))
    expect(timesOf(recorder)).toEqual([5 * MINUTE, 10 * MINUTE, 10 * MINUTE + 1])
  })

  it('keeps a frame exactly one minute or ten minutes old', () => {
    const ten = createSessionRecorder()
    ten.push(runFrame('heartbeat.run.queued', 0))
    ten.push(notice(10 * MINUTE))
    expect(timesOf(ten)).toEqual([0, 10 * MINUTE])

    const one = createSessionRecorder({ minutes: 1 })
    one.push(runFrame('heartbeat.run.queued', 0))
    one.push(notice(MINUTE))
    expect(timesOf(one)).toEqual([0, MINUTE])
  })

  it('keeps a one minute window', () => {
    const recorder = createSessionRecorder({ minutes: 1 })
    recorder.push(runFrame('heartbeat.run.queued', 0))
    recorder.push(notice(30000))
    recorder.push(notice(61000))
    expect(timesOf(recorder)).toEqual([30000, 61000])
    expect(recorder.minutes()).toBe(1)
  })

  it('keeps a 240 minute window', () => {
    const recorder = createSessionRecorder({ minutes: 240 })
    recorder.push(runFrame('heartbeat.run.queued', 0))
    recorder.push(notice(120 * MINUTE))
    recorder.push(notice(240 * MINUTE))
    expect(timesOf(recorder)).toHaveLength(3)
    recorder.push(notice(240 * MINUTE + 1))
    expect(timesOf(recorder)).toEqual([120 * MINUTE, 240 * MINUTE, 240 * MINUTE + 1])
    expect(recorder.minutes()).toBe(240)
  })

  it('clamps the minutes it is given', () => {
    expect(createSessionRecorder({ minutes: 0 }).minutes()).toBe(1)
    expect(createSessionRecorder({ minutes: 500 }).minutes()).toBe(240)
    expect(createSessionRecorder({ minutes: 'abc' }).minutes()).toBe(10)
    expect(createSessionRecorder().minutes()).toBe(10)
  })

  it('trims at once when the minutes shrink', () => {
    const recorder = createSessionRecorder()
    recorder.push(runFrame('heartbeat.run.queued', 0))
    recorder.push(notice(5 * MINUTE))
    recorder.push(notice(9 * MINUTE))
    recorder.setMinutes(1)
    expect(timesOf(recorder)).toEqual([9 * MINUTE])
    expect(recorder.minutes()).toBe(1)
  })

  it('takes a longer window without bringing dropped frames back', () => {
    const recorder = createSessionRecorder()
    recorder.push(runFrame('heartbeat.run.queued', 0))
    recorder.push(notice(5 * MINUTE))
    recorder.setMinutes(1)
    expect(timesOf(recorder)).toEqual([5 * MINUTE])
    recorder.setMinutes(60)
    expect(timesOf(recorder)).toEqual([5 * MINUTE])
    recorder.push(notice(6 * MINUTE))
    expect(timesOf(recorder)).toEqual([5 * MINUTE, 6 * MINUTE])
    expect(recorder.minutes()).toBe(60)
  })

  it('clamps the minutes it is set to', () => {
    const recorder = createSessionRecorder()
    recorder.setMinutes(999)
    expect(recorder.minutes()).toBe(240)
    recorder.setMinutes('abc')
    expect(recorder.minutes()).toBe(10)
  })

  it('returns the frames in time order', () => {
    const recorder = createSessionRecorder()
    recorder.push(runFrame('heartbeat.run.queued', 3000))
    recorder.push(notice(1000))
    recorder.push(notice(2000))
    recorder.push(notice(4000))
    expect(timesOf(recorder)).toEqual([1000, 2000, 3000, 4000])
  })

  it('keeps the pushed order for frames at the same time', () => {
    const recorder = createSessionRecorder()
    const first = runFrame('heartbeat.run.queued', 1000)
    const second = notice(1000)
    recorder.push(first)
    recorder.push(second)
    expect(recorder.frames()).toEqual([first, second])
  })

  it('returns a copy of the list, not the list it keeps', () => {
    const recorder = createSessionRecorder()
    recorder.push(runFrame('heartbeat.run.queued', 0))
    const list = recorder.frames()
    expect(list).not.toBe(recorder.frames())
    list.pop()
    expect(recorder.frames()).toHaveLength(1)
    recorder.frames().push(notice(1000))
    expect(recorder.frames()).toHaveLength(1)
  })

  it('clears everything and starts again at the next activity', () => {
    const recorder = createSessionRecorder()
    recorder.push(runFrame('heartbeat.run.queued', 0))
    recorder.push(notice(1000))
    recorder.clear()
    expect(recorder.frames()).toEqual([])
    expect(recorder.started()).toBe(false)
    expect(recorder.span()).toBe(0)
    expect(recorder.push(notice(2000))).toBe(false)
    expect(recorder.frames()).toEqual([])
    recorder.push(runFrame('heartbeat.run.status', 3000, { status: 'running' }))
    expect(timesOf(recorder)).toEqual([3000])
  })

  it('measures the span between the oldest and newest kept frame', () => {
    const recorder = createSessionRecorder()
    expect(recorder.span()).toBe(0)
    recorder.push(runFrame('heartbeat.run.queued', 0))
    expect(recorder.span()).toBe(0)
    recorder.push(notice(7000))
    expect(recorder.span()).toBe(7000)
  })
})

describe('recorderToReplay', () => {
  it('answers null when nothing was recorded', () => {
    const recorder = createSessionRecorder()
    expect(recorderToReplay(recorder, { agentsFile: AGENTS, treeFile: TREE })).toBeNull()
    expect(recorderToReplay(null, { agentsFile: AGENTS, treeFile: TREE })).toBeNull()
  })

  it('builds the replay prepare would build, with time from 0', () => {
    const recorder = createSessionRecorder()
    recorder.push(runFrame('heartbeat.run.queued', 0))
    recorder.push(runFrame('heartbeat.run.status', 1000, { status: 'running' }))
    recorder.push(runFrame('heartbeat.run.log', 2000, { ts: at(2000), seq: 1, stream: 'stdout', chunk: TOOL_LINE }))
    recorder.push(runFrame('heartbeat.run.status', 10000, { status: 'succeeded' }))

    const replay = recorderToReplay(recorder, { agentsFile: AGENTS, treeFile: TREE })
    expect(replay.agents.map((agent) => agent.key)).toEqual(['claude'])
    expect(replay.tree.rootName).toBe('agent-sandbox')
    expect(replay.frames).toHaveLength(4)
    expect(replay.frames.map((frame) => Date.parse(frame.createdAt))).toEqual([0, 1000, 2000, 10000])
    expect(replay.frames[0].createdAt).toBe('1970-01-01T00:00:00.000Z')
    expect(replay.frames[2].payload.ts).toBe('1970-01-01T00:00:02.000Z')
    expect(replay.activities[0].time).toBe(0)
    expect(replay.activities.map((activity) => activity.type)).toContain('tool.start')
    expect(replay.activities.find((activity) => activity.type === 'tool.start').time).toBe(2000)
    expect(Math.max(...replay.activities.map((activity) => activity.time))).toBe(10000)
  })

  it('leaves the frames the recorder keeps as they arrived', () => {
    const recorder = createSessionRecorder()
    recorder.push(runFrame('heartbeat.run.queued', 0))
    recorder.push(runFrame('heartbeat.run.log', 2000, { ts: at(2000), seq: 1, stream: 'stdout', chunk: TOOL_LINE }))
    const before = recorder.frames()[0]
    recorderToReplay(recorder, { agentsFile: AGENTS, treeFile: TREE })
    expect(recorder.frames()[0]).toBe(before)
    expect(recorder.frames()[0].createdAt).toBe(at(0))
  })
})
