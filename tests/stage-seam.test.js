import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { LensCompass, createSeamSync, lensPoseStep } from '../src/Stage.jsx'
import { withDom } from './helpers/uiDom.js'

class FakeResizeObserver {
  static all = []

  constructor(callback) {
    this.callback = callback
    this.targets = new Set()
    this.observeCalls = 0
    FakeResizeObserver.all.push(this)
  }

  observe(node) {
    this.observeCalls += 1
    this.targets.add(node)
  }

  unobserve(node) {
    this.targets.delete(node)
  }

  disconnect() {
    this.targets.clear()
  }

  fire() {
    this.callback([])
  }
}

class FakeMutationObserver {
  static all = []

  constructor(callback) {
    this.callback = callback
    this.targets = new Set()
    this.observeCalls = 0
    this.options = null
    FakeMutationObserver.all.push(this)
  }

  observe(node, options) {
    this.observeCalls += 1
    this.targets.add(node)
    this.options = options
  }

  disconnect() {
    this.targets.clear()
  }

  fire(records) {
    this.callback(records)
  }
}

function fakeWindow(width = 1200) {
  let next = 1
  const frames = new Map()
  return {
    innerWidth: width,
    frames,
    requestAnimationFrame(run) {
      const id = next
      next += 1
      frames.set(id, run)
      return id
    },
    cancelAnimationFrame(id) {
      frames.delete(id)
    },
    flush() {
      const runs = [...frames.values()]
      frames.clear()
      for (const run of runs) run(16)
    },
  }
}

function fakeNode({ className = '', width = 0, left = 0, controls = () => [] } = {}) {
  const node = {
    nodeType: 1,
    className,
    parentNode: null,
    width,
    left,
    props: [],
    reads: 0,
    style: {
      setProperty(name, value) {
        node.props.push({ name, value })
      },
      removeProperty(name) {
        node.props.push({ name, removed: true })
      },
    },
    getBoundingClientRect() {
      node.reads += 1
      return { left: node.left, right: node.left + node.width, width: node.width, top: 0, bottom: 0, height: 0 }
    },
    querySelectorAll: () => controls(),
  }
  return node
}

function setup(width = 1200) {
  const menuControls = []
  const transportControls = []
  const nodes = {
    lens: fakeNode({ className: 'lens', width }),
    hud: fakeNode({ className: 'hud' }),
    menu: fakeNode({ className: 'hud-menu', controls: () => menuControls }),
    transport: fakeNode({ className: 'transport', controls: () => transportControls }),
  }
  const doc = {
    querySelector(selector) {
      if (selector === '.lens') return nodes.lens
      if (selector === '.hud') return nodes.hud
      if (selector === '.hud-menu') return nodes.menu
      if (selector === '.transport') return nodes.transport
      return null
    },
  }
  const win = fakeWindow(width)
  const sync = createSeamSync({
    window: win,
    document: doc,
    Resize: FakeResizeObserver,
    Mutation: FakeMutationObserver,
  })
  return {
    sync,
    win,
    nodes,
    lens: nodes.lens,
    menu: nodes.menu,
    transport: nodes.transport,
    menuControls,
    transportControls,
    resize: () => FakeResizeObserver.all.at(-1),
    mutation: () => FakeMutationObserver.all.at(-1),
  }
}

describe('seam sync', () => {
  it('runs one measure in the animation frame however many changes arrive', () => {
    const seam = setup()
    const chip = fakeNode({ className: 'transport-chip', width: 80, left: 560 })
    seam.transportControls.push(chip)
    seam.sync.measure()
    expect(chip.props).toEqual([
      { name: '--seam-y', value: '-28px' },
      { name: '--seam-r', value: '0deg' },
    ])

    seam.lens.reads = 0
    const resize = seam.resize()
    resize.fire()
    resize.fire()
    resize.fire()
    seam.mutation().fire([{ target: seam.transport }])
    expect(seam.win.frames.size).toBe(1)

    seam.win.flush()
    expect(seam.lens.reads).toBe(1)
  })

  it('writes a pose only when its value changed', () => {
    const seam = setup()
    const chip = fakeNode({ className: 'transport-chip', width: 80, left: 560 })
    seam.transportControls.push(chip)
    seam.sync.measure()
    chip.props.length = 0

    seam.sync.measure()
    seam.sync.measure()
    expect(chip.props).toEqual([])
  })

  it('observes each element once until it is replaced', () => {
    const seam = setup()
    seam.sync.measure()
    seam.sync.measure()
    seam.sync.measure()

    expect(seam.resize().observeCalls).toBe(3)
    expect(seam.mutation().observeCalls).toBe(3)
    expect(seam.mutation().options).toEqual({ childList: true, subtree: true })
  })

  it('ignores lines inside the log dropdown, the band list and the health popover', () => {
    const seam = setup()
    seam.sync.measure()
    const dropdown = { nodeType: 1, className: 'hud-dropdown', parentNode: seam.menu }
    const line = { nodeType: 3, className: '', parentNode: dropdown }
    const band = { nodeType: 1, className: 'hud-band-list is-open', parentNode: seam.menu }
    const health = { nodeType: 1, className: 'hud-health-popover', parentNode: seam.menu }

    seam.mutation().fire([{ target: line }])
    seam.mutation().fire([{ target: dropdown }])
    seam.mutation().fire([{ target: band }])
    seam.mutation().fire([{ target: health }])
    expect(seam.win.frames.size).toBe(0)

    seam.mutation().fire([{ target: seam.transport }])
    expect(seam.win.frames.size).toBe(1)
  })

  it('gives a chip that appears later its pose', () => {
    const seam = setup()
    seam.sync.measure()
    const chip = fakeNode({ className: 'transport-chip', width: 80, left: 560 })
    seam.transportControls.push(chip)

    seam.mutation().fire([{ target: seam.transport }])
    seam.win.flush()

    expect(chip.props).toEqual([
      { name: '--seam-y', value: '-28px' },
      { name: '--seam-r', value: '0deg' },
    ])
  })

  it('measures a replaced menu and transport from their parent change', () => {
    const seam = setup()
    seam.sync.measure()
    const menuChip = fakeNode({ className: 'hud-action', width: 60, left: 570 })
    const transportChip = fakeNode({ className: 'transport-chip', width: 80, left: 560 })
    const oldMenu = seam.menu
    const oldTransport = seam.transport
    seam.nodes.menu = fakeNode({ className: 'hud-menu', controls: () => [menuChip] })
    seam.nodes.transport = fakeNode({ className: 'transport', controls: () => [transportChip] })

    seam.mutation().fire([{ type: 'childList', target: seam.nodes.hud }])
    seam.win.flush()

    expect(menuChip.props).toEqual([
      { name: '--seam-y', value: '28px' },
      { name: '--seam-r', value: '0deg' },
    ])
    expect(transportChip.props).toEqual([
      { name: '--seam-y', value: '-28px' },
      { name: '--seam-r', value: '0deg' },
    ])
    expect(seam.resize().targets.has(seam.nodes.menu)).toBe(true)
    expect(seam.resize().targets.has(seam.nodes.transport)).toBe(true)
    expect(seam.mutation().targets.has(seam.nodes.menu)).toBe(true)
    expect(seam.mutation().targets.has(seam.nodes.transport)).toBe(true)
    expect(seam.resize().targets.has(oldMenu)).toBe(false)
    expect(seam.resize().targets.has(oldTransport)).toBe(false)
  })

  it('reposes the controls after one widens', () => {
    const seam = setup()
    const title = fakeNode({ className: 'hud-band-switch', width: 120, left: 80 })
    const chip = fakeNode({ className: 'transport-chip', width: 80, left: 400 })
    seam.menuControls.push(title)
    seam.transportControls.push(chip)
    seam.sync.measure()
    const before = chip.props.slice()
    chip.props.length = 0

    title.width = 300
    chip.left = 580
    expect(seam.resize().targets.has(title)).toBe(true)
    seam.resize().fire()
    seam.win.flush()

    expect(chip.props).toHaveLength(2)
    expect(chip.props).not.toEqual(before)
  })

  it('writes no pose when the clock ticks', () => {
    const seam = setup()
    const clock = fakeNode({ className: 'mono', width: 100, left: 900 })
    seam.transportControls.push(clock)
    seam.sync.measure()
    clock.props.length = 0

    seam.mutation().fire([{ type: 'characterData', target: clock }])
    expect(seam.win.frames.size).toBe(0)

    seam.sync.measure()
    expect(clock.props).toEqual([])
  })

  it('drops the pending measure and the poses on stop', () => {
    const seam = setup()
    const chip = fakeNode({ className: 'transport-chip', width: 80, left: 560 })
    seam.transportControls.push(chip)
    seam.sync.measure()
    chip.props.length = 0

    seam.mutation().fire([{ target: seam.transport }])
    seam.sync.stop()

    expect(seam.win.frames.size).toBe(0)
    expect(chip.props).toEqual([
      { name: '--seam-y', removed: true },
      { name: '--seam-r', removed: true },
    ])
  })
})

describe('lens pose step', () => {
  it('keeps a yaw or pitch that moves less than 0.0005 radians', () => {
    const pose = { yaw: 0.2, pitch: 0.1 }
    const level = { yaw: 0, pitch: 0 }
    expect(lensPoseStep(pose, 0.2004, 0.0996)).toBe(pose)
    expect(lensPoseStep(level, 0.0005, -0.0005)).toBe(level)
  })

  it('takes a move past the threshold and keeps the other value', () => {
    const pose = { yaw: 0.2, pitch: 0.1 }
    expect(lensPoseStep(pose, 0.2006, 0.1)).toEqual({ yaw: 0.2006, pitch: 0.1 })
    expect(lensPoseStep(pose, 0.2, 0.1007)).toEqual({ yaw: 0.2, pitch: 0.1007 })
    expect(lensPoseStep(pose, 0.2006, 0.1007)).toEqual({ yaw: 0.2006, pitch: 0.1007 })
  })

  it('keeps the current value when the room has no number', () => {
    const pose = { yaw: 0.2, pitch: 0.1 }
    expect(lensPoseStep(pose, undefined, null)).toBe(pose)
    expect(lensPoseStep(null, 0.4, 0.3)).toEqual({ yaw: 0.4, pitch: 0.3 })
  })
})

describe('lens compass', () => {
  it('is memoised and moves both tapes from the update ref', async () => {
    expect(LensCompass.$$typeof).toBe(Symbol.for('react.memo'))

    await withDom(async ({ container, root }) => {
      const create = document.createElement
      document.createElement = (tag) => {
        const node = create(tag)
        node.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800 })
        return node
      }
      const updateRef = { current: null }
      function Host({ tick }) {
        return createElement(
          'div',
          null,
          createElement(LensCompass, { updateRef, disconnected: false }),
          createElement('span', null, String(tick))
        )
      }

      await act(async () => root.render(createElement(Host, { tick: 0 })))
      expect(updateRef.current).toBeTypeOf('function')
      const bottom = container.querySelector('.lens-edge.is-bottom')
      expect(bottom.querySelectorAll('line, text')).toHaveLength(0)
      expect(container.querySelector('.lens-edge.is-top').querySelectorAll('line').length).toBeGreaterThan(0)
      const centre = () => container.querySelectorAll('text').find((label) => label.getAttribute('x') === '604')
      expect(centre()?.textContent).toBe('N 000')

      await act(async () => updateRef.current(-Math.PI / 2, 0))
      expect(centre()?.textContent).toBe('E 090')

      await act(async () => root.render(createElement(Host, { tick: 1 })))
      expect(container.textContent).toContain('1')
      expect(centre()?.textContent).toBe('E 090')
    })
  })
})
