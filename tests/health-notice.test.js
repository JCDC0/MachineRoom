import React from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { healthNotice } from '../src/ui/healthNotice.js'
import { fetchBridgeHealth, useBridgeHealth } from '../src/ui/useBridgeHealth.js'
import Hud from '../src/ui/Hud.jsx'

describe('healthNotice', () => {
  it('returns null for junk and empty input', () => {
    expect(healthNotice()).toBeNull()
    expect(healthNotice(null)).toBeNull()
    expect(healthNotice(undefined)).toBeNull()
    expect(healthNotice(123)).toBeNull()
    expect(healthNotice('junk')).toBeNull()
    expect(healthNotice([])).toBeNull()
    expect(healthNotice({})).toBeNull()
    expect(healthNotice({ foo: 'bar' })).toBeNull()
    expect(healthNotice({ ok: true })).toBeNull()
  })

  it('returns null for a healthy bridge', () => {
    expect(healthNotice({ ok: true, lanes: true, sessions: true })).toBeNull()
    expect(healthNotice({ ok: true, lanes: true, unparsed: { total: 0 }, masked: { total: 0 } })).toBeNull()
  })

  it('reports when the bridge is not answering', () => {
    expect(healthNotice({ error: true })).toEqual({
      tone: 'red',
      title: 'The bridge is not answering',
      lines: [],
    })
  })

  it('reports a failed source', () => {
    expect(healthNotice({ ok: false, lanes: false, sessions: true })).toEqual({
      tone: 'red',
      title: 'A source failed',
      lines: [],
    })
    expect(healthNotice({ ok: false, error: 'The lane source stopped.' })).toEqual({
      tone: 'red',
      title: 'A source failed',
      lines: ['The lane source stopped.'],
    })
  })

  it('does not name Paperclip in any notice', () => {
    for (const health of [{ error: true }, { ok: false }, { ok: false, error: 'x' }]) {
      const text = JSON.stringify(healthNotice(health))
      expect(text.toLowerCase()).not.toContain('paperclip')
    }
  })
})

describe('fetchBridgeHealth', () => {
  it('returns null when bridge is empty', async () => {
    expect(await fetchBridgeHealth('')).toBeNull()
    expect(await fetchBridgeHealth(null)).toBeNull()
  })

  it('returns parsed answer on good fetch', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, lanes: true }),
    })
    const res = await fetchBridgeHealth('http://127.0.0.1:5174', fakeFetch)
    expect(fakeFetch).toHaveBeenCalledWith('http://127.0.0.1:5174/api/health')
    expect(res).toEqual({ ok: true, lanes: true })
  })

  it('returns error true on failed fetch', async () => {
    const fakeFetch = vi.fn().mockRejectedValue(new Error('connection refused'))
    const res = await fetchBridgeHealth('http://127.0.0.1:5174', fakeFetch)
    expect(res).toEqual({ error: true })
  })

  it('returns error true on bad status', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    })
    const res = await fetchBridgeHealth('http://127.0.0.1:5174', fakeFetch)
    expect(res).toEqual({ error: true })
  })

  it('returns error true when body is not JSON', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    })
    const res = await fetchBridgeHealth('http://127.0.0.1:5174', fakeFetch)
    expect(res).toEqual({ error: true })
  })
})

describe('useBridgeHealth', () => {
  function renderHook(hookFn) {
    let result = null
    function TestComponent() {
      result = hookFn()
      return null
    }
    renderToString(React.createElement(TestComponent))
    return result
  }

  it('returns null when bridge is empty without calling fetch', () => {
    const fetchImpl = vi.fn()
    const result = renderHook(() => useBridgeHealth('', { fetchImpl }))
    expect(result).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()

    const resultNull = renderHook(() => useBridgeHealth(null, { fetchImpl }))
    expect(resultNull).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('Hud health chip rendering', () => {
  const snapshot = { agents: [], position: 0, duration: 0 }

  it('renders no chip for a healthy answer', () => {
    const html = renderToString(
      React.createElement(Hud, {
        snapshot,
        focused: null,
        speeds: [1],
        rootName: 'MachineRoom',
        health: { ok: true, lanes: true, sessions: true },
      })
    )
    expect(html).not.toContain('hud-health')
  })

  it('renders no chip when health is default null', () => {
    const html = renderToString(
      React.createElement(Hud, {
        snapshot,
        focused: null,
        speeds: [1],
        rootName: 'MachineRoom',
      })
    )
    expect(html).not.toContain('hud-health')
  })

  it('renders the chip when the bridge is not answering', () => {
    const html = renderToString(
      React.createElement(Hud, {
        snapshot,
        focused: null,
        speeds: [1],
        rootName: 'MachineRoom',
        health: { error: true },
      })
    )
    expect(html).toContain('class="hud-health is-red"')
    expect(html).toContain('The bridge is not answering')
    expect(html).not.toContain('Paperclip')
  })

  it('renders the chip when a source failed', () => {
    const html = renderToString(
      React.createElement(Hud, {
        snapshot,
        focused: null,
        speeds: [1],
        rootName: 'MachineRoom',
        health: { ok: false, lanes: false },
      })
    )
    expect(html).toContain('class="hud-health is-red"')
    expect(html).toContain('A source failed')
    expect(html).not.toContain('Paperclip')
  })
})
