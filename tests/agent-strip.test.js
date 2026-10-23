import { describe, expect, it } from 'vitest'
import { PACKET_DURATION, PACKET_POOL, packetSpots, stripPoints } from '../src/engine/agents.js'

const from = { x: 0, y: 290, z: 300 }
const to = { x: 620, y: 460, z: -80 }

describe('stripPoints', () => {
  it('gives one straight segment from the agent to the target', () => {
    const points = stripPoints(from, to)
    expect(points).toHaveLength(2)
    expect(points[0]).toEqual(from)
    expect(points[1]).toEqual(to)
  })

  it('returns copies, not its inputs', () => {
    const points = stripPoints(from, to)
    expect(points[0]).not.toBe(from)
    expect(points[1]).not.toBe(to)
  })

  it('gives the same points every time and leaves its inputs alone', () => {
    const first = stripPoints(from, to)
    const second = stripPoints(from, to)
    expect(second).toEqual(first)
    expect(from).toEqual({ x: 0, y: 290, z: 300 })
    expect(to).toEqual({ x: 620, y: 460, z: -80 })
  })
})

describe('packetSpots', () => {
  it('moves a packet from the agent to the file in 0.45 seconds', () => {
    const sends = [1000]
    expect(packetSpots(1000, sends, PACKET_DURATION)).toEqual([0])
    expect(packetSpots(1200, sends, PACKET_DURATION)[0]).toBeCloseTo(0.2 / 0.45, 10)
    expect(packetSpots(1450, sends, PACKET_DURATION)).toEqual([1])
    expect(packetSpots(1451, sends, PACKET_DURATION)).toEqual([])
  })

  it('keeps a burst of five packets in flight together', () => {
    const sends = [2000, 2000, 2000, 2000, 2000]
    const spots = packetSpots(2090, sends, PACKET_DURATION)
    expect(spots).toHaveLength(5)
    spots.forEach((spot) => expect(spot).toBeCloseTo(0.09 / 0.45, 10))
  })

  it('caps the pool at 24 and keeps the newest packets', () => {
    const sends = Array.from({ length: 30 }, (_, index) => index * 10)
    const spots = packetSpots(290, sends, PACKET_DURATION)
    expect(spots).toHaveLength(PACKET_POOL)
    expect(spots[0]).toBeCloseTo(0.23 / 0.45, 10)
    expect(spots[PACKET_POOL - 1]).toBe(0)
  })

  it('moves nothing under reduced motion', () => {
    expect(packetSpots(1200, [1000], PACKET_DURATION, true)).toEqual([])
    expect(packetSpots(1000, [1000], PACKET_DURATION, true)).toEqual([])
  })
})
