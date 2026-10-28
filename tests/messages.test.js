import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  MESSAGE_DURATION,
  MESSAGE_GAP,
  MESSAGE_LIFE,
  MESSAGE_PACKETS,
  MESSAGE_POOL,
  MESSAGE_SIZE,
  createMessages,
  messageColor,
  messageSpots,
} from '../src/engine/messages.js'
import { WHITE, YELLOW } from '../src/engine/sprites.js'

const from = { x: 0, y: 120, z: 300 }
const to = { x: 600, y: 120, z: -100 }

function harness({ reduced = false } = {}) {
  const scene = new THREE.Scene()
  const views = new Map([
    ['orchestrator', new THREE.Vector3(0, 120, 300)],
    ['sub-ui', new THREE.Vector3(600, 120, -100)],
  ])
  let now = 1000
  let isReduced = reduced
  const messages = createMessages(scene, {
    viewOf: (key) => views.get(key) ?? null,
    reduced: () => isReduced,
    clock: () => now,
  })
  return {
    scene,
    views,
    messages,
    setNow: (value) => { now = value },
    setReduced: (value) => { isReduced = value },
  }
}

function drawn(messages) {
  const array = messages.points.geometry.attributes.position.array
  const count = messages.points.geometry.drawRange.count
  const points = []
  for (let index = 0; index < count; index += 1) {
    points.push({ x: array[index * 3], y: array[index * 3 + 1], z: array[index * 3 + 2] })
  }
  return points
}

function tint(messages, index) {
  const array = messages.points.geometry.attributes.color.array
  return { r: array[index * 3], g: array[index * 3 + 1], b: array[index * 3 + 2] }
}

describe('messageSpots', () => {
  const started = 1000

  it('starts one packet at the first view', () => {
    expect(messageSpots(from, to, started, started)).toEqual([from])
  })

  it('flies six packets a gap apart over the line', () => {
    const spots = messageSpots(from, to, started, started + 300)
    expect(spots).toHaveLength(MESSAGE_PACKETS)
    expect(spots[0]).toEqual({ x: 300, y: 120, z: 100 })
    expect(spots[1].x).toBeCloseTo(240, 6)
    expect(spots[5]).toEqual(from)
    expect(messageSpots(from, to, started, started + 60)).toHaveLength(2)
  })

  it('lands the last packet on the other view and sends nothing after it', () => {
    const end = started + (MESSAGE_PACKETS - 1) * MESSAGE_GAP + MESSAGE_DURATION
    expect(end).toBe(MESSAGE_LIFE + started)
    expect(messageSpots(from, to, started, end)).toEqual([to])
    expect(messageSpots(from, to, started, end + 1)).toEqual([])
  })

  it('sends nothing before the first packet', () => {
    expect(messageSpots(from, to, started, started - 1)).toEqual([])
  })

  it('writes into the list it is given and drops stale spots', () => {
    const out = [{ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }]
    const spots = messageSpots(from, to, started, started + 300, out)
    expect(spots).toBe(out)
    expect(spots[0]).toEqual({ x: 300, y: 120, z: 100 })
    const first = spots[0]
    messageSpots(from, to, started, started, out)
    expect(out).toHaveLength(1)
    expect(out[0]).toBe(first)
  })

  it('sends nothing from a missing or broken view', () => {
    expect(messageSpots(null, to, started, started + 300)).toEqual([])
    expect(messageSpots(from, null, started, started + 300)).toEqual([])
    expect(messageSpots({ x: 'a', y: 0, z: 0 }, to, started, started + 300)).toEqual([])
    expect(messageSpots(from, to, 'soon', started)).toEqual([])
    expect(messageSpots(from, to, started, 'now')).toEqual([])
  })
})

describe('messageColor', () => {
  it('keeps dispatches yellow and every other message white', () => {
    expect(messageColor('dispatch')).toBe(YELLOW)
    expect(messageColor('order')).toBe(WHITE)
    expect(messageColor('report')).toBe(WHITE)
    expect(messageColor('wake')).toBe(WHITE)
    expect(messageColor('')).toBe(WHITE)
  })
})

describe('the room packets', () => {
  it('shows six 3 pixel points from one agent to another', () => {
    const { messages, setNow } = harness()
    expect(MESSAGE_SIZE).toBe(3)
    expect(MESSAGE_PACKETS).toBe(6)
    expect(MESSAGE_DURATION).toBe(600)
    expect(MESSAGE_GAP).toBe(60)
    expect(messages.points.geometry.attributes.position.array).toHaveLength(MESSAGE_POOL * 3)
    expect(messages.points.material.size).toBe(3)
    expect(messages.points.material.sizeAttenuation).toBe(false)

    expect(messages.note({ type: 'agent.message', agent: 'orchestrator', to: 'sub-ui', kind: 'order' })).toBe(true)
    setNow(1000)
    messages.update(1000)
    expect(drawn(messages)).toEqual([from])

    setNow(1300)
    messages.update(1300)
    const spots = drawn(messages)
    expect(spots).toHaveLength(MESSAGE_PACKETS)
    expect(spots[0]).toEqual({ x: 300, y: 120, z: 100 })
    expect(spots[5]).toEqual(from)
  })

  it('paints an order white and a dispatch yellow from one pool', () => {
    const { messages, setNow } = harness()
    messages.note({ type: 'agent.message', agent: 'orchestrator', to: 'sub-ui', kind: 'order' })
    setNow(1300)
    messages.update(1300)
    const white = new THREE.Color(WHITE)
    for (let index = 0; index < MESSAGE_PACKETS; index += 1) {
      const color = tint(messages, index)
      expect(color.r).toBeCloseTo(white.r, 5)
      expect(color.g).toBeCloseTo(white.g, 5)
      expect(color.b).toBeCloseTo(white.b, 5)
    }

    messages.note({ type: 'agent.message', agent: 'orchestrator', to: 'sub-ui', kind: 'dispatch' })
    setNow(1800)
    messages.update(1800)
    const yellow = new THREE.Color(YELLOW)
    const count = messages.points.geometry.drawRange.count
    expect(count).toBeGreaterThan(MESSAGE_PACKETS)
    const first = tint(messages, 0)
    expect(first.r).toBeCloseTo(yellow.r, 5)
    expect(first.g).toBeCloseTo(yellow.g, 5)
    expect(first.b).toBeCloseTo(yellow.b, 5)
  })

  it('sends nothing when either view is missing', () => {
    const { messages, views, setNow } = harness()
    expect(messages.note({ type: 'agent.message', agent: 'gone', to: 'sub-ui', kind: 'order' })).toBe(false)
    expect(messages.note({ type: 'agent.message', agent: 'orchestrator', to: 'gone', kind: 'order' })).toBe(false)
    expect(messages.note({ type: 'agent.message', agent: 'orchestrator', kind: 'order' })).toBe(false)
    expect(messages.note({ type: 'run.start', agent: 'orchestrator' })).toBe(false)
    views.delete('sub-ui')
    expect(messages.note({ type: 'agent.message', agent: 'orchestrator', to: 'sub-ui', kind: 'order' })).toBe(false)
    setNow(1300)
    messages.update(1300)
    expect(messages.points.visible).toBe(false)
    expect(messages.points.geometry.drawRange.count).toBe(0)
  })

  it('sends nothing under reduced motion and clears packets already in flight', () => {
    const { messages, setNow } = harness({ reduced: true })
    expect(messages.note({ type: 'agent.message', agent: 'orchestrator', to: 'sub-ui', kind: 'order' })).toBe(false)
    setNow(1300)
    messages.update(1300)
    expect(messages.points.visible).toBe(false)

    const moving = harness()
    moving.messages.note({ type: 'agent.message', agent: 'orchestrator', to: 'sub-ui', kind: 'order' })
    moving.setNow(1300)
    moving.messages.update(1300)
    expect(moving.messages.points.geometry.drawRange.count).toBe(MESSAGE_PACKETS)
    moving.setReduced(true)
    moving.messages.update(1400)
    expect(moving.messages.points.geometry.drawRange.count).toBe(0)
    expect(moving.messages.points.visible).toBe(false)
  })

  it('keeps the pool at 48 points when many messages cross at once', () => {
    const { messages, setNow } = harness()
    for (let index = 0; index < 10; index += 1) {
      messages.note({ type: 'agent.message', agent: 'orchestrator', to: 'sub-ui', kind: 'order' })
    }
    setNow(1300)
    messages.update(1300)
    expect(messages.points.geometry.drawRange.count).toBe(MESSAGE_POOL)
  })

  it('goes away with the room', () => {
    const { scene, messages } = harness()
    const points = messages.points
    expect(scene.children).toContain(points)
    messages.dispose()
    expect(scene.children).not.toContain(points)
    expect(points.parent).toBe(null)
  })
})
