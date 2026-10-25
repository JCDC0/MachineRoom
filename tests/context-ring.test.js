import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Transport from '../src/ui/Transport.jsx'
import {
  contextLabel,
  contextPercent,
  contextShare,
  contextTitle,
  contextTone,
  orchestratorStateWord,
} from '../src/ui/contextRing.js'

const LIVE = { live: true, position: 65000, duration: 0, playing: true, speed: 1 }

describe('the context ring helpers', () => {
  it('takes the share of the window and keeps it between none and full', () => {
    expect(contextShare(84000, 200000)).toBeCloseTo(0.42, 5)
    expect(contextShare(0, 200000)).toBe(0)
    expect(contextShare(250000, 200000)).toBe(1)
    expect(contextShare(null, 200000)).toBeNull()
    expect(contextShare(84000, null)).toBeNull()
    expect(contextShare(-1, 200000)).toBeNull()
    expect(contextShare(84000, 0)).toBeNull()
  })

  it('is white below the rule, yellow at or past it and red past 95 percent', () => {
    expect(contextTone(0.42, 80)).toBe('white')
    expect(contextTone(0.79, 80)).toBe('white')
    expect(contextTone(0.8, 80)).toBe('yellow')
    expect(contextTone(0.95, 80)).toBe('yellow')
    expect(contextTone(0.951, 80)).toBe('red')
    expect(contextTone(0.75, 70)).toBe('yellow')
    expect(contextTone(null, 80)).toBe('white')
    expect(contextTone(0.85, 0)).toBe('yellow')
    expect(contextTone(0.85, 120)).toBe('white')
    expect(contextTone(0.5, 5000)).toBe('white')
  })

  it('gives the percent and the label or says the context is not reported', () => {
    expect(contextPercent(0.42)).toBe(42)
    expect(contextPercent(0.4237)).toBe(42)
    expect(contextPercent(1)).toBe(100)
    expect(contextPercent(null)).toBeNull()
    expect(contextLabel(84000, 200000)).toBe('42%')
    expect(contextLabel(null, 200000)).toBe('context not reported')
    expect(contextLabel(84000, null)).toBe('context not reported')
    expect(contextTitle(84000, 200000)).toBe('84000 of 200000 tokens')
    expect(contextTitle(250000, 200000)).toBe('250000 of 200000 tokens')
    expect(contextTitle(null, 200000)).toBe('')
  })

  it('gives the state word the bar shows', () => {
    expect(orchestratorStateWord('working')).toBe('working')
    expect(orchestratorStateWord('idle')).toBe('waiting for you')
    expect(orchestratorStateWord('paused')).toBe('paused')
    expect(orchestratorStateWord(undefined)).toBe('waiting for you')
    expect(orchestratorStateWord('queued')).toBe('waiting for you')
  })
})

describe('the transport under the lens', () => {
  it('shows the orchestrator state and a context ring in the live bar', () => {
    const html = renderToString(
      createElement(Transport, {
        snapshot: LIVE,
        speeds: [1],
        orchestrator: {
          id: 'orchestrator',
          state: 'working',
          contextTokens: 84000,
          contextWindow: 200000,
          autocompactPercent: 80,
        },
      })
    )
    expect(html).toContain('class="transport is-live has-orchestrator"')
    expect(html).toContain('class="transport-orchestrator"')
    expect(html).toContain('>Orchestrator<')
    expect(html).toContain('class="transport-orchestrator-state mono">working<')
    expect(html).toContain('class="transport-context is-white"')
    expect(html).toContain('width="22"')
    expect(html).toContain('title="84000 of 200000 tokens"')
    expect(html).toContain('stroke-dasharray="42 100"')
    expect(html).toContain('>42%<')
    expect(html).toContain('>01:05<')
    expect(html).toContain('since opening')
  })

  it('shows an empty ring and the plain words when the answer has no numbers', () => {
    const html = renderToString(
      createElement(Transport, {
        snapshot: LIVE,
        speeds: [1],
        orchestrator: { id: 'orchestrator', state: 'idle' },
      })
    )
    expect(html).toContain('class="transport-context is-white"')
    expect(html).toContain('>context not reported<')
    expect(html).toContain('>waiting for you<')
    expect(html).not.toContain('transport-context-arc')
    expect(html).not.toContain('stroke-dasharray')
  })

  it('turns the ring yellow at the autocompact rule and red past 95 percent', () => {
    const yellow = renderToString(
      createElement(Transport, {
        snapshot: LIVE,
        speeds: [1],
        orchestrator: {
          state: 'paused',
          contextTokens: 160000,
          contextWindow: 200000,
          autocompactPercent: 80,
        },
      })
    )
    expect(yellow).toContain('transport-context is-yellow')
    expect(yellow).toContain('>80%<')
    expect(yellow).toContain('>paused<')

    const red = renderToString(
      createElement(Transport, {
        snapshot: LIVE,
        speeds: [1],
        orchestrator: {
          state: 'working',
          contextTokens: 192000,
          contextWindow: 200000,
          autocompactPercent: 80,
        },
      })
    )
    expect(red).toContain('transport-context is-red')
    expect(red).toContain('>96%<')
  })

  it('leaves the bar as it was below 900 pixels and in a replay', () => {
    const narrow = renderToString(createElement(Transport, { snapshot: LIVE, speeds: [1] }))
    expect(narrow).toContain('class="transport is-live"')
    expect(narrow).not.toContain('transport-orchestrator')
    expect(narrow).not.toContain('transport-context')

    const replay = renderToString(
      createElement(Transport, {
        snapshot: { position: 12.5, duration: 60, playing: false, speed: 1 },
        speeds: [1],
      })
    )
    expect(replay).toContain('class="transport"')
    expect(replay).not.toContain('transport-orchestrator')
    expect(replay).not.toContain('transport-context')
  })
})
