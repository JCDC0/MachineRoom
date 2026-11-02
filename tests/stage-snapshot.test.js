import { act, createElement, useState } from 'react'
import { describe, expect, it } from 'vitest'
import { sameSnapshot, snapshotSink } from '../src/Stage.jsx'
import { withDom } from './helpers/uiDom.js'

function agent(over = {}) {
  return {
    key: 'opencode',
    name: 'OpenCode',
    id: 'a1',
    harness: 'opencode',
    model: 'deepseek',
    status: 'idle',
    label: 'OpenCode',
    runs: 0,
    parent: null,
    depth: 0,
    ...over,
  }
}

function snapshot(over = {}) {
  return {
    position: 0,
    duration: 10,
    playing: false,
    speed: 1,
    agents: [agent()],
    ...over,
  }
}

function fakePlayer(start = snapshot()) {
  let current = start
  return {
    snapshot: () => current,
    set(next) {
      current = next
    },
  }
}

function Harness({ player, renders, publishRef }) {
  const [state, setState] = useState(() => player.snapshot())
  publishRef.current = snapshotSink(player, setState, state)
  renders.count += 1
  return createElement('p', null, `${state.position}:${state.agents.length}`)
}

describe('the snapshot sink', () => {
  it('commits nothing while the snapshot stays the same', async () => {
    const player = fakePlayer()
    const renders = { count: 0 }
    const publishRef = { current: null }
    await withDom(async ({ root }) => {
      await act(async () => {
        root.render(createElement(Harness, { player, renders, publishRef }))
      })
      expect(renders.count).toBe(1)
      await act(async () => {
        for (let index = 0; index < 8; index += 1) publishRef.current()
      })
      expect(renders.count).toBe(1)
      player.set(snapshot())
      await act(async () => {
        for (let index = 0; index < 8; index += 1) publishRef.current()
      })
      expect(renders.count).toBe(1)
    })
  })

  it('commits when the clock moves', async () => {
    const player = fakePlayer()
    const renders = { count: 0 }
    const publishRef = { current: null }
    await withDom(async ({ root }) => {
      await act(async () => {
        root.render(createElement(Harness, { player, renders, publishRef }))
      })
      player.set(snapshot({ position: 120 }))
      await act(async () => publishRef.current())
      expect(renders.count).toBe(2)
    })
  })

  it('commits when an agent changes status', async () => {
    const player = fakePlayer()
    const renders = { count: 0 }
    const publishRef = { current: null }
    await withDom(async ({ root }) => {
      await act(async () => {
        root.render(createElement(Harness, { player, renders, publishRef }))
      })
      player.set(snapshot({ agents: [agent({ status: 'working' })] }))
      await act(async () => publishRef.current())
      expect(renders.count).toBe(2)
    })
  })
})

describe('sameSnapshot', () => {
  it('treats a new object with the same fields as unchanged', () => {
    expect(sameSnapshot(snapshot(), snapshot())).toBe(true)
    expect(sameSnapshot(snapshot(), snapshot({ agents: [agent()] }))).toBe(true)
  })

  it('sees a changed position, status, name, harness and a new agent', () => {
    expect(sameSnapshot(snapshot(), snapshot({ position: 1 }))).toBe(false)
    expect(sameSnapshot(snapshot(), snapshot({ agents: [agent({ status: 'working' })] }))).toBe(false)
    expect(sameSnapshot(snapshot(), snapshot({ agents: [agent({ name: 'Other' })] }))).toBe(false)
    expect(sameSnapshot(snapshot(), snapshot({ agents: [agent({ harness: 'claude' })] }))).toBe(false)
    expect(sameSnapshot(snapshot(), snapshot({ agents: [] }))).toBe(false)
  })

  it('sees a live status and a changed duration or speed', () => {
    expect(sameSnapshot(snapshot({ live: true, status: 'live' }), snapshot({ live: true, status: 'reconnecting' }))).toBe(false)
    expect(sameSnapshot(snapshot(), snapshot({ duration: 11 }))).toBe(false)
    expect(sameSnapshot(snapshot(), snapshot({ speed: 2 }))).toBe(false)
    expect(sameSnapshot(snapshot(), snapshot({ playing: true }))).toBe(false)
  })

  it('compares a live clock at the second it shows', () => {
    const start = snapshot({ live: true, position: 10_000, duration: 10_000 })
    expect(sameSnapshot(start, snapshot({ live: true, position: 10_120, duration: 10_120 }))).toBe(true)
    expect(sameSnapshot(start, snapshot({ live: true, position: 11_000, duration: 11_000 }))).toBe(false)
    expect(sameSnapshot(snapshot({ position: 10_000 }), snapshot({ position: 10_120 }))).toBe(false)
  })

  it('handles a missing or empty snapshot', () => {
    expect(sameSnapshot(null, null)).toBe(true)
    expect(sameSnapshot(null, snapshot())).toBe(false)
    expect(sameSnapshot(snapshot(), null)).toBe(false)
    expect(sameSnapshot({}, {})).toBe(true)
  })
})
