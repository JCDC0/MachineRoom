import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Hud from '../src/ui/Hud.jsx'
import {
  REPLAY_LINE,
  REPLAY_LIVE_LINE,
  currentSessionTitle,
  lowerBreadcrumb,
} from '../src/ui/lowerHalf.js'

describe('the lower half breadcrumb', () => {
  it('names the project in capitals and keeps the conversation title', () => {
    expect(lowerBreadcrumb('/agent-sandbox', 'Fix the header')).toBe(
      'AGENT-SANDBOX / Fix the header'
    )
    expect(lowerBreadcrumb('C:\\GitHub\\agent-sandbox', 'Ship it')).toBe(
      'AGENT-SANDBOX / Ship it'
    )
  })

  it('falls back to PROJECT and New conversation', () => {
    expect(lowerBreadcrumb('', '')).toBe('PROJECT / New conversation')
    expect(lowerBreadcrumb(null, null)).toBe('PROJECT / New conversation')
    expect(lowerBreadcrumb('/agent-sandbox', '   ')).toBe(
      'AGENT-SANDBOX / New conversation'
    )
  })

  it('collapses whitespace in the title and drops an empty title', () => {
    expect(lowerBreadcrumb('/room', '  A   long\n title  ')).toBe('ROOM / A long title')
    expect(lowerBreadcrumb('/room', 42)).toBe('ROOM / New conversation')
  })
})

describe('the current conversation title', () => {
  it('reads current.title from the sessions answer', () => {
    expect(currentSessionTitle({ current: { title: ' Fix the header ' } })).toBe('Fix the header')
    expect(currentSessionTitle({ current: { title: 'A\nB' } })).toBe('A B')
  })

  it('answers empty when the answer or title is missing', () => {
    expect(currentSessionTitle(null)).toBe('')
    expect(currentSessionTitle({})).toBe('')
    expect(currentSessionTitle({ current: null })).toBe('')
    expect(currentSessionTitle({ current: { title: 7 } })).toBe('')
    expect(currentSessionTitle({ current: { title: '  ' } })).toBe('')
  })
})

function replayHtml(liveAvailable) {
  const saved = globalThis.window
  globalThis.window = {
    innerWidth: 1200,
    location: { search: '' },
    localStorage: { getItem: () => null, setItem: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  try {
    return renderToString(
      createElement(Hud, {
        mode: 'replay',
        snapshot: { position: 0, duration: 1, playing: false, speed: 1, agents: [] },
        speeds: [1],
        liveAvailable,
      })
    )
  } finally {
    if (saved === undefined) delete globalThis.window
    else globalThis.window = saved
  }
}

describe('the replay line', () => {
  it('names the recorded run and the Connect path', () => {
    expect(REPLAY_LINE).toBe(
      'This is a recorded run. Connect to your project to talk to the orchestrator.'
    )
  })

  it('points a connected replay to Live and shows no Connect button', () => {
    const html = replayHtml(true)
    expect(html).toContain(REPLAY_LIVE_LINE)
    expect(html).toContain('This is a replay. Switch to Live to talk to the orchestrator.')
    expect(html).not.toContain('hud-lower-connect')
    expect(html).not.toContain('>Connect</button>')
  })

  it('keeps the recorded-run sentence and its Connect button with no bridge', () => {
    const html = replayHtml(false)
    expect(html).toContain(REPLAY_LINE)
    expect(html).toContain('>Connect</button>')
  })
})
