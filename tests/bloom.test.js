import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { BLOOM_RADIUS, BLOOM_STRENGTH_DEFAULT, BLOOM_THRESHOLD, createBloomLayer } from '../src/engine/bloom.js'

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
    setSize(width, height) {
      record.sizes.push([width, height])
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
  const record = { sizes: [], renders: 0, clears: 0, target: undefined, clear: null, disposed: false, options: null }
  const layer = createBloomLayer({
    container,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    width: 1440,
    height: 900,
    pixelRatio: 2,
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

describe('the bloom layer', () => {
  it('draws on its own transparent screen inside the room layer', () => {
    const { container, record, layer } = makeLayer({ strength: 0.55 })
    expect(container.children).toEqual([layer.screen])
    expect(layer.screen.className).toBe('screen-bloom')
    expect(record.options).toEqual({ alpha: true, antialias: false })
    expect(record.clear).toEqual([0x000000, 0])
    expect(record.pixelRatio).toBe(2)
    expect(record.sizes).toEqual([[1440, 900]])
    expect(layer.strength()).toBe(0.55)
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

  it('resizes its scene target and its blur targets with the lens', () => {
    const sizes = []
    vi.spyOn(THREE.WebGLRenderTarget.prototype, 'setSize').mockImplementation(function setSize(width, height) {
      sizes.push([width, height])
      this.width = width
      this.height = height
    })
    const { record, layer } = makeLayer()
    layer.resize(800, 600)
    expect(record.sizes.at(-1)).toEqual([800, 600])
    expect(sizes[0]).toEqual([1600, 1200])
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
