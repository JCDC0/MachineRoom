import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import Hud from '../src/ui/Hud.jsx'
import OrchestratorChat from '../src/ui/OrchestratorChat.jsx'
import { OrchestratorsContext } from '../src/ui/Transport.jsx'
import { settle, withDom } from './helpers/uiDom.js'

const LIST = [
  { id: 'orchestrator', name: 'Orchestrator', state: 'idle' },
  { id: 'frontend', name: 'Frontend', state: 'idle' },
]

function makeClient(calls) {
  return {
    orchestrators: async () => {
      calls.push('orchestrators')
      return LIST
    },
    orchestrator: async () => ({ state: 'idle', messages: [] }),
    orchestratorSessions: async () => ({ current: { title: 'Live one' }, sessions: [] }),
    lanes: async () => ({ lanes: [], max: 4, chosen: true }),
    subscribe: () => () => {},
  }
}

describe('one orchestrator list read', () => {
  it('does not poll for the list when the room passes one to the chat', async () => {
    const calls = []
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(OrchestratorChat, {
            open: true,
            client: makeClient(calls),
            orchestrators: LIST,
          })
        )
      })
      await settle()
      expect(calls).toEqual([])
      expect(container.textContent).toContain('Frontend')
      expect(container.querySelectorAll('.mr-orch-tab')).toHaveLength(3)
    })
  })

  it('leaves the list read to the room when it supplies one', async () => {
    const calls = []
    await withDom(async ({ container, dom, root }) => {
      dom.window.localStorage.setItem('machineroom.guide', '1')
      dom.window.innerWidth = 1200
      await act(async () => {
        root.render(
          createElement(
            OrchestratorsContext.Provider,
            { value: LIST },
            createElement(Hud, {
              snapshot: {
                position: 0,
                duration: 0,
                playing: false,
                speed: 1,
                live: true,
                status: 'live',
                agents: [],
                log: [],
              },
              project: 'app',
              mode: 'live',
              liveAvailable: true,
              client: makeClient(calls),
              health: { ok: true, orchestrator: true },
              speeds: [1],
              onMode: () => {},
            })
          )
        )
      })
      await settle()
      expect(calls).toEqual([])
      expect(container.textContent).toContain('Frontend')
    })
  })
})
