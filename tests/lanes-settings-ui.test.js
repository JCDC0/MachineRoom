import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import LanesSettings from '../src/ui/LanesSettings.jsx'
import { buttonWithText, click, settle, withDom } from './helpers/uiDom.js'

function makeClient() {
  const calls = { showLane: [], deleteLane: [] }
  const lanes = [
    { key: 'opencode', name: 'OpenCode', hidden: false },
    { key: 'claude', name: 'Claude Code', hidden: true },
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

async function mount(root, client) {
  await act(async () => {
    root.render(createElement(LanesSettings, { client }))
  })
  await settle()
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
      const rows = container.querySelectorAll('.mr-lanes-row')
      expect(rows).toHaveLength(2)
      expect(rows[0].querySelector('.mr-lanes-name').textContent).toBe('OpenCode')
      expect(rows[0].querySelector('.mr-lanes-tag')).toBeNull()
      expect(rows[1].querySelector('.mr-lanes-tag').textContent).toBe('hidden here')
      expect(buttonWithText(rows[1], 'Show')).not.toBeNull()
      expect(buttonWithText(rows[0], 'Show')).toBeNull()
      expect(buttonWithText(rows[0], 'Delete everywhere')).not.toBeNull()
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

  it('deletes a lane everywhere behind its danger card', async () => {
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      await click(root, buttonWithText(container, 'Delete everywhere'))
      const card = container.querySelector('.mr-side-confirm-card')
      expect(card.textContent).toContain(
        'Delete OpenCode in every project? Its runs stay in the records.'
      )
      await click(root, buttonWithText(card, 'Delete everywhere'))
      expect(calls.deleteLane).toEqual([{ key: 'opencode', confirmed: true }])
    })
  })

  it('closes the card alone on Escape', async () => {
    const { client } = makeClient()
    await withDom(async ({ container, dom, root }) => {
      await mount(root, client)
      await click(root, buttonWithText(container, 'Delete everywhere'))
      expect(container.querySelector('.mr-side-confirm-card')).not.toBeNull()
      await act(async () => {
        dom.window.dispatchEvent({ type: 'keydown', key: 'Escape', bubbles: true, cancelable: true })
      })
      expect(container.querySelector('.mr-side-confirm-card')).toBeNull()
    })
  })
})
