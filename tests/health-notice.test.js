import React from 'react'
import { act } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { healthNotice } from '../src/ui/healthNotice.js'
import { fetchBridgeHealth, useBridgeHealth } from '../src/ui/useBridgeHealth.js'
import Hud from '../src/ui/Hud.jsx'
import { click, withDom } from './helpers/uiDom.js'

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

  it('returns null when the bridge is not answering', () => {
    expect(healthNotice({ error: true })).toBeNull()
  })

  it('returns null when the bridge reports a failure', () => {
    expect(healthNotice({ ok: false, lanes: false, sessions: true })).toBeNull()
    expect(healthNotice({ ok: false, error: 'The lane source stopped.' })).toBeNull()
  })

  it('warns when the runner looks stopped', () => {
    expect(healthNotice({ ok: true, runner: { alive: false } })).toEqual({
      tone: 'red',
      title: 'The runner looks stopped',
      lines: [],
    })
    expect(healthNotice({ ok: true, runner: { alive: true } })).toBeNull()
    expect(healthNotice({ ok: false, runner: { alive: false } })).toBeNull()
  })

  it('names a failed tree read while the bridge stays ok', () => {
    const problem = "The last tree read failed: EACCES: permission denied, scandir 'C:\\Users\\<name>\\project'."
    expect(healthNotice({ ok: true, problems: [problem] })).toEqual({
      tone: 'red',
      title: 'A source looks stopped',
      lines: [problem],
    })
  })

  it('names a stopped OpenCode reader while the bridge stays ok', () => {
    const problem = 'The OpenCode session source stopped: The database file is missing.'
    expect(healthNotice({ ok: true, problems: [problem] })).toEqual({
      tone: 'red',
      title: 'A source looks stopped',
      lines: [problem],
    })
  })

  it('shows nothing for an empty problems list', () => {
    expect(healthNotice({ ok: true, problems: [] })).toBeNull()
    expect(healthNotice({ ok: true, problems: ['', '   '] })).toBeNull()
    expect(healthNotice({ ok: true, problems: 'junk' })).toBeNull()
  })

  it('shows one line per problem', () => {
    const tree = 'The last tree read failed: The folder was removed.'
    const opencode = 'The OpenCode session source stopped: The database file is missing.'
    expect(healthNotice({ ok: true, problems: [tree, opencode] })).toEqual({
      tone: 'red',
      title: 'A source looks stopped',
      lines: [tree, opencode],
    })
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
      })
    )
    expect(html).not.toContain('hud-health')
  })

  it('renders no chip when the bridge is not answering', () => {
    const html = renderToString(
      React.createElement(Hud, {
        snapshot,
        focused: null,
        speeds: [1],
        health: { error: true },
      })
    )
    expect(html).not.toContain('hud-health')
  })

  it('renders no chip when the bridge reports a failure', () => {
    const html = renderToString(
      React.createElement(Hud, {
        snapshot,
        focused: null,
        speeds: [1],
        health: { ok: false, lanes: false },
      })
    )
    expect(html).not.toContain('hud-health')
  })

  it('renders the chip when the runner looks stopped', () => {
    const html = renderToString(
      React.createElement(Hud, {
        snapshot,
        focused: null,
        speeds: [1],
        health: { ok: true, runner: { alive: false } },
      })
    )
    expect(html).toContain('class="hud-health is-red"')
    expect(html).toContain('The runner looks stopped')
  })

  it('shows each source problem in the chip details and stays connected', async () => {
    const tree = 'The last tree read failed: The folder was removed.'
    const opencode = 'The OpenCode session source stopped: The database file is missing.'
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          React.createElement(Hud, {
            mode: 'live',
            snapshot,
            focused: null,
            speeds: [1],
            health: { ok: true, problems: [tree, opencode] },
          })
        )
      })
      const hud = container.querySelector('.hud')
      expect(hud).not.toBeNull()
      expect(String(hud.className)).not.toContain('is-disconnected')
      const chip = container.querySelector('.hud-health-chip')
      expect(chip).not.toBeNull()
      expect(chip.textContent).toContain('A source looks stopped')
      await click(root, chip)
      const lines = [...container.querySelectorAll('li')].map((item) => item.textContent)
      expect(lines).toEqual([tree, opencode])
    })
  })
})
