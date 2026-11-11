import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import LanesSettings from '../src/ui/LanesSettings.jsx'
import { buttonWithText, click, settle, withDom } from './helpers/uiDom.js'

function makeClient() {
  const calls = { showLane: [], deleteLane: [] }
  const lanes = [
    { key: 'opencode', name: 'OpenCode', custom: false, hidden: false },
    { key: 'claude', name: 'Claude Code', custom: false, hidden: true },
    { key: 'helper', name: 'Helper', custom: true, hidden: false },
  ]
  const client = {
    lanes: async () => ({ lanes }),
    showLane: async (payload) => {
      calls.showLane.push(payload)
      lanes[1].hidden = false
      return { ok: true }
    },
    deleteLane: async (payload) => {
      calls.deleteLane.push(payload)
      return { ok: true }
    },
  }
  return { client, calls, lanes }
}

async function mount(root, client, props = {}) {
  await act(async () => {
    root.render(createElement(LanesSettings, { client, ...props }))
  })
  await settle()
}

function rowsOf(container) {
  return Array.from(container.querySelectorAll('.mr-lanes-row'))
}

describe('the Lanes section in Settings', () => {
  it('shows nothing without the lane methods', async () => {
    await withDom(async ({ container, root }) => {
      await mount(root, {})
      expect(container.querySelector('.mr-lanes')).toBeNull()
      await mount(root, { lanes: async () => ({ lanes: [] }) })
      expect(container.querySelector('.mr-lanes')).toBeNull()
    })
  })

  it('lists every lane and marks the ones hidden here', async () => {
    const { client } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      const rows = rowsOf(container)
      expect(rows).toHaveLength(3)
      expect(rows[0].querySelector('.mr-lanes-name').textContent).toBe('OpenCode')
      expect(rows[0].querySelector('.mr-lanes-tag')).toBeNull()
      expect(rows[1].querySelector('.mr-lanes-tag').textContent).toBe('hidden here')
      expect(buttonWithText(rows[1], 'Show')).not.toBeNull()
      expect(buttonWithText(rows[0], 'Show')).toBeNull()
      expect(buttonWithText(rows[0], 'Remove from project')).not.toBeNull()
      expect(buttonWithText(rows[2], 'Delete everywhere')).not.toBeNull()
    })
  })

  it('shows a hidden lane without a card', async () => {
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      await click(root, buttonWithText(container, 'Show'))
      expect(calls.showLane).toEqual([{ key: 'claude', confirmed: true }])
      expect(container.textContent).toContain('Shown Claude Code.')
      expect(container.querySelector('.mr-lanes-tag')).toBeNull()
    })
  })

  it('removes a lanes.json lane from this project behind its danger card', async () => {
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client, { project: '/work/machine-room' })
      const row = rowsOf(container)[0]
      await click(root, buttonWithText(row, 'Remove from project'))
      const card = container.querySelector('.mr-side-confirm-card')
      expect(card.textContent).toContain(
        'Remove OpenCode from machine-room? It stays in your other projects.'
      )
      await click(root, buttonWithText(card, 'Remove from project'))
      expect(calls.deleteLane).toEqual([{ key: 'opencode', confirmed: true }])
    })
  })

  it('deletes an owner-made lane everywhere behind its danger card', async () => {
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      const row = rowsOf(container)[2]
      await click(root, buttonWithText(row, 'Delete everywhere'))
      const card = container.querySelector('.mr-side-confirm-card')
      expect(card.textContent).toContain(
        'Delete Helper in every project? Its runs stay in the records.'
      )
      await click(root, buttonWithText(card, 'Delete everywhere'))
      expect(calls.deleteLane).toEqual([{ key: 'helper', confirmed: true }])
    })
  })

  it('closes the card alone on Escape', async () => {
    const { client } = makeClient()
    await withDom(async ({ container, dom, root }) => {
      await mount(root, client)
      await click(root, buttonWithText(container, 'Remove from project'))
      expect(container.querySelector('.mr-side-confirm-card')).not.toBeNull()
      await act(async () => {
        dom.window.dispatchEvent({ type: 'keydown', key: 'Escape', bubbles: true, cancelable: true })
      })
      expect(container.querySelector('.mr-side-confirm-card')).toBeNull()
    })
  })
})
