import { readFileSync } from 'node:fs'
import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { agentColors, cssColor } from '../src/engine/sprites.js'
import Hud from '../src/ui/Hud.jsx'
import { OrchestratorsContext } from '../src/ui/Transport.jsx'
import { OPEN_CHAT_EVENT } from '../src/ui/transportOrchestrators.js'
import { buttonWithText, click, settle, type, withDom } from './helpers/uiDom.js'

const SNAPSHOT = {
  position: 0,
  duration: 0,
  playing: false,
  speed: 1,
  live: true,
  status: 'live',
  agents: [
    { key: 'orchestrator', name: 'Orchestrator', status: 'idle', depth: 0 },
    { key: 'claude', name: 'Claude', status: 'idle', depth: 0 },
    { key: 'opencode', name: 'OpenCode', status: 'idle', depth: 0 },
    { key: 'sub-frontend', name: 'Frontend', status: 'idle', depth: 0 },
    { key: 'claude-child', name: 'Claude child', status: 'idle', parent: 'claude', depth: 1 },
  ],
  log: [],
}

const LIST = [
  { id: 'orchestrator', name: 'Orchestrator', state: 'idle' },
  { id: 'frontend', name: 'Frontend', state: 'idle' },
]

const LANES = [
  { key: 'opencode', name: 'OpenCode', harness: 'opencode', active: true },
  { key: 'claude', name: 'Claude', harness: 'claude', active: true },
]

const TWO = [
  { id: 'orchestrator', name: 'Orchestrator', state: 'idle' },
  {
    id: 'frontend',
    name: 'Frontend',
    state: 'idle',
    lanes: ['opencode'],
    scope: ['src/ui/**'],
    restricted: true,
    setBy: 'owner',
  },
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

function toMenu(container) {
  return container.querySelector('select[aria-label="To"]')
}

async function chooseRecipient(container, value) {
  const select = toMenu(container)
  await act(async () => {
    select.value = value
    select.dispatchEvent({ type: 'change', bubbles: true })
  })
}

async function openLane(dom, lane) {
  await act(async () => {
    dom.window.dispatchEvent(new dom.window.CustomEvent(OPEN_CHAT_EVENT, { detail: { lane } }))
  })
}

async function mount(root, client, { orchestrators = LIST, ...props } = {}) {
  await act(async () => {
    root.render(
      createElement(
        OrchestratorsContext.Provider,
        { value: orchestrators },
        createElement(Hud, {
          snapshot: SNAPSHOT,
          project: 'app',
          mode: 'live',
          liveAvailable: true,
          client,
          health: { ok: true, orchestrator: true },
          speeds: [1],
          onMode: () => {},
          ...props,
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

  it('scrolls to the chat and focuses its input from the band name', async () => {
    await withDom(async ({ container, dom, root }) => {
      dom.window.localStorage.setItem('machineroom.guide', '1')
      dom.window.innerWidth = 1200
      await mount(root, makeClient())

      const main = container.querySelector('.hud-lower-main')
      const input = container.querySelector('.mr-orch-input')
      const name = container.querySelector('.hud-band-switch')
      expect(name).not.toBeNull()
      let scrolled = 0
      main.scrollIntoView = () => {
        scrolled += 1
      }

      await click(root, name)
      await settle()

      expect(scrolled).toBe(1)
      expect(dom.document.activeElement).toBe(input)
    })
  })

  it('follows Team, an Agents lane and a To lane from the band', async () => {
    await withDom(async ({ container, dom, root }) => {
      dom.window.localStorage.setItem('machineroom.guide', '1')
      dom.window.innerWidth = 1200
      await mount(root, {
        ...makeClient(),
        lanes: async () => ({ lanes: LANES, chosen: true }),
        sendOrchestrator: async () => {},
      })

      const band = container.querySelector('.hud-band-switch')
      const expectView = (name) => {
        expect(band.textContent).toBe(name)
        expect(band.getAttribute('aria-label')).toBe(`${name} conversation, show the chat`)
      }
      let scrolled = 0
      container.querySelector('.hud-lower-main').scrollIntoView = () => { scrolled += 1 }
      await click(root, buttonWithText(container.querySelector('.mr-orch-tabs'), 'Frontend'))
      expectView('Frontend')
      await click(root, buttonWithText(container.querySelector('.mr-orch-tabs'), 'Team'))
      expectView('Team')
      await click(root, band)
      expect(container.querySelector('[aria-label="Every orchestrator chat"]')).not.toBeNull()
      expect(container.querySelector('.mr-orch-input')).toBeNull()

      await openLane(dom, 'opencode')
      expectView('OpenCode')
      await click(root, band)
      expect(dom.document.activeElement).toBe(container.querySelector('[aria-label="Message OpenCode"]'))
      await chooseRecipient(container, 'orchestrator')
      expectView('Main')
      await chooseRecipient(container, 'claude')
      expectView('Claude')
      await click(root, band)
      expect(dom.document.activeElement).toBe(container.querySelector('[aria-label="Message Claude"]'))
      expect(scrolled).toBe(3)
    })
  })

  it('focuses the floating replay composer on the first and each later band click', async () => {
    await withDom(async ({ container, dom, root }) => {
      dom.window.localStorage.setItem('machineroom.guide', '1')
      dom.window.innerWidth = 1200
      await mount(root, {
        ...makeClient(),
        lanes: async () => ({ lanes: LANES, chosen: true }),
      }, { mode: 'replay' })

      const band = container.querySelector('.hud-band-switch')
      expect(container.querySelector('.mr-orch-input')).toBeNull()
      await click(root, band)
      await settle(25)
      const chat = container.querySelector('#hud-orchestrator-chat')
      expect(chat).not.toBeNull()
      const input = chat.querySelector('textarea')
      expect(dom.document.activeElement).toBe(input)
      band.focus()
      expect(dom.document.activeElement).toBe(band)
      await click(root, band)
      expect(dom.document.activeElement).toBe(input)

      await chooseRecipient(container, 'opencode')
      expect(band.textContent).toBe('OpenCode')
      band.focus()
      await click(root, band)
      expect(dom.document.activeElement.getAttribute('aria-label')).toBe('Message OpenCode')
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

  it('shows a sub dock the lanes, scope, restriction and setter from the full orchestrator list', async () => {
    await withDom(async ({ container, dom, root }) => {
      dom.window.localStorage.setItem('machineroom.guide', '1')
      dom.window.innerWidth = 1200
      await mount(root, makeClient(), {
        orchestrators: TWO,
        focused: { key: 'sub-frontend', name: 'Frontend', status: 'idle' },
      })

      const dock = container.querySelector('.agent-dock')
      expect(dock).not.toBeNull()
      const text = dock.textContent
      expect(text).toContain('Frontend')
      expect(text).toContain('Lanes')
      expect(text).toContain('opencode')
      expect(text).toContain('Scope')
      expect(text).toContain('src/ui/**')
      expect(text).toContain('Restricted')
      expect(text).toContain('yes')
      expect(text).toContain('Set by')
      expect(text).toContain('owner')
    })
  })
})

describe('chat recipients and colours', () => {
  it.each([1200, 800])('sends to a sub chosen from an Agents row at %i pixels wide', async (width) => {
    await withDom(async ({ container, dom, root }) => {
      dom.window.innerWidth = width
      dom.window.localStorage.setItem('machineroom.guide', '1')
      dom.window.localStorage.setItem('machineroom.settings', JSON.stringify({ sidebarTab: 'agents' }))
      const sent = []
      await mount(root, {
        ...makeClient(),
        family: async () => ({ nodes: [
          { id: 'orchestrator', kind: 'orchestrator', label: 'Orchestrator', children: ['opencode'] },
          { id: 'opencode', kind: 'lane', label: 'OpenCode', parent: 'orchestrator', active: true },
        ] }),
        lanes: async () => ({ lanes: LANES, chosen: true }),
        sendOrchestrator: async (text, options) => sent.push({ text, options }),
      })
      if (width < 900) await click(root, buttonWithText(container, 'Sessions'))
      const row = container.querySelector('[title="Open conversation with OpenCode"]')
      expect(row).not.toBeNull()
      await click(root, row)
      expect(container.querySelector('[aria-label="OpenCode conversation"]')).not.toBeNull()

      await chooseRecipient(container, 'frontend')
      expect(container.querySelector('.mr-orch-tab.is-active').textContent).toBe('Frontend')
      const input = container.querySelector('.mr-orch-input')
      await type(root, input, 'Build the header.')
      await act(async () => {
        container.querySelector('.mr-orch-form').dispatchEvent({ type: 'submit', bubbles: true, cancelable: true })
      })
      expect(sent).toEqual([{ text: 'Build the header.', options: { id: 'frontend' } }])
    })
  })

  it('applies agents notices and empty results to both To menus and clears an unavailable choice', async () => {
    await withDom(async ({ container, dom, root }) => {
      dom.window.innerWidth = 1200
      dom.window.localStorage.setItem('machineroom.guide', '1')
      let lanes = LANES
      const listeners = new Set()
      const publish = async (topic) => {
        await act(async () => { for (const listener of listeners) listener({ topic }) })
        await settle()
      }
      const options = () => toMenu(container).querySelectorAll('option').map((item) => item.getAttribute('value'))
      await mount(root, {
        ...makeClient(),
        lanes: async () => ({ lanes, chosen: true }),
        sendOrchestrator: async () => {},
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      })
      await openLane(dom, 'opencode')
      expect(options()).toContain('claude')

      lanes = LANES.map((lane) => lane.key === 'claude' ? { ...lane, active: false } : lane)
      await publish('agents')
      expect(options()).toEqual(['orchestrator', 'frontend', 'opencode'])
      await click(root, buttonWithText(container, 'Back'))
      expect(options()).toEqual(['orchestrator', 'frontend', 'opencode'])
      await chooseRecipient(container, 'opencode')
      expect(container.querySelector('[aria-label="OpenCode conversation"]')).not.toBeNull()

      lanes = []
      await publish('family')
      expect(container.querySelector('[aria-label="OpenCode conversation"]')).toBeNull()
      expect(container.querySelector('.mr-orch-input').getAttribute('aria-label')).toBe('Message to the orchestrator')
      expect(options()).toEqual(['orchestrator', 'frontend'])
      lanes = LANES
      await publish('agents')
      expect(container.querySelector('[aria-label="OpenCode conversation"]')).toBeNull()
      expect(options()).toContain('opencode')

      await openLane(dom, 'opencode')
      lanes = []
      await publish('agents')
      expect(toMenu(container)).toBeNull()
      expect(container.querySelector('[aria-label="Message OpenCode"]')).toBeNull()
    })
  })

  it('uses room colours in both chat views and places dots before the senders', async () => {
    await withDom(async ({ container, dom, root }) => {
      dom.window.innerWidth = 1200
      dom.window.localStorage.setItem('machineroom.guide', '1')
      await mount(root, {
        ...makeClient(),
        lanes: async () => ({ lanes: LANES, chosen: true }),
        orchestrator: async () => ({ state: 'idle', messages: [
          { id: 'lane-1', from: 'lane:claude', text: 'Ready.' },
          { id: 'agent-1', from: 'agent', agent: { from: 'sub:frontend' }, text: 'Frontend to Claude, order: Build it.' },
        ] }),
      })
      const colors = agentColors(SNAPSHOT.agents.filter((agent) => !agent.parent)).map(cssColor)
      const sender = container.querySelector('.mr-orch-line.is-lane').querySelector('.mr-orch-who')
      expect(sender.textContent).toBe('Claude')
      expect(sender.firstChild.style.background).toBe(colors[1])
      const agent = container.querySelector('.mr-orch-line.is-agent').querySelector('.mr-orch-blocks')
      expect(agent.firstChild.style.background).toBe(colors[3])
      expect(agent.children[1].textContent).toContain('Frontend to Claude')

      await openLane(dom, 'claude')
      const crumb = container.querySelector('.mr-lane-conv-crumb')
      expect(crumb.querySelector('.mr-agent-dot').style.background).toBe(colors[1])
      await openLane(dom, 'claude-child')
      expect(container.querySelector('.mr-lane-conv-crumb').querySelector('.mr-agent-dot').style.background).toBe(colors[1])
      const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
      expect(css).toMatch(/\.mr-orch-line\.is-agent[^{}]*\.mr-orch-block:first-of-type\s*\{\s*display:\s*inline/)
      expect(css).toMatch(/\.mr-orch-line\.is-lane > \.mr-orch-who[^{}]*\{\s*color:\s*var\(--white\)/)
    })
  })
})
