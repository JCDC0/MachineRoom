import { describe, expect, it } from 'vitest'
import { stripPoints } from '../src/engine/agents.js'

const from = { x: 0, y: 290, z: 300 }
const to = { x: 620, y: 460, z: -80 }

describe('stripPoints', () => {
  it('gives four points and three straight segments from the agent to the target', () => {
    const points = stripPoints(from, to)
    expect(points).toHaveLength(4)
    expect(points[0]).toEqual(from)
    expect(points[3]).toEqual(to)
  })

  it('rises from the agent and runs level into the card', () => {
    const points = stripPoints(from, to)
    expect(points[1].x).toBe(from.x)
    expect(points[1].z).toBe(from.z)
    expect(points[1].y).toBeGreaterThan(from.y)
    expect(points[2].y).toBe(to.y)
    expect(points[3].y).toBe(points[2].y)
  })

  it('leans in from the side where the target lies', () => {
    const right = stripPoints(from, { x: 620, y: 460, z: -80 })
    const left = stripPoints(from, { x: -620, y: 460, z: -80 })
    expect(right[2].x).toBeLessThan(right[3].x)
    expect(left[2].x).toBeGreaterThan(left[3].x)
  })

  it('runs the last segment into the side of the card', () => {
    const right = { x: 1, y: 0, z: 0 }
    const cardOnLeft = stripPoints(from, to, { side: 1, right })
    const cardOnRight = stripPoints(from, to, { side: -1, right })
    expect(cardOnLeft[2].x).toBeGreaterThan(cardOnLeft[3].x)
    expect(cardOnRight[2].x).toBeLessThan(cardOnRight[3].x)
    expect(cardOnLeft[2].y).toBe(cardOnLeft[3].y)
    expect(cardOnRight[2].y).toBe(cardOnRight[3].y)
  })

  it('gives the same points every time and leaves its inputs alone', () => {
    const first = stripPoints(from, to)
    const second = stripPoints(from, to)
    expect(second).toEqual(first)
    expect(from).toEqual({ x: 0, y: 290, z: 300 })
    expect(to).toEqual({ x: 620, y: 460, z: -80 })
  })
})
