import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { THINKING_OUT_SECONDS } from '../src/engine/agents.js'
import { FAULT_SOUND_GAP_MS, createRoom } from '../src/engine/room.js'
import { makeTree } from '../src/model/paths.js'
import { apply, createState } from '../src/model/state.js'
import { createTestDom } from './helpers/uiDom.js'

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = document.createElement('canvas')
      setClearColor() {}
      setPixelRatio() {}
      setSize() {}
      render() {}
      dispose() {}
      forceContextLoss() {}
    },
  }
})

vi.mock('three/addons/renderers/CSS3DRenderer.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    CSS3DRenderer: class {
      domElement = document.createElement('div')
      setSize() {}
      render() {}
    },
  }
})

function canvasContext(labels) {
  const gradient = { addColorStop() {} }
  return {
    measureText: (text) => ({ width: String(text).length * 10 }),
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    fillText: (text) => labels.push(text),
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fill() {},
    arc() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
  }
}

describe('room sound cues', () => {
  const roster = [{ key: 'claude', name: 'Claude' }]
  const tree = makeTree({ root: 'demo', files: ['src/a.js', 'src/new.js'], created: ['src/new.js'] })
  let room
  let state
  let sound
  let labels
  let frame
  let now

  beforeEach(() => {
    const dom = createTestDom()
    labels = []
    const context = canvasContext(labels)
    const create = dom.document.createElement.bind(dom.document)
    dom.document.createElement = (tag) => {
      const element = create(tag)
      element.dataset = {}
      element.append = (...children) => children.forEach((child) => element.appendChild(child))
      element.replaceChildren = (...children) => {
        for (const child of [...element.childNodes]) element.removeChild(child)
        element.append(...children)
      }
      element.remove = () => element.parentNode?.removeChild(element)
      element.classList = { add() {}, remove() {} }
      if (tag === 'canvas') element.getContext = () => context
      return element
    }
    Object.assign(dom.window, { innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1 })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.document)
    vi.stubGlobal('requestAnimationFrame', (callback) => {
      frame = callback
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', () => { frame = null })
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    })
    sound = { play: vi.fn(), voice: vi.fn(), stopVoice: vi.fn(), stopRoom: vi.fn() }
    state = createState(tree, roster)
    room = createRoom({
      surface: dom.document.createElement('div'),
      gl: dom.document.createElement('div'),
      css: dom.document.createElement('div'),
      rootName: 'demo',
      agents: roster,
      getState: () => state,
      sound,
    })
    now = performance.now()
  })

  afterEach(() => {
    room?.dispose()
    room = null
    vi.unstubAllGlobals()
  })

  function tick(count = 1) {
    for (let index = 0; index < count; index += 1) {
      now += 16
      frame(now)
    }
  }

  function activity(input) {
    const event = { agent: 'claude', time: now, ...input }
    apply(state, event)
    room.onActivity(event)
  }

  function touch({ path = 'src/a.js', kind = 'file', mode = 'read', id = 'call', label = `${mode} ${path}` } = {}) {
    activity({ type: 'tool.start', id, label, touches: [{ path, kind, mode }] })
  }

  function plays() {
    return sound.play.mock.calls.map(([kind]) => kind)
  }

  it('plays one woosh in each direction and stays quiet on first draw and reset', () => {
    room.setOptions({ folderContents: false, openOnTouch: false })
    tick(30)
    expect(plays()).toEqual([])
    expect(room.focusPath('src')).toBe(true)
    tick(30)
    room.clearSelection()
    tick(30)
    expect(plays()).toEqual(['folderOpen', 'folderClose'])
    expect(sound.play.mock.calls.every(([, place]) => Number.isFinite(place.distance))).toBe(true)
    room.focusPath('src')
    room.reset(state)
    tick(30)
    expect(plays()).toEqual(['folderOpen', 'folderClose'])
  })

  it('plays one fault tone for a failed file or folder touch, at most once a gap', () => {
    tick()
    let clock = 10000
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => clock)
    try {
      touch({ id: 'bad', mode: 'write' })
      activity({ type: 'tool.end', id: 'bad', ok: false })
      expect(plays().filter((kind) => kind === 'failed')).toHaveLength(1)
      const place = sound.play.mock.calls.find(([kind]) => kind === 'failed')[1]
      expect(Number.isFinite(place.distance)).toBe(true)
      touch({ id: 'bad-dir', path: 'src', kind: 'dir', mode: 'list' })
      activity({ type: 'tool.end', id: 'bad-dir', ok: false })
      expect(plays().filter((kind) => kind === 'failed')).toHaveLength(1)
      clock += FAULT_SOUND_GAP_MS
      touch({ id: 'bad-dir-2', path: 'src', kind: 'dir', mode: 'list' })
      activity({ type: 'tool.end', id: 'bad-dir-2', ok: false })
      expect(plays().filter((kind) => kind === 'failed')).toHaveLength(2)
      clock += FAULT_SOUND_GAP_MS
      activity({ type: 'tool.start', id: 'shell', label: '$ false', touches: [] })
      activity({ type: 'tool.end', id: 'shell', ok: false })
      expect(plays().filter((kind) => kind === 'failed')).toHaveLength(2)
    } finally {
      spy.mockRestore()
    }
  })

  it('moves a launched star and plays the read blip with the label when it lands', () => {
    tick()
    touch()
    expect(sound.voice).not.toHaveBeenCalled()
    expect(plays()).toEqual([])
    tick()
    const starCalls = sound.voice.mock.calls
    const [id, kind, origin, level] = starCalls[0]
    expect(kind).toBe('star')
    expect(level).toBe(1)
    expect(origin.flightSeconds).toBeGreaterThanOrEqual(0.25)
    expect(starCalls[1][0]).toBe(id)
    expect(starCalls[1][2].distance).not.toBe(origin.distance)
    expect(plays()).toEqual([])
    expect(labels).not.toContain('read a.js')
    tick(62)
    expect(sound.stopVoice).toHaveBeenCalledExactlyOnceWith(id)
    expect(plays()).toEqual(['read'])
    expect(labels).toContain('read a.js')
    expect(sound.stopVoice.mock.invocationCallOrder[0]).toBeLessThan(sound.play.mock.invocationCallOrder[0])
  })

  it('distinguishes new and deleted writes and plays a list blip as its label appears', () => {
    tick()
    touch({ path: 'src/new.js', mode: 'write', id: 'new' })
    touch({ path: 'src/a.js', mode: 'write', id: 'remove', label: 'rm src/a.js' })
    touch({ path: 'src', kind: 'dir', mode: 'list', id: 'list' })
    expect(plays()).toEqual([])
    tick(62)
    expect(plays().sort()).toEqual(['created', 'deleted', 'list'])
    expect(labels).toContain('list src')
  })

  it('plays created even when the sound option was computed for a new folder', () => {
    const deepTree = makeTree({ root: 'demo', files: ['src/a.js', 'extra/b.js'], created: ['extra/b.js'] })
    state = createState(deepTree, roster)
    room.reset(state)
    sound.play.mockClear()
    tick()
    touch({ path: 'extra/b.js', mode: 'write', id: 'new-dir' })
    tick(62)
    expect(plays()).toContain('created')
  })

  it('stops a cancelled flight without a label blip, with only the fault tone', () => {
    tick()
    touch()
    tick()
    const [id] = sound.voice.mock.calls[0]
    activity({ type: 'tool.end', id: 'call', ok: false })
    expect(sound.stopVoice).toHaveBeenCalledExactlyOnceWith(id)
    tick(62)
    expect(plays()).toEqual(['failed'])
    expect(labels).not.toContain('read a.js')
  })

  it('moves a whir with the thinking blend and stops it when the blend reaches zero', () => {
    activity({ type: 'run.start', runId: 'run' })
    tick(12)
    expect(sound.voice).not.toHaveBeenCalled()
    tick(36)
    const calls = sound.voice.mock.calls
    const [id, kind, place, level] = calls[0]
    expect(kind).toBe('whir')
    expect(level).toBeGreaterThan(0)
    expect(level).toBeLessThan(1)
    expect(calls.at(-1)[2].loop).not.toBe(place.loop)
    expect(calls.at(-1)[3]).toBe(1)
    activity({ type: 'run.end', runId: 'run', ok: true })
    tick()
    expect(sound.stopVoice).not.toHaveBeenCalled()
    expect(calls.at(-1)[3]).toBeLessThan(1)
    tick(Math.ceil(THINKING_OUT_SECONDS / 0.016))
    expect(sound.stopVoice).toHaveBeenCalledExactlyOnceWith(id)
    const total = calls.length
    tick(10)
    expect(calls).toHaveLength(total)
  })

  it('stops room sounds on reset and starts no whir while a replay is paused', () => {
    activity({ type: 'run.start', runId: 'run' })
    tick(60)
    expect(sound.voice).toHaveBeenCalled()
    room.setSpeed(0)
    room.reset(state)
    expect(sound.stopRoom).toHaveBeenCalled()
    sound.voice.mockClear()
    tick(20)
    expect(sound.voice).not.toHaveBeenCalled()
    room.setSpeed(1)
    tick()
    expect(sound.voice).toHaveBeenCalled()
  })

  it('keeps a live whir going between frames while the clock stands still', () => {
    activity({ type: 'run.start', runId: 'run' })
    const clock = state.now
    tick(60)
    sound.voice.mockClear()
    tick(30)
    expect(state.now).toBe(clock)
    expect(sound.voice).toHaveBeenCalled()
  })
})
