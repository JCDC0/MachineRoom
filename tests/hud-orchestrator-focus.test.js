import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import Hud from '../src/ui/Hud.jsx'
import { OrchestratorsContext } from '../src/ui/Transport.jsx'
import { click, settle, withDom } from './helpers/uiDom.js'

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

const LIST = [
  { id: 'orchestrator', name: 'Orchestrator', state: 'idle' },
  { id: 'frontend', name: 'Frontend', state: 'idle' },
]

function makeClient() {
  return {
    orchestrators: async () => LIST,
    orchestrator: async () => ({ state: 'idle', messages: [] }),
    orchestratorSessions: async () => ({ current: { title: 'Live one' }, sessions: [] }),
    lanes: async () => ({ lanes: [], max: 4, chosen: true }),
    subscribe: () => () => {},
  }
}

function orchestratorButton(container) {
  return (
    container
      .querySelectorAll('.hud-action')
      .find((button) => button.textContent.includes('Orchestrator')) ?? null
  )
}

async function mount(root, client) {
  await act(async () => {
    root.render(
      createElement(
        OrchestratorsContext.Provider,
        { value: LIST },
        createElement(Hud, {
          snapshot: SNAPSHOT,
          project: 'app',
          mode: 'live',
          liveAvailable: true,
          client,
          health: { ok: true, orchestrator: true },
          speeds: [1],
          onMode: () => {},
        })
      )
    )
  })
  await settle()
}

describe('the ORCHESTRATOR control at 900 pixels and wider', () => {
  it('scrolls to the chat and focuses its input from the menu button', async () => {
    await withDom(async ({ container, dom, root }) => {
      dom.window.localStorage.setItem('machineroom.guide', '1')
      dom.window.innerWidth = 1200
      await mount(root, makeClient())

      const main = container.querySelector('.hud-lower-main')
      const input = container.querySelector('.mr-orch-input')
      const button = orchestratorButton(container)
      expect(main).not.toBeNull()
      expect(input).not.toBeNull()
      expect(button).not.toBeNull()

      let scrolled = 0
      main.scrollIntoView = () => {
        scrolled += 1
      }

      await click(root, button)
      await settle()

      expect(scrolled).toBe(1)
      expect(dom.document.activeElement).toBe(input)
    })
  })

  it('scrolls to the chat and focuses its input from the / key', async () => {
    await withDom(async ({ container, dom, root }) => {
      dom.window.localStorage.setItem('machineroom.guide', '1')
      dom.window.innerWidth = 1200
      await mount(root, makeClient())

      const main = container.querySelector('.hud-lower-main')
      const input = container.querySelector('.mr-orch-input')
      let scrolled = 0
      main.scrollIntoView = () => {
        scrolled += 1
      }

      await act(async () => {
        dom.window.dispatchEvent({ type: 'keydown', key: '/', bubbles: true, cancelable: true })
      })
      await settle()

      expect(scrolled).toBe(1)
      expect(dom.document.activeElement).toBe(input)
    })
  })
})
