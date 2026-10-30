import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import Hud from '../src/ui/Hud.jsx'
import { OPEN_CHAT_EVENT } from '../src/ui/transportOrchestrators.js'
import { buttonWithText, settle, withDom } from './helpers/uiDom.js'

const SNAPSHOT = {
  position: 0,
  duration: 0,
  playing: false,
  speed: 1,
  live: false,
  status: 'live',
  agents: [
    { key: 'orchestrator', name: 'Orchestrator', status: 'idle' },
    { key: 'opencode', name: 'OpenCode', status: 'idle' },
  ],
  log: [],
}

function makeClient() {
  const calls = []
  return {
    calls,
    orchestrators: async () => [
      { id: 'orchestrator', name: 'Orchestrator', state: 'idle' },
      { id: 'frontend', name: 'Frontend', state: 'idle' },
    ],
    orchestrator: async (id) => {
      calls.push({ name: 'orchestrator', id: id ?? 'orchestrator' })
      return {
        state: 'idle',
        messages: [{ id: 'm1', from: 'owner', text: 'Build the page.' }],
      }
    },
    orchestratorSessions: async () => ({ current: { title: 'Live one' }, sessions: [] }),
    projects: async () => ({ current: { path: 'C:\\project' }, recent: [] }),
    lanes: async () => ({ lanes: [], max: 4, chosen: true }),
    subscribe: () => () => {},
  }
}

async function mount(root, client) {
  await act(async () => {
    root.render(
      createElement(Hud, {
        snapshot: SNAPSHOT,
        project: 'C:\\project',
        mode: 'live',
        liveAvailable: true,
        client,
        health: { ok: true, orchestrator: true },
        speeds: [1],
        onMode: () => {},
      })
    )
  })
  await settle()
}

describe('the open chat event', () => {
  it('opens the chat on a narrow window, picks the sub tab and closes the sessions overlay', async () => {
    const client = makeClient()
    await withDom(async ({ container, dom, root }) => {
      dom.window.localStorage.setItem('machineroom.guide', '1')
      dom.window.innerWidth = 800
      await mount(root, client)

      expect(container.querySelector('#hud-orchestrator-chat')).toBeNull()

      const sessions = buttonWithText(container, 'Sessions')
      expect(sessions).not.toBeNull()
      await act(async () => {
        sessions.click()
      })
      expect(container.querySelector('#mr-side-overlay')).not.toBeNull()

      await act(async () => {
        dom.window.dispatchEvent({
          type: OPEN_CHAT_EVENT,
          detail: { id: 'frontend' },
        })
      })
      await settle(20)

      expect(container.querySelector('#mr-side-overlay')).toBeNull()
      const chat = container.querySelector('#hud-orchestrator-chat')
      expect(chat).not.toBeNull()
      const active = chat.querySelector('.mr-orch-tab.is-active')
      expect(active).not.toBeNull()
      expect(active.textContent).toBe('Frontend')
      expect(client.calls).toContainEqual({ name: 'orchestrator', id: 'frontend' })
    })
  })
})
