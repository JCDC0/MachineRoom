import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCameraRig } from '../src/engine/camera.js'
import { createHub } from '../src/engine/hub.js'
import { createLabels } from '../src/engine/labels.js'
import { disposeStill, easeRate, reducedMotion, still } from '../src/engine/sprites.js'
import { createVoid } from '../src/engine/void.js'

describe('easeRate', () => {
  it('returns 1 when still is true', () => {
    expect(easeRate(0.016, 5, true)).toBe(1)
    expect(easeRate(0, 5, true)).toBe(1)
    expect(easeRate(10, 2, true)).toBe(1)
  })

  it('returns the old formula when still is false', () => {
    expect(easeRate(0.016, 5, false)).toBeCloseTo(1 - Math.exp(-0.016 * 5))
    expect(easeRate(0.1, 3, false)).toBeCloseTo(1 - Math.exp(-0.1 * 3))
    expect(easeRate(0.016, 5)).toBeCloseTo(1 - Math.exp(-0.016 * 5))
  })

  it('returns 0 for a delta of 0 when still is false', () => {
    expect(easeRate(0, 5, false)).toBe(0)
    expect(easeRate(0, 5)).toBe(0)
  })
})

describe('reduced motion helper', () => {
  let savedWindow
  let savedMatchMedia

  beforeEach(() => {
    savedWindow = globalThis.window
    if (typeof window !== 'undefined') {
      savedMatchMedia = window.matchMedia
    }
  })

  afterEach(() => {
    if (savedWindow && savedMatchMedia !== undefined) {
      savedWindow.matchMedia = savedMatchMedia
    }
    globalThis.window = savedWindow
  })

  it('answers still() true when matchMedia matches', () => {
    const mql = { matches: true }
    globalThis.window = { matchMedia: () => mql }
    const helper = reducedMotion()
    expect(helper.still()).toBe(true)
    expect(still()).toBe(true)
  })

  it('answers still() false when matchMedia does not match', () => {
    const mql = { matches: false }
    globalThis.window = { matchMedia: () => mql }
    const helper = reducedMotion()
    expect(helper.still()).toBe(false)
    expect(still()).toBe(false)
  })

  it('answers still() false when window or matchMedia is missing', () => {
    const helperNoWin = reducedMotion(null)
    expect(helperNoWin.still()).toBe(false)
    expect(helperNoWin.mql).toBe(null)

    const helperNoMatchMedia = reducedMotion({})
    expect(helperNoMatchMedia.still()).toBe(false)
    expect(helperNoMatchMedia.mql).toBe(null)

    delete globalThis.window
    expect(reducedMotion().still()).toBe(false)
    expect(still()).toBe(false)
  })

  it('answers still() false when matchMedia throws', () => {
    const helper = reducedMotion({
      matchMedia: () => {
        throw new Error('unsupported')
      },
    })
    expect(helper.still()).toBe(false)
    expect(helper.mql).toBe(null)
  })

  it('answers a change of matches after the helper was made', () => {
    const mql = { matches: false }
    globalThis.window = { matchMedia: () => mql }
    const helper = reducedMotion()
    expect(helper.still()).toBe(false)
    expect(still()).toBe(false)

    mql.matches = true
    expect(helper.still()).toBe(true)
    expect(still()).toBe(true)

    mql.matches = false
    expect(helper.still()).toBe(false)
    expect(still()).toBe(false)
  })

  it('follows a change event and removes the listener on dispose', () => {
    const listeners = new Set()
    const mql = {
      matches: false,
      addEventListener: (type, listener) => {
        if (type === 'change') listeners.add(listener)
      },
      removeEventListener: (type, listener) => {
        if (type === 'change') listeners.delete(listener)
      },
    }
    globalThis.window = { matchMedia: () => mql }
    expect(still()).toBe(false)
    expect(listeners.size).toBe(1)
    const listener = [...listeners][0]
    listener({ matches: true })
    expect(still()).toBe(true)
    listener({ matches: false })
    expect(still()).toBe(false)

    disposeStill()
    expect(listeners.size).toBe(0)
  })
})

describe('camera rig under reduced motion', () => {
  it('jumps directly to goal target in one step when still is true and keeps drift disabled', () => {
    const mql = { matches: true }
    globalThis.window = {
      matchMedia: () => mql,
      addEventListener: () => {},
      removeEventListener: () => {},
    }
    const camera = new THREE.PerspectiveCamera()
    const surface = {
      addEventListener: () => {},
      removeEventListener: () => {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }),
    }
    const rig = createCameraRig(camera, surface)
    const goalPos = new THREE.Vector3(500, 200, -300)
    rig.focus(() => goalPos, 1200, 0.4)
    rig.update(0.016)
    expect(camera.position.y).toBeCloseTo(200 + Math.sin(0.4) * 1200, 0)
  })
})

describe('hub under reduced motion', () => {
  it('stops dash rotation and keeps slot scale at 1 when still is true', () => {
    const mql = { matches: true }
    globalThis.window = { matchMedia: () => mql }
    const scene = new THREE.Scene()
    const hub = createHub(scene, 4)
    const dashes = hub.group.children.find((c) => c.isLineSegments)
    const slots = hub.group.children.filter((c) => c.isLineLoop)
    hub.update(1.5, 0.1)
    expect(dashes.rotation.y).toBe(0)
    expect(slots[0].scale.x).toBe(1)

    mql.matches = false
    hub.update(1.5, 0.1)
    expect(dashes.rotation.y).toBeGreaterThan(0)
  })
})

describe('labels under reduced motion', () => {
  let savedDoc

  beforeEach(() => {
    savedDoc = globalThis.document
    const context2d = {
      font: '',
      textAlign: '',
      textBaseline: '',
      fillStyle: '',
      strokeStyle: '',
      globalAlpha: 1,
      measureText: (text) => ({ width: String(text).length * 10 }),
      clearRect: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      fillText: () => {},
    }
    globalThis.document = {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => context2d,
      }),
    }
  })

  afterEach(() => {
    globalThis.document = savedDoc
  })

  it('fades in place without rising when still is true', () => {
    const mql = { matches: true }
    globalThis.window = { matchMedia: () => mql }
    const scene = new THREE.Scene()
    const labels = createLabels(scene, 4)
    labels.show('test.js', new THREE.Vector3(0, 0, 0))
    const item = scene.children[0]
    const initialY = item.position.y
    labels.update(0.1)
    expect(item.position.y).toBe(initialY)

    mql.matches = false
    labels.update(0.1)
    expect(item.position.y).toBeGreaterThan(initialY)
  })
})

describe('void under reduced motion', () => {
  let savedDoc

  beforeEach(() => {
    savedDoc = globalThis.document
    const context2d = {
      font: '',
      textAlign: '',
      textBaseline: '',
      fillStyle: '',
      strokeStyle: '',
      globalAlpha: 1,
      measureText: (text) => ({ width: String(text).length * 10 }),
      clearRect: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      fillText: () => {},
    }
    globalThis.document = {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => context2d,
      }),
    }
  })

  afterEach(() => {
    globalThis.document = savedDoc
  })

  it('stops dust rotation when still is true', () => {
    const mql = { matches: true }
    globalThis.window = { matchMedia: () => mql }
    const scene = new THREE.Scene()
    const space = createVoid(scene, null)
    const dust = space.group.children.find((c) => c.isPoints)
    space.update(0.1)
    expect(dust.rotation.y).toBe(0)

    mql.matches = false
    space.update(0.1)
    expect(dust.rotation.y).toBeGreaterThan(0)
  })

  it('holds the fine dust near the camera still when still is true', () => {
    const mql = { matches: true }
    globalThis.window = { matchMedia: () => mql }
    const scene = new THREE.Scene()
    const space = createVoid(scene, null)
    const dust = space.group.children.filter((c) => c.isPoints)
    expect(dust).toHaveLength(2)
    space.update(0.1)
    for (const layer of dust) {
      expect(layer.rotation.x).toBe(0)
      expect(layer.rotation.y).toBe(0)
    }

    mql.matches = false
    space.update(0.1)
    for (const layer of dust) expect(layer.rotation.y).toBeGreaterThan(0)
    expect(dust[1].rotation.x).toBeGreaterThan(0)
  })
})
