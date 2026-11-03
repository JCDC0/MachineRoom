import { describe, expect, it } from 'vitest'
import { handleRoomKey } from '../src/Stage.jsx'

function makeView() {
  const calls = []
  const player = {
    position: 1000,
    speed: 1,
    seek(position) {
      calls.push(['seek', position])
    },
    toggle() {
      calls.push(['toggle'])
    },
  }
  return {
    calls,
    view: {
      player,
      room: { current: null },
      follow: { current: false },
      inspector: { current: null },
      agents: [],
      closeInspector: () => calls.push(['close']),
      parkRoom: () => calls.push(['park']),
      setFollow: (value) => calls.push(['follow', value]),
      setOpenChips: (value) => calls.push(['chips', value]),
      setFocused: (key) => calls.push(['focused', key]),
      changeSpeed: (value) => calls.push(['speed', value]),
    },
  }
}

describe('the room key handler', () => {
  it('returns at once when another control already handled the key', () => {
    const { calls, view } = makeView()
    handleRoomKey({ key: 'ArrowRight', defaultPrevented: true, target: null }, view)
    handleRoomKey({ code: 'Space', key: ' ', defaultPrevented: true, target: null }, view)
    expect(calls).toEqual([])
  })

  it('seeks, plays and changes speed on an untouched key', () => {
    const { calls, view } = makeView()
    handleRoomKey({ key: 'ArrowRight', defaultPrevented: false, target: null }, view)
    handleRoomKey({ key: 'ArrowLeft', defaultPrevented: false, target: null }, view)
    handleRoomKey(
      {
        code: 'Space',
        key: ' ',
        defaultPrevented: false,
        target: null,
        preventDefault() {
          calls.push(['prevent'])
        },
      },
      view
    )
    handleRoomKey({ key: ']', defaultPrevented: false, target: null }, view)
    expect(calls).toEqual([
      ['seek', 6000],
      ['seek', -4000],
      ['prevent'],
      ['toggle'],
      ['speed', 2],
    ])
  })

  it('leaves the room alone behind the control drawer', () => {
    const { calls, view } = makeView()
    const saved = globalThis.document
    globalThis.document = { querySelector: (selector) => (selector.includes('.control-drawer') ? {} : null) }
    try {
      for (const key of ['f', 't', '0', '[', ']']) {
        handleRoomKey({ key, defaultPrevented: false, target: null }, view)
      }
    } finally {
      if (saved === undefined) delete globalThis.document
      else globalThis.document = saved
    }
    expect(calls).toEqual([])
  })

  it('still takes room keys while the lower half drawer is open', () => {
    const { calls, view } = makeView()
    const saved = globalThis.document
    globalThis.document = { querySelector: (selector) => (selector.includes('.hud-drawer') ? {} : null) }
    try {
      for (const key of ['f', 't', '0', '[', ']']) {
        handleRoomKey({ key, defaultPrevented: false, target: null, preventDefault() {} }, view)
      }
    } finally {
      if (saved === undefined) delete globalThis.document
      else globalThis.document = saved
    }
    expect(calls.length).toBeGreaterThan(0)
  })

  it('leaves typing and a button key alone', () => {
    const { calls, view } = makeView()
    const field = { closest: (selector) => (selector.includes('input') ? {} : null) }
    handleRoomKey({ key: 'ArrowRight', defaultPrevented: false, target: field }, view)
    const button = { closest: (selector) => (selector === 'button' ? {} : null) }
    handleRoomKey({ key: 'Enter', defaultPrevented: false, target: button }, view)
    expect(calls).toEqual([])
  })
})
