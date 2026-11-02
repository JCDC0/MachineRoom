import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import Sidebar from '../src/ui/Sidebar.jsx'
import { buttonWithText, click, settle, withDom } from './helpers/uiDom.js'

const NOW = Date.now()

function sessionsAnswer() {
  return {
    current: { title: 'Current', startedAt: NOW },
    sessions: [
      { id: 'alpha', title: 'Alpha', endedAt: NOW - 1000, count: 2 },
      { id: 'beta', title: 'Beta', endedAt: NOW - 2000, count: 3 },
    ],
  }
}

function makeClient(overrides = {}) {
  const calls = { opened: [] }
  const client = {
    calls,
    projects: async () => ({ current: { path: 'C:\\project' }, recent: [] }),
    orchestratorSessions: async () => sessionsAnswer(),
    orchestratorSession: async () => ({ title: 'Alpha', messages: [] }),
    openOrchestratorSession: async (payload) => {
      calls.opened.push(payload)
      return { ok: true }
    },
    ...overrides,
  }
  return client
}

async function mount(root, props) {
  await act(async () => {
    root.render(createElement(Sidebar, props))
  })
  await settle()
}

function rowByTitle(container, title) {
  return (
    container
      .querySelectorAll('.mr-side-session')
      .find((button) => button.querySelector('.mr-side-title')?.textContent === title) ?? null
  )
}

describe('a conversation list that cannot be read', () => {
  it('says the list is unavailable instead of loading it forever', async () => {
    const client = makeClient({
      orchestratorSessions: async () => {
        throw new Error('The bridge refused the read.')
      },
    })
    await withDom(async ({ container, root }) => {
      await mount(root, { client, live: true, project: 'C:\project' })
      expect(container.textContent).toContain('Conversations are not available.')
      expect(container.textContent).not.toContain('Loading conversations...')
    })
  })
})

describe('the conversation preview', () => {
  it('keeps the newest conversation when an older preview answers later', async () => {
    let answerAlpha = null
    const client = makeClient({
      orchestratorSession: ({ session }) => {
        if (session === 'alpha') {
          return new Promise((resolve) => {
            answerAlpha = () =>
              resolve({
                title: 'Alpha',
                messages: [{ id: 'a1', from: 'owner', text: 'Alpha message' }],
              })
          })
        }
        return Promise.resolve({
          title: 'Beta',
          messages: [{ id: 'b1', from: 'owner', text: 'Beta message' }],
        })
      },
    })

    await withDom(async ({ container, root }) => {
      await mount(root, { client, live: true })

      const alpha = rowByTitle(container, 'Alpha')
      const beta = rowByTitle(container, 'Beta')
      expect(alpha).not.toBeNull()
      expect(beta).not.toBeNull()

      await click(root, alpha)
      await click(root, buttonWithText(container, 'Back'))
      await click(root, rowByTitle(container, 'Beta'))
      await settle()

      expect(container.querySelector('.mr-side-preview-title').textContent).toBe('Beta')
      expect(container.querySelector('.mr-side-message-text').textContent).toBe('Beta message')

      await act(async () => {
        answerAlpha()
      })
      await settle()

      expect(container.querySelector('.mr-side-preview-title').textContent).toBe('Beta')
      expect(container.querySelector('.mr-side-message-text').textContent).toBe('Beta message')

      await click(root, buttonWithText(container, 'Continue this conversation'))
      await click(root, buttonWithText(container, 'Continue'))
      await settle()

      expect(client.calls.opened).toEqual([
        { id: 'orchestrator', session: 'beta', confirmed: true },
      ])
    })
  })

  it('keeps the newest preview when an older read fails later', async () => {
    let failAlpha = null
    const client = makeClient({
      orchestratorSession: ({ session }) => {
        if (session === 'alpha') {
          return new Promise((resolve, reject) => {
            failAlpha = () => reject(new Error('Alpha is gone.'))
          })
        }
        return Promise.resolve({
          title: 'Beta',
          messages: [{ id: 'b1', from: 'owner', text: 'Beta message' }],
        })
      },
    })

    await withDom(async ({ container, root }) => {
      await mount(root, { client, live: true })

      await click(root, rowByTitle(container, 'Alpha'))
      await click(root, buttonWithText(container, 'Back'))
      await click(root, rowByTitle(container, 'Beta'))
      await settle()

      await act(async () => {
        failAlpha()
      })
      await settle()

      expect(container.querySelector('.mr-side-preview-title').textContent).toBe('Beta')
      expect(container.querySelector('.mr-side-message-text').textContent).toBe('Beta message')
      expect(container.querySelector('.mr-side-error')).toBeNull()
    })
  })
})

describe('the Projects tab in a replay', () => {
  it('does not offer Open folder when the room is not live', async () => {
    await withDom(async ({ container, root }) => {
      await mount(root, { client: makeClient(), live: false })
      await click(root, buttonWithText(container, 'Projects'))
      expect(container.querySelector('.mr-side-open-folder')).toBeNull()
    })
  })

  it('offers Open folder when the room is live and sends the event', async () => {
    await withDom(async ({ container, dom, root }) => {
      await mount(root, { client: makeClient(), live: true })
      await click(root, buttonWithText(container, 'Projects'))

      const open = container.querySelector('.mr-side-open-folder')
      expect(open).not.toBeNull()

      const seen = []
      function onProjects(event) {
        seen.push(event.type)
      }
      dom.window.addEventListener('machineroom:projects', onProjects)
      try {
        await click(root, open)
        expect(seen).toEqual(['machineroom:projects'])
      } finally {
        dom.window.removeEventListener('machineroom:projects', onProjects)
      }
    })
  })
})
