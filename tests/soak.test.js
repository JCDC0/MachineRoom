import { afterEach, describe, expect, it, vi } from 'vitest'
import { viewInput } from '../src/engine/cards.js'
import { createLivePlayer } from '../src/live/livePlayer.js'
import { openSimulated } from '../src/live/simulated.js'
import { planFolderView } from '../src/model/folderView.js'
import { LIVE_LOG_LIMIT, appendLiveLog, createLogger } from '../src/model/log.js'
import { makeTree } from '../src/model/paths.js'
import { SEEN_LIMIT, createPipeline } from '../src/model/pipeline.js'
import { CALL_LIMIT, RECENT_LIMIT } from '../src/model/state.js'
import { loadRecording } from './helpers.js'
import { readFrames, startLoop, waitFor, waitForPaperclip } from './helpers/loop.js'

const COPIES = 18
const LINE_LIMIT = 80
const HISTORY_LIMIT = 500
const recording = loadRecording()

function runIds(frames) {
  const ids = new Set()
  for (const frame of frames) if (frame.payload?.runId) ids.add(frame.payload.runId)
  return ids
}

function shifted(value, offsetMs) {
  const at = Date.parse(value)
  return Number.isFinite(at) ? new Date(at + offsetMs).toISOString() : value
}

function repeatRecording(frames, copies) {
  const times = frames.map((frame) => Date.parse(frame.createdAt))
  const spanMs = Math.max(...times) - Math.min(...times) + 1000
  const out = []
  for (let copy = 0; copy < copies; copy += 1) {
    const offsetMs = copy * spanMs
    for (const frame of frames) {
      const payload = { ...frame.payload }
      if (payload.runId) payload.runId = `${payload.runId}-${copy}`
      if (typeof payload.ts === 'string') payload.ts = shifted(payload.ts, offsetMs)
      out.push({ ...frame, id: out.length + 1, createdAt: shifted(frame.createdAt, offsetMs), payload })
    }
  }
  return out
}

const frames = repeatRecording(recording.frames, COPIES)
const runsPerCopy = runIds(recording.frames).size

afterEach(() => {
  vi.useRealTimers()
})

describe('a long live session', () => {
  it(`keeps the live log, the room state and the folder plan bounded over ${COPIES * runsPerCopy} runs`, () => {
    vi.useFakeTimers()
    const agents = recording.agents
    const tree = makeTree({ root: 'agent-sandbox', files: [], created: [] })
    const player = createLivePlayer({ tree, agents })
    const pipeline = createPipeline({ agents, tree })
    const entryFor = createLogger(agents)
    const statuses = []
    const samples = []
    let log = []
    let ends = 0
    let known = 0

    function sample() {
      const state = player.state
      const roster = [...state.agents.values()]
      return {
        ends,
        log: log.length,
        files: state.files.size,
        dirs: state.dirs.size,
        recent: state.recent.length,
        recentAt: state.recentAt.size,
        lines: Math.max(...roster.map((agent) => agent.lines.length)),
        calls: Math.max(...roster.map((agent) => agent.calls.size)),
        seen: pipeline.remembered().keys,
        openRuns: pipeline.remembered().runs,
        plan: planFolderView(viewInput(state)),
      }
    }

    openSimulated({
      frames,
      speed: 50,
      onStatus: (status) => statuses.push(status),
      onFrame: (frame) => {
        const activities = pipeline.push(frame)
        player.push(activities)
        if (player.state.files.size !== known) {
          known = player.state.files.size
          pipeline.learn([...player.state.files.keys()])
        }
        log = appendLiveLog(log, activities.map(entryFor).filter(Boolean))
        for (const activity of activities) {
          if (activity.type !== 'run.end') continue
          ends += 1
          if (ends % runsPerCopy === 0) samples.push(sample())
        }
      },
    })
    for (let guard = 0; guard < 1000 && !statuses.includes('finished'); guard += 1) vi.advanceTimersByTime(10000)

    expect(statuses.at(-1)).toBe('finished')
    expect(ends).toBe(COPIES * runsPerCopy)
    expect(ends).toBeGreaterThanOrEqual(200)
    expect(samples).toHaveLength(COPIES)
    const first = samples[0]
    const last = samples.at(-1)
    for (const entry of samples) {
      expect(entry.log).toBeLessThanOrEqual(LIVE_LOG_LIMIT)
      expect(entry.lines).toBeLessThanOrEqual(LINE_LIMIT)
      expect(entry.calls).toBeLessThanOrEqual(CALL_LIMIT)
      expect(entry.recent).toBeLessThanOrEqual(RECENT_LIMIT)
      expect(entry.recentAt).toBeLessThanOrEqual(RECENT_LIMIT)
      expect(entry.seen).toBeLessThanOrEqual(SEEN_LIMIT)
      expect(entry.openRuns).toBeLessThanOrEqual(agents.length)
      expect(entry.files).toBe(first.files)
      expect(entry.dirs).toBe(first.dirs)
      expect(entry.plan.length).toBeLessThanOrEqual(entry.dirs + entry.files)
      for (const view of entry.plan) {
        expect(view.folders.length).toBeLessThanOrEqual(3)
        expect(view.back).toBeLessThanOrEqual(3)
        expect(view.items.length).toBeLessThanOrEqual(10)
      }
    }
    expect(log).toHaveLength(LIVE_LOG_LIMIT)
    expect(last.lines).toBe(LINE_LIMIT)
    expect(last.seen).toBe(SEEN_LIMIT)
    expect(first.files).toBeGreaterThan(3)
  })

  it('keeps the last 500 frames in the bridge history however many runs pass', async () => {
    const loop = await startLoop({ bridge: { logRetries: 1, logRetryMs: 1 } })
    try {
      await waitForPaperclip(loop.url)
      await waitFor(() => loop.fake.connected() > 0, { what: 'the bridge socket' })
      const lastId = frames.length
      let open
      const opened = new Promise((resolveOpen) => {
        open = resolveOpen
      })
      const live = readFrames(loop.url, (seen) => seen.at(-1)?.id === lastId, { timeoutMs: 60000, history: false, onOpen: open })
      await opened
      for (const frame of frames) loop.fake.sendFrame(frame)
      const streamed = await live
      expect(streamed).toHaveLength(frames.length)

      const kept = await readFrames(loop.url, (seen) => seen.at(-1)?.id === lastId)
      expect(kept).toHaveLength(HISTORY_LIMIT)
      expect(kept[0].id).toBe(lastId - HISTORY_LIMIT + 1)
      expect(runIds(frames).size).toBeGreaterThanOrEqual(200)
    } finally {
      await loop.stop()
    }
  }, 90000)
})
