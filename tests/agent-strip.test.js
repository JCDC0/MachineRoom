import { describe, expect, it } from 'vitest'
import { stripPoints } from '../src/engine/agents.js'

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
