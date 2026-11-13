import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { claudeProjectSlug, createClaudeSessionsReader } from '../server/claude-sessions.js'
import {
  COMPACT_AFTER,
  RECORD_BYTES_MAX,
  RECORD_FRAMES_MAX,
  RECORD_MINUTES_DEFAULT,
  RECORD_MINUTES_MAX,
  RECORD_MINUTES_MIN,
  clampRecordMinutes,
  createSessionRecorder,
  recorderToReplay,
} from '../src/model/sessionRecorder.js'
import { prepare } from '../src/model/source.js'
import { makeTempDir } from './helpers/tempRoot.js'

const BASE = Date.parse('2026-10-26T10:00:00.000Z')
const MINUTE = 60000
const TOOL_LINE = '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tool-1","name":"Read","input":{"file_path":"src/app.js"}}]}}\n'

const cleanups = []

afterEach(() => {
  while (cleanups.length > 0) {
    try {
      cleanups.pop()()
    } catch {}
  }
})

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

const SESSION_AGENTS = {
  projectRoot: 'app',
  agents: [{ id: 'agent-claude-session', key: 'claude-session', name: 'Claude Code session', parser: 'claude' }],
}
const SESSION_TREE = { root: 'app', files: ['src/a.js', 'src/b.js'], created: [] }

function sessionSetup() {
  const base = makeTempDir('mr-recorder-lifetimes-')
  cleanups.push(() => rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const projectRoot = join(base, 'work', 'app')
  const home = join(base, 'home')
  const runs = join(base, 'runs')
  const folder = join(home, '.claude', 'projects', claudeProjectSlug(projectRoot))
  mkdirSync(folder, { recursive: true })
  mkdirSync(runs, { recursive: true })
  return { projectRoot, home, runs, folder }
}

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
    expect(clampRecordMinutes(0)).toBe(RECORD_MINUTES_MIN)
    expect(clampRecordMinutes(-5)).toBe(RECORD_MINUTES_MIN)
    expect(clampRecordMinutes(0.5)).toBe(RECORD_MINUTES_MIN)
    expect(clampRecordMinutes(2.9)).toBe(2)
    expect(clampRecordMinutes(999)).toBe(RECORD_MINUTES_MAX)
    expect(clampRecordMinutes(1e6)).toBe(RECORD_MINUTES_MAX)
  })

  it('answers the default for anything that is not a number', () => {
    expect(clampRecordMinutes('abc')).toBe(RECORD_MINUTES_DEFAULT)
    expect(clampRecordMinutes('')).toBe(RECORD_MINUTES_DEFAULT)
    expect(clampRecordMinutes(null)).toBe(RECORD_MINUTES_DEFAULT)
    expect(clampRecordMinutes(undefined)).toBe(RECORD_MINUTES_DEFAULT)
    expect(clampRecordMinutes(NaN)).toBe(RECORD_MINUTES_DEFAULT)
    expect(clampRecordMinutes(Infinity)).toBe(RECORD_MINUTES_DEFAULT)
    expect(clampRecordMinutes(true)).toBe(RECORD_MINUTES_DEFAULT)
    expect(clampRecordMinutes({})).toBe(RECORD_MINUTES_DEFAULT)
    expect(clampRecordMinutes([])).toBe(RECORD_MINUTES_DEFAULT)
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

  it('keeps the longest window', () => {
    const recorder = createSessionRecorder({ minutes: RECORD_MINUTES_MAX })
    recorder.push(runFrame('heartbeat.run.queued', 0))
    recorder.push(notice(RECORD_MINUTES_MAX / 2 * MINUTE))
    recorder.push(notice(RECORD_MINUTES_MAX * MINUTE))
    expect(timesOf(recorder)).toHaveLength(3)
    recorder.push(notice(RECORD_MINUTES_MAX * MINUTE + 1))
    expect(timesOf(recorder)).toEqual([RECORD_MINUTES_MAX / 2 * MINUTE, RECORD_MINUTES_MAX * MINUTE, RECORD_MINUTES_MAX * MINUTE + 1])
    expect(recorder.minutes()).toBe(RECORD_MINUTES_MAX)
  })

  it('clamps the minutes it is given', () => {
    expect(createSessionRecorder({ minutes: 0 }).minutes()).toBe(RECORD_MINUTES_MIN)
    expect(createSessionRecorder({ minutes: 500 }).minutes()).toBe(RECORD_MINUTES_MAX)
    expect(createSessionRecorder({ minutes: 'abc' }).minutes()).toBe(RECORD_MINUTES_DEFAULT)
    expect(createSessionRecorder().minutes()).toBe(RECORD_MINUTES_DEFAULT)
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
    expect(recorder.minutes()).toBe(RECORD_MINUTES_MAX)
    recorder.setMinutes('abc')
    expect(recorder.minutes()).toBe(RECORD_MINUTES_DEFAULT)
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

  it('drops old frames with a head and compacts the list in chunks', () => {
    const recorder = createSessionRecorder({ minutes: 1 })
    recorder.push(runFrame('heartbeat.run.queued', 0))
    for (let index = 1; index <= 4000; index += 1) recorder.push(notice(index * 1000))
    const kept = recorder.stats().kept
    expect(kept).toBe(61)
    expect(recorder.frames()).toHaveLength(61)
    expect(recorder.frames()[0].createdAt).toBe(at(3940 * 1000))
    expect(recorder.stats().slots).toBeLessThanOrEqual(kept + COMPACT_AFTER)
    expect(timesOf(recorder)[0]).toBe(3940 * 1000)
  })

  it('keeps an out of order frame that falls inside the window after a trim', () => {
    const recorder = createSessionRecorder({ minutes: 1 })
    recorder.push(runFrame('heartbeat.run.queued', 0))
    for (let index = 1; index <= 9; index += 1) recorder.push(notice(index * 10000))
    expect(timesOf(recorder)).toEqual([30000, 40000, 50000, 60000, 70000, 80000, 90000])
    recorder.push(notice(45000))
    expect(timesOf(recorder)).toEqual([30000, 40000, 45000, 50000, 60000, 70000, 80000, 90000])
    expect(recorder.stats().kept).toBe(8)
  })

  it('resets the head when it clears', () => {
    const recorder = createSessionRecorder({ minutes: 1 })
    recorder.push(runFrame('heartbeat.run.queued', 0))
    for (let index = 1; index <= 2000; index += 1) recorder.push(notice(index * 1000))
    recorder.clear()
    expect(recorder.stats()).toEqual({ kept: 0, slots: 0, held: 0 })
    recorder.push(runFrame('heartbeat.run.status', 5000, { status: 'running' }))
    expect(timesOf(recorder)).toEqual([5000])
  })

  it('keeps 20000 frames at one timestamp and marks the replay truncated', () => {
    const recorder = createSessionRecorder()
    const pushed = []
    const first = runFrame('heartbeat.run.queued', 0)
    pushed.push(first)
    recorder.push(first)
    for (let index = 0; index < 30000; index += 1) {
      const frame = notice(0)
      pushed.push(frame)
      recorder.push(frame)
    }
    expect(recorder.frames()).toHaveLength(RECORD_FRAMES_MAX)
    expect(recorder.frames()[0]).toBe(pushed[pushed.length - RECORD_FRAMES_MAX])
    expect(recorder.stats().kept).toBe(RECORD_FRAMES_MAX)
    expect(recorder.size()).toBeLessThanOrEqual(RECORD_BYTES_MAX)
    expect(recorder.truncated()).toBe(true)
    const replay = recorderToReplay(recorder, { agentsFile: AGENTS, treeFile: TREE })
    expect(replay.frames).toHaveLength(RECORD_FRAMES_MAX)
    expect(replay.truncated).toBe(true)
  })

  it('keeps the kept payload text under the ceiling when one frame is oversized', () => {
    const recorder = createSessionRecorder()
    const big = (ms, chars) => runFrame('heartbeat.run.log', ms, { chunk: 'x'.repeat(chars) })
    recorder.push(runFrame('heartbeat.run.queued', 0))
    for (let index = 0; index < 4; index += 1) recorder.push(big(1000 + index, 6 * 1024 * 1024))
    expect(recorder.frames()).toHaveLength(3)
    const keptSize = recorder.size()
    expect(keptSize).toBeLessThanOrEqual(RECORD_BYTES_MAX)
    recorder.push(big(2000, RECORD_BYTES_MAX + 1))
    expect(recorder.frames()).toHaveLength(3)
    expect(recorder.size()).toBe(keptSize)
    expect(recorder.size()).toBeLessThanOrEqual(RECORD_BYTES_MAX)
    expect(recorder.truncated()).toBe(true)
    const replay = recorderToReplay(recorder, { agentsFile: AGENTS, treeFile: TREE })
    expect(replay.truncated).toBe(true)
  })

  it('lets go of a dropped frame instead of keeping it in its slot', () => {
    const MIB = 1024 * 1024
    const recorder = createSessionRecorder()
    const chunk = 'x'.repeat(MIB)
    const pushed = []
    for (let index = 0; index < 60; index += 1) {
      const frame = runFrame('heartbeat.run.log', index, { chunk })
      pushed.push(frame)
      recorder.push(frame)
    }
    const stats = recorder.stats()
    expect(stats.kept).toBe(19)
    expect(stats.slots).toBe(60)
    expect(stats.slots - stats.kept).toBeGreaterThan(0)
    expect(stats.held).toBe(stats.kept)
    expect(recorder.size()).toBeLessThanOrEqual(RECORD_BYTES_MAX)
    expect(recorder.size() + MIB).toBeGreaterThan(RECORD_BYTES_MAX)
    expect(recorder.frames()).toHaveLength(stats.kept)
    expect(recorder.frames()).not.toContain(pushed[0])
    expect(recorder.frames()[0]).toBe(pushed[60 - stats.kept])
    expect(recorder.truncated()).toBe(true)
    const replay = recorderToReplay(recorder, { agentsFile: AGENTS, treeFile: TREE })
    expect(replay.frames).toHaveLength(stats.kept)
    expect(replay.truncated).toBe(true)
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

  it('does not mark a normal feed truncated', () => {
    const recorder = createSessionRecorder()
    recorder.push(runFrame('heartbeat.run.queued', 0))
    for (let index = 1; index <= 50; index += 1) recorder.push(notice(index * 1000))
    expect(recorder.truncated()).toBe(false)
    const replay = recorderToReplay(recorder, { agentsFile: AGENTS, treeFile: TREE })
    expect(replay.truncated).toBe(false)
    expect(replay.frames).toHaveLength(51)
  })
})

describe('replay across reader lifetimes', () => {
  it('gives two tool calls when one recorder keeps six frames from two reader lifetimes', () => {
    const { projectRoot, home, runs, folder } = sessionSetup()
    let clock = BASE
    const now = () => (clock += 1000)
    const file = join(folder, 'sess-1.jsonl')
    writeFileSync(file, '')
    const recorder = createSessionRecorder()

    function jsonLines(items) {
      return items.map((item) => `${JSON.stringify(item)}\n`).join('')
    }

    function line(type, content) {
      return { type, message: { role: type, content }, cwd: projectRoot, sessionId: 'sess-1', timestamp: new Date(clock).toISOString() }
    }

    function readTool(id, path) {
      return { type: 'tool_use', id, name: 'Read', input: { file_path: path } }
    }

    function readTurn(id) {
      const frames = []
      const reader = createClaudeSessionsReader({
        projectRoot,
        home,
        runsFolder: runs,
        now,
        emit: (frame) => {
          frames.push(frame)
          recorder.push(frame)
        },
      })
      cleanups.push(() => reader.stop())
      reader.tick()
      appendFileSync(file, jsonLines([
        line('user', 'Go.'),
        line('assistant', [readTool(id, join(projectRoot, 'src', `${id}.js`))]),
      ]))
      reader.tick()
      return frames
    }

    expect(readTurn('a')).toHaveLength(3)
    expect(readTurn('b')).toHaveLength(3)
    expect(recorder.frames()).toHaveLength(6)

    const replay = recorderToReplay(recorder, { agentsFile: SESSION_AGENTS, treeFile: SESSION_TREE })
    const prepared = prepare({ frames: replay.frames, agentsFile: SESSION_AGENTS, treeFile: SESSION_TREE })
    expect(prepared.activities.filter((activity) => activity.type === 'tool.start')).toHaveLength(2)

    const runIds = new Set(recorder.frames().map((frame) => frame.payload.runId))
    expect(runIds.size).toBe(2)
  })
})
