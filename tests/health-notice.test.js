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
    expect(healthNotice({ ok: false })).toBeNull()
  })

  it('returns null for healthy answers', () => {
    expect(
      healthNotice({
        ok: true,
        paperclip: true,
        surface: { ok: true, checkedAt: '2026-10-20T12:00:00.000Z' },
      })
    ).toBeNull()
  })

  it('returns null before the first check when checkedAt is null', () => {
    expect(
      healthNotice({
        ok: true,
        paperclip: true,
        surface: { ok: null, checkedAt: null, error: 'not checked yet' },
      })
    ).toBeNull()
  })

  it('reports when the bridge is not answering', () => {
    expect(healthNotice({ error: true })).toEqual({
      tone: 'red',
      title: 'The bridge is not answering',
      lines: [],
    })
  })

  it('reports when Paperclip is not connected', () => {
    expect(healthNotice({ ok: true, paperclip: false })).toEqual({
      tone: 'red',
      title: 'Paperclip is not connected',
      lines: [],
    })
  })

  it('stays quiet about Paperclip when the lane source is on', () => {
    expect(healthNotice({ ok: true, lanes: true, paperclip: false, surface: { ok: null, error: 'down' } })).toBe(null)
    expect(healthNotice({ error: true, lanes: true })).toMatchObject({ title: 'The bridge is not answering' })
    expect(healthNotice({ ok: true, lanes: true, paperclip: true, surface: { ok: false, missing: [{ method: 'GET', path: '/x' }] } })).toMatchObject({ tone: 'red' })
  })

  it('reports changed routes with singular route', () => {
    const notice = healthNotice({
      ok: true,
      paperclip: true,
      surface: {
        ok: false,
        missing: [{ method: 'GET', path: '/api/companies/{companyId}/issues' }],
        changed: [],
      },
    })
    expect(notice).toEqual({
      tone: 'red',
      title: 'Paperclip changed: 1 route',
      lines: ['GET /api/companies/{companyId}/issues is gone'],
    })
  })

  it('reports changed routes with plural routes and combines fields', () => {
    const notice = healthNotice({
      ok: true,
      paperclip: true,
      surface: {
        ok: false,
        missing: [{ method: 'GET', path: '/api/companies/{companyId}/issues' }],
        changed: [
          {
            method: 'PATCH',
            path: '/api/agents/{agentId}',
            bodyFields: ['budgetMonthlyCents'],
            answerFields: ['status'],
          },
        ],
      },
    })
    expect(notice).toEqual({
      tone: 'red',
      title: 'Paperclip changed: 2 routes',
      lines: [
        'GET /api/companies/{companyId}/issues is gone',
        'PATCH /api/agents/{agentId}: no budgetMonthlyCents, status',
      ],
    })
  })

  it('reports unchecked routes with yellow tone and the error line', () => {
    const notice = healthNotice({
      ok: true,
      paperclip: true,
      surface: {
        ok: null,
        checkedAt: '2026-10-20T12:00:00.000Z',
        error: 'Could not read the Paperclip spec: Paperclip is not reachable.',
      },
    })
    expect(notice).toEqual({
      tone: 'yellow',
      title: 'Paperclip routes not checked',
      lines: ['Could not read the Paperclip spec: Paperclip is not reachable.'],
    })
  })

  it('appends non-empty paperclipVersion to red and yellow titles', () => {
    expect(
      healthNotice({
        error: true,
        paperclipVersion: '0.2.0',
      })?.title
    ).toBe('The bridge is not answering (Paperclip 0.2.0)')

    expect(
      healthNotice({
        paperclip: false,
        paperclipVersion: '0.2.0',
      })?.title
    ).toBe('Paperclip is not connected (Paperclip 0.2.0)')

    expect(
      healthNotice({
        surface: {
          ok: false,
          missing: [{ method: 'GET', path: '/api/issues' }],
          changed: [],
        },
        paperclipVersion: '0.2.0',
      })?.title
    ).toBe('Paperclip changed: 1 route (Paperclip 0.2.0)')

    expect(
      healthNotice({
        surface: {
          ok: null,
          checkedAt: '2026-10-20T12:00:00.000Z',
          error: 'spec down',
        },
        paperclipVersion: '0.2.0',
      })?.title
    ).toBe('Paperclip routes not checked (Paperclip 0.2.0)')
  })

  it('ignores empty, whitespace or non-string version values', () => {
    expect(
      healthNotice({
        paperclip: false,
        paperclipVersion: '',
      })?.title
    ).toBe('Paperclip is not connected')

    expect(
      healthNotice({
        paperclip: false,
        paperclipVersion: '   ',
      })?.title
    ).toBe('Paperclip is not connected')

    expect(
      healthNotice({
        paperclip: false,
        paperclipVersion: null,
      })?.title
    ).toBe('Paperclip is not connected')
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
      json: () => Promise.resolve({ ok: true, paperclip: true }),
    })
    const res = await fetchBridgeHealth('http://127.0.0.1:5174', fakeFetch)
    expect(fakeFetch).toHaveBeenCalledWith('http://127.0.0.1:5174/api/health')
    expect(res).toEqual({ ok: true, paperclip: true })
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
        health: {
          ok: true,
          paperclip: true,
          surface: { ok: true, checkedAt: '2026-10-20T12:00:00.000Z' },
        },
      })
    )
    expect(html).not.toContain('hud-health')
    expect(html).not.toContain('Paperclip changed')
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

  it('renders the chip for a changed surface', () => {
    const html = renderToString(
      React.createElement(Hud, {
        snapshot,
        focused: null,
        speeds: [1],
        rootName: 'MachineRoom',
        health: {
          ok: true,
          paperclip: true,
          surface: {
            ok: false,
            missing: [{ method: 'GET', path: '/api/companies/{companyId}/issues' }],
            changed: [],
          },
        },
      })
    )
    expect(html).toContain('class="hud-health is-red"')
    expect(html).toContain('Paperclip changed: 1 route')
  })

  it('renders the chip with yellow tone for unchecked routes', () => {
    const html = renderToString(
      React.createElement(Hud, {
        snapshot,
        focused: null,
        speeds: [1],
        rootName: 'MachineRoom',
        health: {
          ok: true,
          paperclip: true,
          surface: {
            ok: null,
            checkedAt: '2026-10-20T12:00:00.000Z',
            error: 'Paperclip unreachable',
          },
        },
      })
    )
    expect(html).toContain('class="hud-health is-yellow"')
    expect(html).toContain('Paperclip routes not checked')
  })
})
