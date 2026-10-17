import { describe, expect, it } from 'vitest'
import { buildTimeline, createLogger, entriesUpTo } from '../src/model/log.js'
import { createPlayer } from '../src/model/player.js'
import { loadRecording } from './helpers.js'

const recording = loadRecording()
const { activities, agents, tree } = recording
const player = createPlayer({ activities, tree, agents })
const timeline = buildTimeline(activities, player.stamps, agents)

describe('createLogger', () => {
  const entryFor = createLogger([{ key: 'claude', name: 'Claude Code' }])
  const base = { agent: 'claude', runId: 'abcd1234' }

  it('names the agent and keeps the terminal wording', () => {
    expect(entryFor({ ...base, type: 'tool.start', id: 'a', label: 'read src/math.js' })).toEqual({
      agent: 'Claude Code',
      text: 'read src/math.js',
      tone: 'normal',
    })
  })

  it('stays quiet for a call that ended well', () => {
    expect(entryFor({ ...base, type: 'tool.end', id: 'a', ok: true })).toBeNull()
  })

  it('names the call that failed', () => {
    entryFor({ ...base, type: 'tool.start', id: 'b', label: 'npm test' })
    expect(entryFor({ ...base, type: 'tool.end', id: 'b', ok: false })).toMatchObject({ text: 'failed npm test', tone: 'error' })
  })

  it('marks finished and failed runs', () => {
    expect(entryFor({ ...base, type: 'run.end', ok: true })).toMatchObject({ text: 'finished', tone: 'done' })
    expect(entryFor({ ...base, type: 'run.end', ok: false, error: 'spawn failed' })).toMatchObject({
      text: 'failed spawn failed',
      tone: 'error',
    })
  })

  it('ignores activity types it does not know', () => {
    expect(entryFor({ ...base, type: 'something.else' })).toBeNull()
  })
})

describe('buildTimeline', () => {
  it('puts one start marker on every run and one end marker on every finished run', () => {
    const starts = activities.filter((activity) => activity.type === 'run.start').length
    const ends = activities.filter((activity) => activity.type === 'run.end').length
    expect(timeline.markers.filter((marker) => marker.tone === 'start')).toHaveLength(starts)
    expect(timeline.markers.filter((marker) => marker.tone !== 'start')).toHaveLength(ends)
  })

  it('keeps every marker and entry inside the replay', () => {
    for (const item of [...timeline.markers, ...timeline.entries]) {
      expect(item.at).toBeGreaterThanOrEqual(0)
      expect(item.at).toBeLessThanOrEqual(player.duration)
    }
  })

  it('lists entries in replay order', () => {
    const times = timeline.entries.map((entry) => entry.at)
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })
})

describe('entriesUpTo', () => {
  it('shows nothing before the first entry', () => {
    expect(entriesUpTo(timeline.entries, -1)).toEqual([])
  })

  it('shows only what has happened by the position', () => {
    const middle = player.duration / 2
    const shown = entriesUpTo(timeline.entries, middle)
    expect(shown.length).toBeGreaterThan(0)
    expect(shown.every((entry) => entry.at <= middle)).toBe(true)
  })

  it('keeps the newest entries when there are more than the limit', () => {
    const shown = entriesUpTo(timeline.entries, player.duration, 5)
    expect(shown).toEqual(timeline.entries.slice(-5))
  })
})
