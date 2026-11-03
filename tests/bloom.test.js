import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import {
  BLOOM_RADIUS,
  BLOOM_SCALE,
  BLOOM_STRENGTH_DEFAULT,
  BLOOM_THRESHOLD,
  bloomPixels,
  createBloomLayer,
} from '../src/engine/bloom.js'

function fakeContainer() {
  return {
    children: [],
    appendChild(node) {
      this.children.push(node)
      node.parentNode = this
    },
    removeChild(node) {
      const index = this.children.indexOf(node)
      if (index !== -1) this.children.splice(index, 1)
    },
  }
}

function fakeRenderer(record) {
  const renderer = {
    domElement: { className: '', removed: false },
    autoClear: true,
    setClearColor(color, alpha) {
      record.clear = [color, alpha]
    },
    getClearColor(color) {
      color.setHex(0x000000)
      return color
    },
    getClearAlpha() {
      return 0
    },
    setPixelRatio(value) {
      record.pixelRatio = value
    },
    setSize(width, height, updateStyle) {
      record.sizes.push([width, height])
      record.styles.push(updateStyle)
    },
    setRenderTarget(target) {
      record.target = target
    },
    clear() {
      record.clears += 1
    },
    render() {
      record.renders += 1
    },
    dispose() {
      record.disposed = true
    },
    forceContextLoss() {
      record.contextLost = true
    },
  }
  return renderer
}

function makeLayer(overrides = {}) {
  const container = fakeContainer()
  const record = {
    sizes: [],
    styles: [],
    renders: 0,
    clears: 0,
    target: undefined,
    clear: null,
    disposed: false,
    options: null,
  }
  const layer = createBloomLayer({
    container,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    width: 1440,
    height: 900,
    pixelRatio: 1,
    createRenderer(options) {
      record.options = options
      return fakeRenderer(record)
    },
    ...overrides,
  })
  return { container, record, layer }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the bloom size', () => {
  it('is half the lens pixels from the lens size and its pixel ratio', () => {
    expect(BLOOM_SCALE).toBe(0.5)
    expect(bloomPixels(1440, 900, 1)).toEqual({ width: 720, height: 450 })
    expect(bloomPixels(1440, 900, 2)).toEqual({ width: 1440, height: 900 })
    expect(bloomPixels(1440, 900, 1.5)).toEqual({ width: 1080, height: 675 })
    expect(bloomPixels(800, 600, 2)).toEqual({ width: 800, height: 600 })
  })

  it('rounds to whole pixels and never goes under one', () => {
    expect(bloomPixels(801, 601, 1)).toEqual({ width: 401, height: 301 })
    expect(bloomPixels(1, 1, 1)).toEqual({ width: 1, height: 1 })
    expect(bloomPixels(1, 1, 0.5)).toEqual({ width: 1, height: 1 })
  })

  it('falls back to a pixel ratio of 1 for a missing or bad one', () => {
    expect(bloomPixels(1440, 900, 0)).toEqual({ width: 720, height: 450 })
    expect(bloomPixels(1440, 900, -2)).toEqual({ width: 720, height: 450 })
    expect(bloomPixels(1440, 900, 'soon')).toEqual({ width: 720, height: 450 })
    expect(bloomPixels(1440, 900, NaN)).toEqual({ width: 720, height: 450 })
  })
})

describe('the bloom layer', () => {
  it('draws on its own transparent screen inside the room layer', () => {
    const { container, record, layer } = makeLayer({ strength: 0.55 })
    expect(container.children).toEqual([layer.screen])
    expect(layer.screen.className).toBe('screen-bloom')
    expect(record.options).toEqual({ alpha: true, antialias: false })
    expect(record.clear).toEqual([0x000000, 0])
    expect(record.pixelRatio).toBe(1)
    expect(record.sizes).toEqual([[720, 450]])
    expect(record.styles).toEqual([false])
    expect(layer.strength()).toBe(0.55)
    layer.dispose()
  })

  it('draws at half the lens size on a screen at ratio 2 too', () => {
    const { record, layer } = makeLayer({ pixelRatio: 2 })
    expect(record.pixelRatio).toBe(1)
    expect(record.sizes).toEqual([[1440, 900]])
    layer.dispose()
  })

  it('keeps the strength between 0 and 1 and falls back to 0.4', () => {
    const { layer } = makeLayer()
    expect(BLOOM_STRENGTH_DEFAULT).toBe(0.4)
    expect(layer.strength()).toBe(0.4)
    layer.setStrength(2)
    expect(layer.strength()).toBe(1)
    layer.setStrength(-1)
    expect(layer.strength()).toBe(0)
    layer.setStrength('soon')
    expect(layer.strength()).toBe(BLOOM_STRENGTH_DEFAULT)
    layer.dispose()
  })

  it('renders the room and draws the bloom alone over a cleared screen', () => {
    const { record, layer } = makeLayer()
    layer.render()
    expect(record.renders).toBeGreaterThan(1)
    expect(record.clears).toBeGreaterThan(1)
    expect(record.target).toBe(null)
    layer.dispose()
  })

  it('resizes its scene target and its blur targets to half the lens', () => {
    const sizes = []
    vi.spyOn(THREE.WebGLRenderTarget.prototype, 'setSize').mockImplementation(function setSize(width, height) {
      sizes.push([width, height])
      this.width = width
      this.height = height
    })
    const { record, layer } = makeLayer()
    layer.resize(800, 600)
    expect(record.sizes.at(-1)).toEqual([400, 300])
    expect(record.styles.at(-1)).toBe(false)
    expect(sizes[0]).toEqual([400, 300])
    expect(sizes).toHaveLength(12)
    layer.dispose()
  })

  it('disposes every render target when it is turned off', () => {
    const disposed = []
    vi.spyOn(THREE.WebGLRenderTarget.prototype, 'dispose').mockImplementation(function dispose() {
      disposed.push(this)
    })
    const { container, record, layer } = makeLayer()
    layer.dispose()
    expect(disposed).toHaveLength(12)
    expect(record.disposed).toBe(true)
    expect(record.contextLost).toBe(true)
    expect(container.children).toHaveLength(0)
    layer.dispose()
    expect(disposed).toHaveLength(12)
  })

  it('leaves the threshold above the faint grey lines and below red and blue', () => {
    expect(BLOOM_THRESHOLD).toBeGreaterThan(0.1)
    expect(BLOOM_THRESHOLD).toBeLessThan(0.23)
    expect(BLOOM_RADIUS).toBeGreaterThan(0)
    expect(BLOOM_RADIUS).toBeLessThanOrEqual(1)
  })
})
