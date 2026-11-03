import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import Hud from '../src/ui/Hud.jsx'
import { click, settle, withDom } from './helpers/uiDom.js'

const SNAPSHOT = {
  position: 0,
  duration: 0,
  playing: false,
  speed: 1,
  live: true,
  status: 'live',
  agents: [{ key: 'orchestrator', name: 'Orchestrator', status: 'idle' }],
  log: [],
}

function makeClient() {
  return {
    reviews: async () => [
      { lane: 'opencode', ahead: 2 },
      { lane: 'agy', ahead: 0 },
    ],
    family: async () => ({ nodes: [], proposals: [] }),
    orchestrators: async () => [
      { id: 'orchestrator', name: 'Orchestrator', state: 'paused' },
      { id: 'frontend', name: 'Frontend', state: 'working' },
    ],
    subscribe: () => () => {},
  }
}

async function mount(root, client, props = {}) {
  await act(async () => {
    root.render(
      createElement(Hud, {
        snapshot: SNAPSHOT,
        project: 'C:\\project',
        mode: 'live',
        liveAvailable: true,
        client,
        familyProposals: [{ id: 'p1' }],
        health: { ok: true, orchestrator: true },
        speeds: [1],
        onMode: () => {},
        ...props,
      })
    )
  })
  await settle(20)
}

describe('action badges', () => {
  it('shows the review count and opens Control on Reviews from the count', async () => {
    const client = makeClient()
    await withDom(async ({ container, dom, root }) => {
      dom.window.localStorage.setItem('machineroom.guide', '1')
      await mount(root, client)

      const control = container.querySelector('.hud-action.is-control')
      const badge = container.querySelector('.hud-action-slot').querySelector('.hud-action-badge')
      expect(badge).not.toBeNull()
      expect(badge.textContent).toBe('1')
      expect(badge.tagName).toBe('BUTTON')
      expect(control.contains(badge)).toBe(false)

      await click(root, badge)
      await settle(20)

      const drawer = container.querySelector('#hud-control-drawer')
      expect(drawer).not.toBeNull()
      expect(container.querySelector('#tab-reviews').getAttribute('aria-selected')).toBe('true')
    })
  })

  it('makes the Control count a button of its own, outside the Control button', async () => {
    const client = makeClient()
    await withDom(async ({ container, dom, root }) => {
      dom.window.localStorage.setItem('machineroom.guide', '1')
      await mount(root, client)

      const control = container.querySelector('.hud-action.is-control')
      const badge = container.querySelector('.hud-action-slot').querySelector('.hud-action-badge')
      expect(control.tagName).toBe('BUTTON')
      expect(badge.tagName).toBe('BUTTON')
      expect(badge.getAttribute('type')).toBe('button')
      expect(control.contains(badge)).toBe(false)
      expect(badge.getAttribute('aria-label')).toContain('Open Reviews')
    })
  })

  it('counts the pending proposal and the paused orchestrator on Orchestrator', async () => {
    const client = makeClient()
    await withDom(async ({ container, dom, root }) => {
      dom.window.localStorage.setItem('machineroom.guide', '1')
      await mount(root, client)

      const orchestrator = container.querySelector('.hud-action.is-orchestrator')
      const badge = orchestrator.querySelector('.hud-action-badge')
      expect(badge).not.toBeNull()
      expect(badge.textContent).toBe('2')
    })
  })

  it('shows no count when nothing waits', async () => {
    const client = makeClient()
    client.reviews = async () => [{ lane: 'opencode', ahead: 0 }]
    await withDom(async ({ container, dom, root }) => {
      dom.window.localStorage.setItem('machineroom.guide', '1')
      await act(async () => {
        root.render(
          createElement(Hud, {
            snapshot: SNAPSHOT,
            project: 'C:\\project',
            mode: 'live',
            liveAvailable: true,
            client,
            familyProposals: [],
            health: { ok: true, orchestrator: true },
            speeds: [1],
            onMode: () => {},
          })
        )
      })
      await settle(20)
      expect(container.querySelector('.hud-action-slot').querySelector('.hud-action-badge')).toBeNull()
    })
  })

  it('reads reviews at the start, when an open run ends and when Control closes', async () => {
    const client = makeClient()
    let calls = 0
    client.reviews = async () => {
      calls += 1
      return []
    }
    await withDom(async ({ container, dom, root }) => {
      dom.window.localStorage.setItem('machineroom.guide', '1')
      await mount(root, client, { liveRuns: [{ runId: 'run-1' }] })
      expect(calls).toBe(1)

      await mount(root, client, { liveRuns: [] })
      expect(calls).toBe(2)

      await click(root, container.querySelector('.hud-action.is-control'))
      await settle(20)
      await click(root, container.querySelector('.control-close-btn'))
      await settle(20)
      expect(calls).toBe(3)
    })
  })
})
