import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import Sidebar from '../src/ui/Sidebar.jsx'
import { buttonWithText, click, settle, type, withDom } from './helpers/uiDom.js'

const NOW = Date.now()

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function messages(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `m${index + 1}`,
    from: 'owner',
    text: `Message ${index + 1}`,
  }))
}

function makeClient(overrides = {}) {
  const calls = { update: [], open: [], branch: [], delete: [], new: [] }
  const listeners = new Set()
  const state = {
    current: { id: 'current', title: 'Live one', startedAt: NOW, count: 2 },
    sessions: [
      { id: 'alpha', title: 'Alpha', endedAt: NOW - 2000, count: 2 },
      { id: 'beta', title: 'Beta', endedAt: NOW - 1000, count: 3, pinned: true },
      { id: 'zulu', title: 'Zulu', endedAt: NOW - 3000, count: 1 },
      { id: 'old', title: 'Old', endedAt: NOW - 4000, count: 1, archived: true },
    ],
  }

  function findSession(id) {
    return state.sessions.find((session) => session.id === id) ?? null
  }

  const client = {
    calls,
    state,
    projects: async () => ({ current: { path: 'C:\\project' }, recent: [] }),
    orchestratorSessions: async () => clone(state),
    orchestrator: async () => ({
      id: 'orchestrator',
      messages: messages(state.current.count),
    }),
    orchestratorSession: async ({ session }) => {
      const found = findSession(session)
      return { title: found?.title ?? '', messages: messages(found?.count ?? 0) }
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    notify: (notice = { topic: 'orchestrator' }) => {
      for (const listener of [...listeners]) listener(notice)
    },
    updateOrchestratorSession: async (payload) => {
      calls.update.push(payload)
      const found = payload.session === 'current' ? state.current : findSession(payload.session)
      if (found) {
        for (const field of ['pinned', 'starred', 'unread', 'archived', 'title']) {
          if (payload[field] !== undefined) found[field] = payload[field]
        }
      }
      return { ok: true }
    },
    openOrchestratorSession: async (payload) => {
      calls.open.push(payload)
      const found = findSession(payload.session)
      if (found) {
        state.current = { id: 'current', title: found.title, startedAt: NOW, count: found.count }
        found.unread = false
        found.archived = false
      }
      return { ok: true }
    },
    branchOrchestratorSession: async (payload) => {
      calls.branch.push(payload)
      return { ok: true, title: 'Branch', count: payload.index }
    },
    deleteOrchestratorSession: async (payload) => {
      calls.delete.push(payload)
      state.sessions = state.sessions.filter((session) => session.id !== payload.session)
      return { ok: true }
    },
    newOrchestratorSession: async () => {
      calls.new.push(true)
      return { ok: true }
    },
    ...overrides,
  }
  return client
}

async function mount(root, client) {
  await act(async () => {
    root.render(createElement(Sidebar, { client, live: true, project: 'C:\\project' }))
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

function menuButton(container, title) {
  return container.querySelector(`button[aria-label="Actions for ${title}"]`)
}

async function openMenu(root, container, title) {
  const button = menuButton(container, title)
  expect(button).not.toBeNull()
  await click(root, button)
  const menu = container.querySelector('.mr-side-menu')
  expect(menu).not.toBeNull()
  return menu
}

function menuItem(container, label) {
  return container
    .querySelectorAll('[role="menuitem"]')
    .find((button) => button.querySelector('.mr-side-menu-label')?.textContent === label) ?? null
}

async function press(root, window, key) {
  await act(async () => {
    window.dispatchEvent({ type: 'keydown', key, bubbles: true, cancelable: true })
  })
  await settle()
}

function titles(container) {
  return container
    .querySelectorAll('.mr-side-title')
    .map((node) => node.textContent)
}

describe('the conversation menu', () => {
  it('opens from the row button with every item and its key, and Escape closes it', async () => {
    await withDom(async ({ container, dom, root }) => {
      await mount(root, makeClient())
      await openMenu(root, container, 'Alpha')

      expect(container.querySelectorAll('[role="menuitem"]')).toHaveLength(6)
      expect(container.querySelector('.mr-side-menu').textContent).toContain('Pin')
      expect(container.querySelector('.mr-side-menu').textContent).toContain('Mark as unread')
      expect(container.querySelector('.mr-side-menu-key').textContent).toBe('P')

      await press(root, dom.window, 'Escape')
      expect(container.querySelector('.mr-side-menu')).toBeNull()
    })
  })

  it('runs Pin, Rename, Fork, Mark as unread, Archive and Delete from their keys', async () => {
    for (const key of ['p', 'r', 'f', 'u', 'a', 'd']) {
      await withDom(async ({ container, dom, root }) => {
        const client = makeClient()
        await mount(root, client)
        await openMenu(root, container, 'Alpha')
        await press(root, dom.window, key)

        if (key === 'p') {
          expect(client.calls.update[0]).toMatchObject({ session: 'alpha', pinned: true })
        } else if (key === 'r') {
          expect(container.querySelector('.mr-side-rename-input')?.getAttribute('aria-label')).toBe('Rename Alpha')
        } else if (key === 'f') {
          expect(client.calls.open[0]).toMatchObject({ session: 'alpha' })
          expect(client.calls.branch[0]).toMatchObject({ index: 2 })
        } else if (key === 'u') {
          expect(client.calls.update[0]).toMatchObject({ session: 'alpha', unread: true })
        } else if (key === 'a') {
          expect(client.calls.update[0]).toMatchObject({ session: 'alpha', archived: true })
        } else {
          expect(container.querySelector('.mr-side-confirm')).not.toBeNull()
        }
      })
    }
  })

  it('renames a row from the menu and sends the new title', async () => {
    await withDom(async ({ container, root }) => {
      const client = makeClient()
      await mount(root, client)
      await openMenu(root, container, 'Alpha')
      await click(root, menuItem(container, 'Rename'))

      const input = container.querySelector('.mr-side-rename-input')
      expect(input).not.toBeNull()
      await type(root, input, 'Alpha renamed')
      const form = container.querySelector('.mr-side-rename')
      await act(async () => {
        form.dispatchEvent({ type: 'submit', bubbles: true, cancelable: true })
      })
      await settle()

      expect(client.calls.update[0]).toMatchObject({ session: 'alpha', title: 'Alpha renamed' })
    })
  })

  it('deletes a row after its confirm', async () => {
    await withDom(async ({ container, root }) => {
      const client = makeClient()
      await mount(root, client)
      await openMenu(root, container, 'Alpha')
      await click(root, menuItem(container, 'Delete'))
      expect(container.querySelector('.mr-side-confirm')).not.toBeNull()

      await click(root, buttonWithText(container, 'Delete'))
      await settle()
      expect(client.calls.delete[0]).toMatchObject({ session: 'alpha' })
    })
  })

  it('forks a row by opening it and branching at its last message', async () => {
    await withDom(async ({ container, root }) => {
      const client = makeClient()
      await mount(root, client)
      await openMenu(root, container, 'Alpha')
      await click(root, menuItem(container, 'Fork'))
      await settle()

      expect(client.calls.open[0]).toMatchObject({ id: 'orchestrator', session: 'alpha', confirmed: true })
      expect(client.calls.branch[0]).toMatchObject({ id: 'orchestrator', index: 2, confirmed: true })
    })
  })

  it('forks the current conversation at the live count when the list is out of date', async () => {
    await withDom(async ({ container, root }) => {
      const client = makeClient()
      client.orchestrator = async () => ({ id: 'orchestrator', messages: messages(4) })
      await mount(root, client)
      await openMenu(root, container, 'Live one')
      await click(root, menuItem(container, 'Fork'))
      await settle()

      expect(client.calls.branch[0]).toMatchObject({ index: 4, confirmed: true })
    })
  })

  it('forks a saved conversation at the count the bridge returns', async () => {
    await withDom(async ({ container, root }) => {
      const client = makeClient()
      client.orchestratorSession = async ({ session }) => ({
        title: session,
        messages: messages(session === 'alpha' ? 5 : 0),
      })
      await mount(root, client)
      await openMenu(root, container, 'Alpha')
      await click(root, menuItem(container, 'Fork'))
      await settle()

      expect(client.calls.open[0]).toMatchObject({ session: 'alpha' })
      expect(client.calls.branch[0]).toMatchObject({ index: 5, confirmed: true })
    })
  })

  it('refreshes the counts when a chat turn ends and enables Fork', async () => {
    await withDom(async ({ container, dom, root }) => {
      const client = makeClient()
      client.state.current.count = 0
      client.orchestrator = async () => ({ id: 'orchestrator', messages: [] })
      await mount(root, client)
      await openMenu(root, container, 'Live one')
      expect(menuItem(container, 'Fork').hasAttribute('disabled')).toBe(true)

      client.state.current.count = 4
      client.orchestrator = async () => ({ id: 'orchestrator', messages: messages(4) })
      await act(async () => {
        client.notify()
      })
      await settle(250)
      expect(menuItem(container, 'Fork').hasAttribute('disabled')).toBe(false)

      await press(root, dom.window, 'f')
      expect(client.calls.branch[0]).toMatchObject({ index: 4, confirmed: true })
    })
  })

  it('closes the menu and releases P when its row leaves the list or stops being current', async () => {
    for (const hidden of [true, false]) {
      await withDom(async ({ container, dom, root }) => {
        const client = makeClient()
        if (hidden) {
          client.state.sessions = Array.from({ length: 6 }, (_, index) => ({
            id: `pinned-${index}`,
            title: `Pinned ${index}`,
            pinned: true,
            count: 1,
          }))
        }
        const roomKeys = []
        dom.window.addEventListener('keydown', (event) => roomKeys.push(event.key))
        await mount(root, client)
        await openMenu(root, container, 'Live one')

        client.state.sessions.push({ ...client.state.current, id: 'live-one', endedAt: NOW })
        client.state.current = { id: 'current', title: 'Live two', startedAt: NOW, count: 3 }
        await act(async () => {
          client.notify()
        })
        await settle(250)

        expect(rowByTitle(container, 'Live one') === null).toBe(hidden)
        expect(container.querySelector('.mr-side-menu')).toBeNull()
        await press(root, dom.window, 'P')
        expect(client.calls.update).toHaveLength(0)
        expect(client.calls.open).toHaveLength(0)
        expect(client.calls.branch).toHaveLength(0)
        expect(roomKeys).toEqual(['P'])
      })
    }
  })

  it('pins and renames the current row from its menu', async () => {
    await withDom(async ({ container, root }) => {
      const client = makeClient()
      await mount(root, client)
      await openMenu(root, container, 'Live one')
      await click(root, menuItem(container, 'Pin'))
      await settle()
      expect(client.calls.update[0]).toMatchObject({ session: 'current', pinned: true })

      await openMenu(root, container, 'Live one')
      await click(root, menuItem(container, 'Rename'))
      const input = container.querySelector('.mr-side-rename-input')
      expect(input?.getAttribute('aria-label')).toBe('Rename Live one')
      await type(root, input, 'Live renamed')
      await act(async () => {
        container.querySelector('.mr-side-rename').dispatchEvent({
          type: 'submit',
          bubbles: true,
          cancelable: true,
        })
      })
      await settle()
      expect(client.calls.update[1]).toMatchObject({ session: 'current', title: 'Live renamed' })
    })
  })

  it('keeps the room shortcuts and later capture handlers from reading a menu key', async () => {
    await withDom(async ({ container, dom, root }) => {
      const roomKeys = []
      dom.window.addEventListener('keydown', (event) => {
        if (event.key === 'f' || event.key === 'F') roomKeys.push(event.key)
      })
      await mount(root, makeClient())
      await openMenu(root, container, 'Alpha')

      let laterCapture = 0
      dom.window.addEventListener(
        'keydown',
        (event) => {
          if (event.key === 'f' || event.key === 'F') laterCapture += 1
        },
        true
      )

      await press(root, dom.window, 'f')
      expect(roomKeys).toEqual([])
      expect(laterCapture).toBe(0)
      expect(container.querySelector('.mr-side-menu')).toBeNull()
    })
  })

  it('disables archive and delete on the current row', async () => {
    await withDom(async ({ container, dom, root }) => {
      const client = makeClient()
      await mount(root, client)
      await openMenu(root, container, 'Live one')

      expect(menuItem(container, 'Archive').hasAttribute('disabled')).toBe(true)
      expect(menuItem(container, 'Delete').hasAttribute('disabled')).toBe(true)
      expect(menuItem(container, 'Archive').getAttribute('title')).toBe(
        'The current conversation cannot be archived or deleted.'
      )

      await press(root, dom.window, 'a')
      expect(client.calls.update).toHaveLength(0)
      expect(container.querySelector('.mr-side-confirm')).toBeNull()
    })
  })

  it('consumes every menu key when the row has no enabled item and keeps the menu open', async () => {
    await withDom(async ({ container, dom, root }) => {
      const client = makeClient()
      client.state.current.id = ''
      client.state.current.count = 0
      const roomKeys = []
      dom.window.addEventListener('keydown', (event) => roomKeys.push(event.key))
      await mount(root, client)
      await openMenu(root, container, 'Live one')

      for (const key of ['p', 'r', 'f', 'u', 'a', 'd']) {
        await press(root, dom.window, key)
        expect(container.querySelector('.mr-side-menu')).not.toBeNull()
      }

      expect(roomKeys).toEqual([])
      expect(client.calls.update).toHaveLength(0)
      expect(client.calls.open).toHaveLength(0)
      expect(client.calls.branch).toHaveLength(0)
      expect(client.calls.delete).toHaveLength(0)
      expect(client.calls.new).toHaveLength(0)
    })
  })
})

describe('the conversation list', () => {
  it('filters by title as you type and clears the filter', async () => {
    await withDom(async ({ container, root }) => {
      await mount(root, makeClient())
      expect(titles(container)).toContain('Alpha')

      const search = container.querySelector('.mr-side-search')
      await type(root, search, 'Al')
      expect(titles(container)).toEqual(['Alpha'])

      await type(root, search, '')
      expect(titles(container)).toContain('Beta')
      expect(titles(container)).toContain('Zulu')
    })
  })

  it('keeps pinned rows first for newest, oldest and name, and keeps the choice', async () => {
    await withDom(async ({ container, dom, root }) => {
      await mount(root, makeClient())

      expect(titles(container)).toEqual(['Live one', 'Beta', 'Alpha', 'Zulu'])
      await click(root, buttonWithText(container, 'Oldest'))
      expect(titles(container)).toEqual(['Live one', 'Beta', 'Zulu', 'Alpha'])
      expect(dom.window.localStorage.getItem('machineroom.sessionSort')).toBe('oldest')

      await click(root, buttonWithText(container, 'Name'))
      expect(titles(container)).toEqual(['Live one', 'Beta', 'Alpha', 'Zulu'])
      expect(dom.window.localStorage.getItem('machineroom.sessionSort')).toBe('name')

      await click(root, buttonWithText(container, 'Newest'))
      expect(titles(container)).toEqual(['Live one', 'Beta', 'Alpha', 'Zulu'])
      expect(dom.window.localStorage.getItem('machineroom.sessionSort')).toBe('newest')
    })
  })

  it('hides archived rows and brings them back with Unarchive', async () => {
    await withDom(async ({ container, root }) => {
      const client = makeClient()
      await mount(root, client)
      expect(titles(container)).not.toContain('Old')
      const show = buttonWithText(container, 'Show archived (1)')
      expect(show).not.toBeNull()

      await click(root, show)
      expect(titles(container)).toContain('Old')
      await openMenu(root, container, 'Old')
      expect(menuItem(container, 'Unarchive')).not.toBeNull()
      await click(root, menuItem(container, 'Unarchive'))
      await settle()

      expect(client.calls.update[0]).toMatchObject({ session: 'old', archived: false })
      expect(buttonWithText(container, 'Show archived (1)')).toBeNull()
    })
  })

  it('clears the unread dot when the conversation is opened', async () => {
    await withDom(async ({ container, root }) => {
      const client = makeClient()
      client.state.sessions[0].unread = true
      await mount(root, client)
      const alphaRow = rowByTitle(container, 'Alpha').parentNode
      expect(alphaRow.querySelector('.mr-side-unread')).not.toBeNull()

      await click(root, rowByTitle(container, 'Alpha'))
      await settle()
      expect(client.calls.update[0]).toMatchObject({ session: 'alpha', unread: false })

      await click(root, buttonWithText(container, 'Back'))
      expect(rowByTitle(container, 'Alpha').parentNode.querySelector('.mr-side-unread')).toBeNull()
    })
  })
})
