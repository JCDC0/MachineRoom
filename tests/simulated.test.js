import { describe, expect, it } from 'vitest'
import { createPipeline } from '../src/model/pipeline.js'
import { createLivePlayer } from '../src/live/livePlayer.js'
import { openSimulated, simulatedSpeed } from '../src/live/simulated.js'
import { makeTree } from '../src/model/paths.js'
import { loadRecording } from './helpers.js'

const recording = loadRecording()

function harness(frames, options = {}) {
  const timers = []
  const statuses = []
  const seen = []
  const link = openSimulated({
    frames,
    onFrame: (frame) => seen.push(frame),
    onStatus: (status) => statuses.push(status),
    setTimer: (fn, ms) => {
      timers.push({ fn, ms })
      return timers.length
    },
    clearTimer: () => {},
    ...options,
  })
  const run = () => {
    let guard = 0
    while (timers.length > 0 && guard++ < 5000) timers.shift().fn()
  }
  return { timers, statuses, seen, link, run }
}

const frame = (at) => ({ type: 'x', createdAt: new Date(at).toISOString(), payload: {} })

describe('simulatedSpeed', () => {
  it('keeps a speed inside the range', () => {
    expect(simulatedSpeed('3')).toBe(3)
  })

  it('answers 1 for a speed that is not a finite number above 0', () => {
    expect(simulatedSpeed('0')).toBe(1)
    expect(simulatedSpeed('-2')).toBe(1)
    expect(simulatedSpeed('abc')).toBe(1)
    expect(simulatedSpeed('')).toBe(1)
    expect(simulatedSpeed(null)).toBe(1)
  })

  it('clamps a tiny speed up to a quarter', () => {
    expect(simulatedSpeed('1e-300')).toBe(0.25)
  })

  it('clamps a huge speed down to 64', () => {
    expect(simulatedSpeed('1e9')).toBe(64)
  })
})

describe('openSimulated', () => {
  it('starts with a short delay and then sends every frame in order', () => {
    const frames = [frame(0), frame(100), frame(200)]
    const { timers, statuses, seen, run } = harness(frames)
    expect(statuses).toEqual(['connecting'])
    expect(timers[0].ms).toBe(400)
    run()
    expect(seen).toEqual(frames)
    expect(statuses).toEqual(['connecting', 'live', 'finished'])
  })

  it('keeps short gaps and caps long ones', () => {
    const { timers, run } = harness([frame(0), frame(300), frame(60000)])
    timers.shift().fn()
    expect(timers.map((t) => t.ms)).toEqual([300])
    timers.shift().fn()
    expect(timers.map((t) => t.ms)).toEqual([2500])
    run()
  })

  it('divides the gaps by the speed', () => {
    const { timers } = harness([frame(0), frame(1000)], { speed: 4 })
    timers.shift().fn()
    expect(timers[0].ms).toBe(250)
  })

  it('stops sending after it is closed', () => {
    const { timers, seen, link } = harness([frame(0), frame(10), frame(20)])
    timers.shift().fn()
    link.close()
    timers.shift()?.fn()
    expect(seen).toHaveLength(1)
  })

  it('finishes at once when there are no frames', () => {
    const { timers, statuses } = harness([])
    timers.shift().fn()
    expect(statuses).toEqual(['connecting', 'finished'])
  })
})

describe('the recording played as a live feed', () => {
  it('grows an empty room and ends with every agent finished', () => {
    const tree = makeTree({ root: 'agent-sandbox', files: [], created: [] })
    const player = createLivePlayer({ tree, agents: recording.agents })
    const pipeline = createPipeline({ agents: recording.agents, tree })
    const { run } = harness(recording.frames, {
      onFrame: (f) => {
        player.push(pipeline.push(f))
        pipeline.learn([...player.state.files.keys()])
      },
    })
    run()
    expect(player.state.files.size).toBeGreaterThan(3)
    for (const agent of recording.agents) expect(player.state.agents.get(agent.key).status).toBe('done')
  })
})
