import * as THREE from 'three'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AGENT_COLORS, agentColor } from '../src/engine/sprites.js'
import {
  STAR_LABEL_LIFT,
  STAR_MAX_SECONDS,
  STAR_MIN_SECONDS,
  STAR_POOL,
  STAR_SPEED,
  agentStar,
  createStars,
  starAdvance,
  starDuration,
  starEase,
  starPoint,
  starRoute,
  starSlot,
  touchLabelPoint,
} from '../src/engine/stars.js'

const context2d = {
  globalCompositeOperation: 'source-over',
  fillStyle: '',
  beginPath: () => {},
  moveTo: () => {},
  lineTo: () => {},
  closePath: () => {},
  fill: () => {},
  arc: () => {},
  save: () => {},
  restore: () => {},
  translate: () => {},
  rotate: () => {},
  fillRect: () => {},
  createRadialGradient: () => ({ addColorStop: () => {} }),
  createLinearGradient: () => ({ addColorStop: () => {} }),
}

let savedDocument

beforeAll(() => {
  savedDocument = globalThis.document
  globalThis.document = {
    createElement: (tag) => {
      if (tag === 'canvas') return { width: 0, height: 0, getContext: () => context2d }
      return { style: {} }
    },
  }
})

afterAll(() => {
  globalThis.document = savedDocument
})

describe('the star label point', () => {
  it('sits above the tab anchor it is given', () => {
    const anchor = { x: 10, y: 20, z: 30 }
    expect(touchLabelPoint(anchor)).toEqual({ x: 10, y: 20 + STAR_LABEL_LIFT, z: 30 })
    const out = { x: 0, y: 0, z: 0 }
    expect(touchLabelPoint(anchor, out)).toBe(out)
    expect(out).toEqual({ x: 10, y: 20 + STAR_LABEL_LIFT, z: 30 })
  })
})

describe('agentColor', () => {
  it('gives each roster place its own colour from the seven-colour palette', () => {
    expect(AGENT_COLORS).toEqual([0xff8c1a, 0xff3ddb, 0x8f6bff, 0x3ff0d8, 0xff6f91, 0xc08a5a, 0xd9b3ff])
    AGENT_COLORS.forEach((color, index) => expect(agentColor(index)).toBe(color))
  })

  it('starts the palette again after seven and reads a bad index as the first', () => {
    expect(agentColor(7)).toBe(AGENT_COLORS[0])
    expect(agentColor(17)).toBe(AGENT_COLORS[3])
    expect(agentColor(-1)).toBe(AGENT_COLORS[0])
    expect(agentColor('x')).toBe(AGENT_COLORS[0])
  })
})

describe('the star route', () => {
  const centre = { x: 0, y: 300, z: 0 }
  const end = { x: 1400, y: 40, z: 0 }
  const anchors = {
    '': { x: 0, y: -160, z: 300 },
    src: { x: 900, y: 0, z: 0 },
    'src/ui': { x: 1300, y: 0, z: 0 },
  }
  const anchorOf = (path) => anchors[path]

  it('leaves the centre, passes each lit tab and lands at the end', () => {
    const points = starRoute(centre, ['', 'src', 'src/ui'], anchorOf, end)
    expect(points).toHaveLength(5)
    expect(points[0]).toEqual(centre)
    expect(points[1]).toEqual(anchors[''])
    expect(points[2]).toEqual(anchors.src)
    expect(points[3]).toEqual(anchors['src/ui'])
    expect(points[4]).toEqual(end)
  })

  it('goes straight from the centre to the end when no folder is lit', () => {
    expect(starRoute(centre, [], anchorOf, end)).toHaveLength(2)
    expect(starRoute(centre, null, anchorOf, end)).toHaveLength(2)
  })
})

describe('the star duration', () => {
  it('travels at the fixed speed and keeps its floor and ceiling', () => {
    expect(STAR_SPEED).toBe(1800)
    expect(STAR_MIN_SECONDS).toBe(0.25)
    expect(STAR_MAX_SECONDS).toBe(0.9)
    expect(starDuration(0)).toBe(0.25)
    expect(starDuration(-20)).toBe(0.25)
    expect(starDuration(450)).toBeCloseTo(0.25, 10)
    expect(starDuration(900)).toBeCloseTo(0.5, 10)
    expect(starDuration(1800)).toBe(0.9)
    expect(starDuration(9000)).toBe(0.9)
    expect(starDuration('x')).toBe(0.25)
  })
})

describe('the star position', () => {
  const path = [
    { x: 0, y: 0, z: 0 },
    { x: 100, y: 0, z: 0 },
  ]

  it('eases out at the end', () => {
    expect(starEase(-1)).toBe(0)
    expect(starEase(0)).toBe(0)
    expect(starEase(0.5)).toBeCloseTo(0.875, 10)
    expect(starEase(1)).toBe(1)
    expect(starEase(4)).toBe(1)
  })

  it('walks the path by its share', () => {
    expect(starPoint(path, 0)).toEqual({ x: 0, y: 0, z: 0 })
    expect(starPoint(path, 0.5)).toEqual({ x: 87.5, y: 0, z: 0 })
    expect(starPoint(path, 1)).toEqual({ x: 100, y: 0, z: 0 })
    expect(starPoint([{ x: 5, y: 6, z: 7 }], 0.4)).toEqual({ x: 5, y: 6, z: 7 })
  })
})

describe('the star clock', () => {
  it('holds at speed zero and runs at the replay speed', () => {
    expect(starAdvance(0.2, 0.1, 0)).toBeCloseTo(0.2, 10)
    expect(starAdvance(0.2, 0.1, 1)).toBeCloseTo(0.3, 10)
    expect(starAdvance(0.2, 0.1, 4)).toBeCloseTo(0.6, 10)
    expect(starAdvance(0.2, 0.1, 'x')).toBeCloseTo(0.2, 10)
    expect(starAdvance('x', 0.1, 1)).toBeCloseTo(0.1, 10)
  })
})

describe('the star pool', () => {
  it('takes a free slot first', () => {
    expect(starSlot([{ active: true, start: 2 }, { active: false, start: 1 }])).toBe(1)
  })

  it('lands the oldest star when every slot is busy', () => {
    expect(starSlot([{ active: true, start: 4 }, { active: true, start: 2 }, { active: true, start: 3 }])).toBe(1)
    expect(starSlot([])).toBe(-1)
  })
})

describe('the star between agents', () => {
  const ladder = {
    subs: [
      { id: 'frontend', lanes: ['opencode'] },
      { id: 'backend', lanes: ['claude'] },
    ],
  }

  it('sends a lane run start from the sub that leads it', () => {
    expect(agentStar({ type: 'run.start', agent: 'opencode' }, ladder)).toEqual({ from: 'sub-frontend', to: 'opencode' })
    expect(agentStar({ type: 'run.start', agent: 'claude' }, ladder)).toEqual({ from: 'sub-backend', to: 'claude' })
  })

  it('sends a lane run start in no sub from the main orchestrator', () => {
    expect(agentStar({ type: 'run.start', agent: 'hermes' }, ladder)).toEqual({ from: 'orchestrator', to: 'hermes' })
    expect(agentStar({ type: 'run.start', agent: 'opencode' }, null)).toEqual({ from: 'orchestrator', to: 'opencode' })
  })

  it('sends a sub run start from the main orchestrator and a main run start from nobody', () => {
    expect(agentStar({ type: 'run.start', agent: 'sub-frontend' }, ladder)).toEqual({ from: 'orchestrator', to: 'sub-frontend' })
    expect(agentStar({ type: 'run.start', agent: 'orchestrator' }, ladder)).toBeNull()
  })

  it('sends a spawn from the parent to the child', () => {
    expect(agentStar({ type: 'agent.spawn', agent: 'claude', child: 'claude~1' }, ladder)).toEqual({
      from: 'claude',
      to: 'claude~1',
    })
  })

  it('sends order, report and wake messages from the sender to the receiver', () => {
    for (const kind of ['order', 'report', 'wake']) {
      expect(agentStar({ type: 'agent.message', agent: 'orchestrator', to: 'sub-frontend', kind }, ladder)).toEqual({
        from: 'orchestrator',
        to: 'sub-frontend',
      })
    }
  })

  it('sends no star for dispatch or any other activity', () => {
    expect(agentStar({ type: 'agent.message', agent: 'sub-frontend', to: 'opencode', kind: 'dispatch' }, ladder)).toBeNull()
    expect(agentStar({ type: 'agent.message', agent: 'orchestrator', to: 'opencode', kind: 'other' }, ladder)).toBeNull()
    expect(agentStar({ type: 'tool.start', agent: 'opencode' }, ladder)).toBeNull()
    expect(agentStar({ type: 'run.end', agent: 'opencode' }, ladder)).toBeNull()
    expect(agentStar(null, ladder)).toBeNull()
  })

  it('sends nothing when a message or spawn has no other side', () => {
    expect(agentStar({ type: 'agent.message', agent: 'orchestrator', kind: 'order' }, ladder)).toBeNull()
    expect(agentStar({ type: 'agent.message', to: 'opencode', kind: 'order' }, ladder)).toBeNull()
    expect(agentStar({ type: 'agent.spawn', agent: 'claude' }, ladder)).toBeNull()
    expect(agentStar({ type: 'agent.spawn', child: 'claude~1' }, ladder)).toBeNull()
  })
})

describe('the stars in flight', () => {
  const path = [
    { x: 0, y: 0, z: 0 },
    { x: 100, y: 0, z: 0 },
  ]

  it('cancels only the matching stars and never calls their landing', () => {
    const stars = createStars(new THREE.Scene())
    const landed = []
    stars.launch({ points: path, agent: 'a', call: 't1', onLand: () => landed.push('a') })
    stars.launch({ points: path, agent: 'b', call: 't2', onLand: () => landed.push('b') })
    expect(stars.cancel((star) => star.agent === 'a' && star.call === 't1')).toBe(1)
    expect(landed).toEqual([])
    expect(stars.cancel((star) => star.agent === 'a')).toBe(0)
    expect(stars.land((star) => star.agent === 'b')).toBe(1)
    expect(landed).toEqual(['b'])
    stars.dispose()
  })

  it('lands the matching stars at once', () => {
    const stars = createStars(new THREE.Scene())
    const landed = []
    stars.launch({ points: path, agent: 'a', onLand: () => landed.push('a') })
    stars.launch({ points: path, agent: 'b', onLand: () => landed.push('b') })
    expect(stars.land((star) => star.agent === 'a')).toBe(1)
    expect(landed).toEqual(['a'])
    expect(stars.land(() => true)).toBe(1)
    expect(landed).toEqual(['a', 'b'])
    stars.dispose()
  })

  it('lands the oldest star through its landing when the pool is full', () => {
    const stars = createStars(new THREE.Scene())
    const landed = []
    for (let index = 0; index < STAR_POOL; index += 1) {
      stars.launch({ points: path, onLand: () => landed.push(index) })
    }
    stars.launch({ points: path, onLand: () => landed.push('new') })
    expect(landed).toEqual([0])
    stars.dispose()
  })

  it('moves its last point with the card and keeps its length', () => {
    const stars = createStars(new THREE.Scene())
    const landed = []
    let seen = null
    stars.launch({
      points: path,
      follow: (end) => {
        seen = end
        end.x = 1800
        return end
      },
      onLand: () => landed.push('landed'),
    })
    stars.update(0.3, 1)
    expect(seen.x).toBe(1800)
    expect(landed).toEqual([])
    stars.update(0.7, 1)
    expect(landed).toEqual(['landed'])
    stars.dispose()
  })

  it('drops a star whose card has gone and keeps its landing quiet', () => {
    const stars = createStars(new THREE.Scene())
    const landed = []
    stars.launch({ points: path, follow: () => null, onLand: () => landed.push('landed') })
    stars.update(0.1, 1)
    expect(landed).toEqual([])
    expect(stars.land(() => true)).toBe(0)
    stars.dispose()
  })

  it('exposes no unused count method', () => {
    const stars = createStars(new THREE.Scene())
    expect(stars.count).toBeUndefined()
    stars.dispose()
  })
})
