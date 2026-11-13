import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import Hud from '../src/ui/Hud.jsx'
import { OrchestratorsContext } from '../src/ui/Transport.jsx'
import { settle, withDom } from './helpers/uiDom.js'

const SNAPSHOT = {
  position: 0,
  duration: 0,
  playing: false,
  speed: 1,
  live: true,
  status: 'live',
  agents: [
    { key: 'orchestrator', name: 'Orchestrator', status: 'idle', depth: 0 },
    { key: 'opencode', name: 'OpenCode', status: 'idle', depth: 0 },
  ],
  log: [],
}

const TWO = [
  { id: 'orchestrator', name: 'Orchestrator', state: 'idle' },
  {
    id: 'frontend',
    name: 'Frontend',
    state: 'idle',
    lanes: ['opencode'],
    scope: ['src/ui/**'],
    restricted: false,
    setBy: 'owner',
  },
]

describe('the agent dock with two orchestrators', () => {
  it("shows a lane dock its sub's sector", async () => {
    await withDom(async ({ container, dom, root }) => {
      dom.window.localStorage.setItem('machineroom.guide', '1')
      dom.window.innerWidth = 1200
      await act(async () => {
        root.render(
          createElement(
            OrchestratorsContext.Provider,
            { value: TWO },
            createElement(Hud, {
              snapshot: SNAPSHOT,
              project: 'app',
              mode: 'live',
              liveAvailable: true,
              client: {},
              health: { ok: true, orchestrator: true },
              speeds: [1],
              onMode: () => {},
              focused: { key: 'opencode', name: 'OpenCode', status: 'idle' },
            })
          )
        )
      })
      await settle()

      const dock = container.querySelector('.agent-dock')
      expect(dock).not.toBeNull()
      const text = dock.textContent
      expect(text).toContain('OpenCode')
      expect(text).toContain('Sector')
      expect(text).toContain('Frontend')
      expect(text).toContain('Scope')
      expect(text).toContain('src/ui/**')
    })
  })
})
