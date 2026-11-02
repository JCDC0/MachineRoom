import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import Launcher from '../src/ui/Launcher.jsx'
import SetupCard from '../src/ui/SetupCard.jsx'
import Sidebar from '../src/ui/Sidebar.jsx'
import ControlDrawer from '../src/ui/panels/ControlDrawer.jsx'
import { createMockClient } from '../src/control/mock.js'
import { click, settle, withDom } from './helpers/uiDom.js'

const LANES = [
  { key: 'opencode', name: 'OpenCode', harness: 'opencode', model: 'model-a', active: true },
  { key: 'claude', name: 'Claude', harness: 'claude', model: 'model-b', active: true },
]

const ANSWER = { lanes: LANES, max: 2, chosen: false }

async function press(window, key, shiftKey = false) {
  await act(async () => {
    window.dispatchEvent({ type: 'keydown', key, shiftKey, bubbles: true, cancelable: true })
  })
}

function openerFor(dom) {
  const opener = dom.document.createElement('button')
  opener.textContent = 'opener'
  dom.body.appendChild(opener)
  opener.focus()
  return opener
}

describe('dialog focus', () => {
  it('moves into the setup card, holds Tab and gives focus back', async () => {
    await withDom(async ({ container, root, dom, window }) => {
      const opener = openerFor(dom)
      await act(async () => {
        root.render(createElement(SetupCard, { answer: ANSWER }))
      })
      const card = container.querySelector('.mr-setup')
      const controls = card.querySelectorAll('button')
      const enabled = controls.filter((button) => button.getAttribute('disabled') == null)
      expect(dom.document.activeElement).toBe(enabled[0])

      enabled[enabled.length - 1].focus()
      await press(window, 'Tab')
      expect(dom.document.activeElement).toBe(enabled[0])

      enabled[0].focus()
      await press(window, 'Tab', true)
      expect(dom.document.activeElement).toBe(enabled[enabled.length - 1])

      const later = controls.find((button) => button.textContent.trim() === 'Later')
      await click(root, later)
      expect(container.querySelector('.mr-setup')).toBeNull()
      expect(dom.document.activeElement).toBe(opener)
    })
  })

  it('moves into the folder picker, holds Tab and gives focus back', async () => {
    const client = {
      projects: async () => ({ current: { path: 'C:\\work\\demo', git: false }, folders: [] }),
    }
    await withDom(async ({ container, root, dom, window }) => {
      const opener = openerFor(dom)
      await act(async () => {
        root.render(createElement(Launcher, { client, live: true }))
      })
      await settle()

      const panel = container.querySelector('.mr-launcher')
      expect(panel).not.toBeNull()
      const current = panel.querySelector('.mr-launcher-row.is-current')
      expect(dom.document.activeElement).toBe(current)

      const controls = panel.querySelectorAll('button')
      controls[controls.length - 1].focus()
      await press(window, 'Tab')
      expect(dom.document.activeElement).toBe(controls[0])

      const close = controls.find((button) => button.textContent.trim() === 'Close')
      await click(root, close)
      expect(container.querySelector('.mr-launcher')).toBeNull()
      expect(dom.document.activeElement).toBe(opener)
    })
  })

  it('moves into the sidebar confirm and gives focus back', async () => {
    const client = {
      projects: async () => ({ current: { path: 'C:\\project' }, recent: [] }),
      orchestratorSessions: async () => ({
        current: { title: 'Current', startedAt: Date.now() },
        sessions: [],
      }),
      newOrchestratorSession: async () => ({ ok: true }),
    }
    await withDom(async ({ container, root, dom, window }) => {
      await act(async () => {
        root.render(createElement(Sidebar, { client, live: true, project: 'demo' }))
      })
      await settle()

      const opener = container
        .querySelectorAll('button')
        .find((button) => button.textContent.includes('New conversation'))
      expect(opener).not.toBeNull()
      opener.focus()
      await click(root, opener)

      const card = container.querySelector('.mr-side-confirm')
      expect(card).not.toBeNull()
      const controls = card.querySelectorAll('button')
      expect(dom.document.activeElement).toBe(controls[0])

      controls[controls.length - 1].focus()
      await press(window, 'Tab')
      expect(dom.document.activeElement).toBe(controls[0])

      const cancel = controls.find((button) => button.textContent.trim() === 'Cancel')
      await click(root, cancel)
      expect(container.querySelector('.mr-side-confirm')).toBeNull()
      expect(dom.document.activeElement).toBe(opener)
    })
  })

  it('moves focus into the control drawer and gives it back when it closes', async () => {
    const client = createMockClient({ latencyMs: 0 })
    await withDom(async ({ container, root, dom }) => {
      const opener = dom.document.createElement('button')
      opener.setAttribute('aria-controls', 'hud-control-drawer')
      dom.body.appendChild(opener)
      opener.focus()

      await act(async () => {
        root.render(createElement(ControlDrawer, { client, open: true, activeTab: 'reviews', onClose: () => {} }))
      })
      const tab = container.querySelector('#tab-reviews')
      expect(tab).not.toBeNull()
      expect(dom.document.activeElement).toBe(tab)

      await act(async () => {
        root.render(createElement(ControlDrawer, { client, open: false, activeTab: 'reviews', onClose: () => {} }))
      })
      expect(dom.document.activeElement).toBe(opener)
    })
  })
})
