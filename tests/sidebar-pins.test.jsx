import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import Sidebar from '../src/ui/Sidebar.jsx'
import { click, settle, type, withDom } from './helpers/uiDom.js'

async function mount(root) {
  const calls = []
  const state = {
    current: { id: 'current', title: 'Current', startedAt: 30 },
    sessions: [
      { id: 'alpha', title: 'Alpha', endedAt: 20 },
      { id: 'beta', title: 'Beta', endedAt: 10 },
    ],
  }
  const client = {
    projects: async () => ({ current: { path: 'C:\\project' }, recent: [] }),
    orchestratorSessions: async () => JSON.parse(JSON.stringify(state)),
    updateOrchestratorSession: async (payload) => {
      calls.push(payload)
      Object.assign(state.sessions.find((row) => row.id === payload.session), { pinned: payload.pinned, starred: payload.starred })
    },
  }
  await act(async () => root.render(createElement(Sidebar, { client, live: true, project: 'C:\\project' })))
  await settle()
  return { calls, state }
}

function labels(container) {
  return container.querySelectorAll('.mr-side-group').map((node) => node.textContent)
}

function titles(container) {
  return container.querySelectorAll('.mr-side-title').map((node) => node.textContent)
}

describe('conversation pins', () => {
  it('pins and unpins a row, moving it into the labelled group', async () => {
    await withDom(async ({ container, root }) => {
      const { calls } = await mount(root)
      expect(labels(container)).toEqual([])
      const pin = container.querySelector('button[aria-label="Pin Beta"]')
      expect(pin.getAttribute('aria-pressed')).toBe('false')
      await click(root, pin)
      await settle()
      expect(calls[0]).toMatchObject({ session: 'beta', pinned: true })
      expect(titles(container)).toEqual(['Current', 'Beta', 'Alpha'])
      expect(labels(container)).toEqual(['Pinned', 'Recent'])
      const unpin = container.querySelector('button[aria-label="Unpin Beta"]')
      expect(unpin.getAttribute('aria-pressed')).toBe('true')
      await click(root, unpin)
      await settle()
      expect(calls[1]).toMatchObject({ session: 'beta', pinned: false })
      expect(labels(container)).toEqual([])
    })
  })

  it('hides group labels when search leaves only one group', async () => {
    await withDom(async ({ container, root }) => {
      await mount(root)
      await click(root, container.querySelector('button[aria-label="Pin Beta"]'))
      await settle()
      await type(root, container.querySelector('.mr-side-search'), 'Beta')
      expect(titles(container)).toEqual(['Beta'])
      expect(labels(container)).toEqual([])
      await type(root, container.querySelector('.mr-side-search'), 'Alpha')
      expect(titles(container)).toEqual(['Alpha'])
      expect(labels(container)).toEqual([])
    })
  })
})
