import { act, createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import RepositoryPanel from '../src/ui/RepositoryPanel.jsx'
import Inspector from '../src/ui/Inspector.jsx'
import Sidebar from '../src/ui/Sidebar.jsx'
import { buttonWithText, click, settle, type, withDom } from './helpers/uiDom.js'

function gitState(overrides = {}) {
  return {
    git: true,
    branch: 'main',
    detached: false,
    head: '1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    dirty: false,
    branches: [
      { name: 'main', head: '1111111', current: true, worktree: false, upstream: 'origin/main', ahead: 0, behind: 0 },
      { name: 'feat/login', head: '2222222', current: false, worktree: false, upstream: 'origin/feat/login', ahead: 2, behind: 1 },
      { name: 'feat/held', head: '3333333', current: false, worktree: true, upstream: null, ahead: null, behind: null },
    ],
    commits: [],
    truncated: false,
    ...overrides,
  }
}

function makeClient(initial = gitState(), overrides = {}) {
  const calls = { gitState: 0, switchBranch: [], createBranch: [] }
  const listeners = new Set()
  let current = initial
  const client = {
    calls,
    setState(next) {
      current = next
    },
    notify(topic) {
      for (const listener of [...listeners]) listener({ topic })
    },
    gitState: async () => {
      calls.gitState += 1
      return current
    },
    switchBranch: async (payload) => {
      calls.switchBranch.push(payload)
      return current
    },
    createBranch: async (payload) => {
      calls.createBranch.push(payload)
      return current
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    ...overrides,
  }
  return client
}

async function mount(root, props) {
  await act(async () => {
    root.render(createElement(RepositoryPanel, props))
  })
  await settle()
}

async function submit(root, form) {
  await act(async () => {
    form.dispatchEvent({ type: 'submit', bubbles: true, cancelable: true })
  })
}

function rowByName(container, name) {
  return (
    container
      .querySelectorAll('.mr-repo-row')
      .find((row) => row.querySelector('.mr-repo-name')?.textContent === name) ?? null
  )
}

function isDisabled(button) {
  return button.disabled === true || button.getAttribute('disabled') !== null
}

describe('the Repository section', () => {
  it('shows the branch, the dirty line and the tags on each row', async () => {
    const client = makeClient(gitState({ dirty: true }))

    await withDom(async ({ container, root }) => {
      await mount(root, { client, live: true, project: 'C:\\work\\demo' })

      expect(container.querySelector('.mr-repo-branch').textContent).toBe('main')
      expect(container.querySelector('.mr-repo-dirty').textContent).toBe('Uncommitted changes')

      const current = rowByName(container, 'main')
      const ahead = rowByName(container, 'feat/login')
      const held = rowByName(container, 'feat/held')
      expect(current.className).toContain('is-current')
      expect(buttonWithText(current, 'Switch')).toBeNull()
      expect(ahead.textContent).toContain('ahead 2')
      expect(ahead.textContent).toContain('behind 1')
      expect(held.textContent).toContain('in a worktree')
      expect(held.querySelector('.mr-repo-reason').textContent).toBe('Commit or stash the uncommitted changes first.')
      expect(isDisabled(buttonWithText(ahead, 'Switch'))).toBe(true)
    })
  })

  it('says why a branch in a worktree cannot be switched to', async () => {
    const client = makeClient(gitState())

    await withDom(async ({ container, root }) => {
      await mount(root, { client, live: true, project: 'C:\\work\\demo' })

      const held = rowByName(container, 'feat/held')
      expect(held.querySelector('.mr-repo-reason').textContent).toBe('Another worktree holds this branch.')
      await click(root, buttonWithText(held, 'Switch'))
      expect(container.querySelector('.mr-repo-confirm')).toBeNull()
    })
  })

  it('switches a branch after its confirm card', async () => {
    const client = makeClient(gitState())

    await withDom(async ({ container, root }) => {
      await mount(root, { client, live: true, project: 'C:\\work\\demo' })

      await click(root, buttonWithText(rowByName(container, 'feat/login'), 'Switch'))
      expect(container.querySelector('.mr-repo-confirm-text').textContent).toBe(
        'Switch demo to feat/login? New lanes start from it and reviews compare against it.'
      )
      expect(client.calls.switchBranch).toEqual([])

      client.setState(
        gitState({
          branch: 'feat/login',
          branches: [
            { name: 'main', current: false, worktree: false, ahead: 0, behind: 2 },
            { name: 'feat/login', current: true, worktree: false, ahead: 0, behind: 0 },
          ],
        })
      )
      await click(root, container.querySelector('.mr-repo-confirm-btn.is-primary'))
      await settle()

      expect(client.calls.switchBranch).toEqual([{ branch: 'feat/login', confirmed: true }])
      expect(container.querySelector('.mr-repo-branch').textContent).toBe('feat/login')
      expect(container.querySelector('.mr-repo-confirm')).toBeNull()
    })
  })

  it('shows the bridge sentence when a switch is refused', async () => {
    const client = makeClient(gitState(), {
      switchBranch: async (payload) => {
        client.calls.switchBranch.push(payload)
        throw new Error('The checkout has uncommitted changes.')
      },
    })

    await withDom(async ({ container, root }) => {
      await mount(root, { client, live: true, project: 'C:\\work\\demo' })
      await click(root, buttonWithText(rowByName(container, 'feat/login'), 'Switch'))
      await click(root, container.querySelector('.mr-repo-confirm-btn.is-primary'))
      await settle()

      expect(container.querySelector('.mr-repo-error').textContent).toBe('The checkout has uncommitted changes.')
      expect(container.querySelector('.mr-repo-confirm')).toBeNull()
      expect(buttonWithText(rowByName(container, 'feat/login'), 'Switch')).not.toBeNull()
    })
  })

  it('creates a branch from the form behind its own confirm card', async () => {
    const client = makeClient(gitState())

    await withDom(async ({ container, root }) => {
      await mount(root, { client, live: true, project: 'C:\\work\\demo' })

      await click(root, buttonWithText(container, 'New branch'))
      const form = container.querySelector('.mr-repo-form')
      expect(form).not.toBeNull()
      const options = container.querySelector('.mr-repo-select').querySelectorAll('option')
      expect(options.map((option) => option.textContent)).toEqual(['main', 'feat/login', 'feat/held'])

      await type(root, container.querySelector('.mr-repo-form').querySelector('.mr-repo-input'), 'feat/new')
      await submit(root, form)
      expect(container.querySelector('.mr-repo-confirm-text').textContent).toBe(
        'Create feat/new from main? The new branch is made without switching to it.'
      )
      expect(client.calls.createBranch).toEqual([])

      client.setState(
        gitState({
          branches: [
            { name: 'main', current: true, worktree: false, ahead: 0, behind: 0 },
            { name: 'feat/new', current: false, worktree: false, ahead: 0, behind: 0 },
          ],
        })
      )
      await click(root, container.querySelector('.mr-repo-confirm-btn.is-primary'))
      await settle()

      expect(client.calls.createBranch).toEqual([{ name: 'feat/new', from: 'main', confirmed: true }])
      expect(rowByName(container, 'feat/new')).not.toBeNull()
      expect(rowByName(container, 'main').className).toContain('is-current')
      expect(container.querySelector('.mr-repo-form')).toBeNull()
    })
  })

  it('refuses a name that is already a branch before the confirm card', async () => {
    const client = makeClient(gitState())

    await withDom(async ({ container, root }) => {
      await mount(root, { client, live: true, project: 'C:\\work\\demo' })

      await click(root, buttonWithText(container, 'New branch'))
      await type(root, container.querySelector('.mr-repo-form').querySelector('.mr-repo-input'), 'main')
      await submit(root, container.querySelector('.mr-repo-form'))

      const form = container.querySelector('.mr-repo-form')
      expect(form.querySelector('.mr-repo-error').textContent).toBe('That branch already exists.')
      expect(container.querySelector('.mr-repo-confirm')).toBeNull()
      expect(client.calls.createBranch).toEqual([])
    })
  })

  it('creates a branch from the branch chosen in the form', async () => {
    const client = makeClient(gitState())

    await withDom(async ({ container, root }) => {
      await mount(root, { client, live: true, project: 'C:\\work\\demo' })

      await click(root, buttonWithText(container, 'New branch'))
      await type(root, container.querySelector('.mr-repo-form').querySelector('.mr-repo-input'), 'feat/next')
      await type(root, container.querySelector('.mr-repo-select'), 'feat/login')
      await submit(root, container.querySelector('.mr-repo-form'))

      expect(container.querySelector('.mr-repo-confirm-text').textContent).toBe(
        'Create feat/next from feat/login? The new branch is made without switching to it.'
      )
      await click(root, container.querySelector('.mr-repo-confirm-btn.is-primary'))
      await settle()
      expect(client.calls.createBranch).toEqual([{ name: 'feat/next', from: 'feat/login', confirmed: true }])
    })
  })

  it('shows the bridge sentence when a new branch is refused', async () => {
    const client = makeClient(gitState(), {
      createBranch: async (payload) => {
        client.calls.createBranch.push(payload)
        throw new Error('That branch already exists.')
      },
    })

    await withDom(async ({ container, root }) => {
      await mount(root, { client, live: true, project: 'C:\\work\\demo' })
      await click(root, buttonWithText(container, 'New branch'))
      await type(root, container.querySelector('.mr-repo-form').querySelector('.mr-repo-input'), 'feat/new')
      await submit(root, container.querySelector('.mr-repo-form'))
      await click(root, container.querySelector('.mr-repo-confirm-btn.is-primary'))
      await settle()

      expect(container.querySelector('.mr-repo-error').textContent).toBe('That branch already exists.')
      expect(container.querySelector('.mr-repo-confirm')).toBeNull()
      expect(container.querySelector('.mr-repo-form')).not.toBeNull()
    })
  })

  it('dispatches the tree event', async () => {
    const client = makeClient(gitState())

    await withDom(async ({ container, dom, root }) => {
      await mount(root, { client, live: true, project: 'C:\\work\\demo' })
      const seen = []
      function onTree(event) {
        seen.push(event.type)
      }
      dom.window.addEventListener('machineroom:show-git-tree', onTree)
      try {
        await click(root, buttonWithText(container, 'Show the tree'))
        expect(seen).toEqual(['machineroom:show-git-tree'])
      } finally {
        dom.window.removeEventListener('machineroom:show-git-tree', onTree)
      }
    })
  })

  it('shows Detached at SHA for a detached head', async () => {
    const client = makeClient(gitState({ branch: null, detached: true }))

    await withDom(async ({ container, root }) => {
      await mount(root, { client, live: true, project: 'C:\\work\\demo' })
      expect(container.querySelector('.mr-repo-branch').textContent).toBe('Detached at 1111111')
      expect(container.querySelector('.mr-repo-row.is-current')).toBeNull()
    })
  })

  it('leaves the section out without a gitState method, in a replay and with no git', async () => {
    await withDom(async ({ container, root }) => {
      const noMethod = { projects: async () => ({}) }
      await mount(root, { client: noMethod, live: true, project: 'C:\\work\\demo' })
      expect(container.querySelector('.mr-repo')).toBeNull()

      const replayClient = makeClient(gitState())
      await mount(root, { client: replayClient, live: false, project: 'C:\\work\\demo' })
      expect(container.querySelector('.mr-repo')).toBeNull()
      expect(replayClient.calls.gitState).toBe(0)

      await mount(root, { client: makeClient({ git: false }), live: true, project: 'C:\\work\\demo' })
      expect(container.querySelector('.mr-repo')).toBeNull()
    })
  })

  it('shows a read error when the bridge refuses the state', async () => {
    const client = makeClient(gitState(), {
      gitState: async () => {
        throw new Error('Git is not available.')
      },
    })

    await withDom(async ({ container, root }) => {
      await mount(root, { client, live: true, project: 'C:\\work\\demo' })
      expect(container.querySelector('.mr-repo-error').textContent).toBe('Git is not available.')
    })
  })

  it('shows the status sentence and no uncommitted line when the status read failed', async () => {
    const client = makeClient(
      gitState({ dirty: null, changeCount: null, statusError: 'Could not check for uncommitted changes.' })
    )

    await withDom(async ({ container, root }) => {
      await mount(root, { client, live: true, project: 'C:\\work\\demo' })
      expect(container.querySelector('.mr-repo-error').textContent).toBe('Could not check for uncommitted changes.')
      expect(container.querySelector('.mr-repo-dirty')).toBeNull()
      expect(container.textContent).not.toContain('Uncommitted changes')
      expect(isDisabled(buttonWithText(rowByName(container, 'feat/login'), 'Switch'))).toBe(true)
    })
  })

  it('shows the branch sentence instead of an empty branch list', async () => {
    const client = makeClient(gitState({ branches: [], refsError: 'Could not read the branches.' }))

    await withDom(async ({ container, root }) => {
      await mount(root, { client, live: true, project: 'C:\\work\\demo' })
      expect(container.querySelector('.mr-repo-branches').textContent).toContain('Could not read the branches.')
      expect(container.textContent).not.toContain('No branches.')
    })
  })

  it('reads again every 60 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      const client = makeClient(gitState())
      await withDom(async ({ root }) => {
        await mount(root, { client, live: true, project: 'C:\\work\\demo' })
        expect(client.calls.gitState).toBe(1)
        await act(async () => {
          vi.advanceTimersByTime(60000)
        })
        await settle()
        expect(client.calls.gitState).toBe(2)
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads on a git notice and keeps only the newest answer', async () => {
    const oldState = gitState({ branch: 'old' })
    const newState = gitState({ branch: 'next' })
    let resolveFirst = null
    let reads = 0
    const listeners = new Set()
    const client = {
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      gitState: () => {
        reads += 1
        if (reads === 1) {
          return new Promise((resolve) => {
            resolveFirst = resolve
          })
        }
        return Promise.resolve(newState)
      },
    }

    await withDom(async ({ container, root }) => {
      await mount(root, { client, live: true, project: 'C:\\work\\demo' })
      for (const listener of [...listeners]) listener({ topic: 'agents' })
      expect(reads).toBe(1)

      await act(async () => {
        for (const listener of [...listeners]) listener({ topic: 'git' })
      })
      await settle()
      expect(reads).toBe(2)
      expect(container.querySelector('.mr-repo-branch').textContent).toBe('next')

      await act(async () => {
        resolveFirst(oldState)
      })
      await settle()
      expect(container.querySelector('.mr-repo-branch').textContent).toBe('next')
    })
  })

  it('keeps two hundred branches inside the scrolling list', async () => {
    const branches = Array.from({ length: 200 }, (_, index) => ({
      name: `branch-${String(index).padStart(3, '0')}`,
      current: index === 0,
      worktree: false,
      ahead: 0,
      behind: 0,
    }))
    const client = makeClient(gitState({ branches }))

    await withDom(async ({ container, root }) => {
      await mount(root, { client, live: true, project: 'C:\\work\\demo' })
      const list = container.querySelector('.mr-repo-branches')
      expect(list.querySelectorAll('.mr-repo-row')).toHaveLength(200)
      expect(rowByName(container, 'branch-000').className).toContain('is-current')
      expect(rowByName(container, 'branch-199')).not.toBeNull()
    })
  })

  it('cuts ten thousand branches to at most two hundred rows and says how many', async () => {
    const branches = Array.from({ length: 10000 }, (_, index) => ({
      name: `branch-${String(index).padStart(5, '0')}`,
      current: index === 5000,
      worktree: false,
      ahead: 0,
      behind: 0,
    }))
    const client = makeClient(gitState({ branch: 'branch-05000', branches }))

    await withDom(async ({ container, root }) => {
      await mount(root, { client, live: true, project: 'C:\\work\\demo' })
      const list = container.querySelector('.mr-repo-branches')
      expect(list.querySelectorAll('.mr-repo-row').length).toBeLessThanOrEqual(200)
      expect(container.querySelector('.mr-repo-count').textContent).toBe('Showing 200 of 10000 branches.')
      expect(list.querySelector('.mr-repo-name').textContent).toBe('branch-05000')
      expect(list.querySelector('.mr-repo-row').className).toContain('is-current')

      await type(root, container.querySelector('.mr-repo-filter').querySelector('input'), 'BRANCH-05000')
      await settle()
      const filtered = container.querySelector('.mr-repo-branches')
      expect(filtered.querySelectorAll('.mr-repo-row')).toHaveLength(1)
      expect(filtered.querySelector('.mr-repo-name').textContent).toBe('branch-05000')
      expect(container.querySelector('.mr-repo-count').textContent).toBe('Showing 1 of 10000 branches.')
    })
  })

  it('finds a branch past the first two hundred with the filter', async () => {
    const branches = Array.from({ length: 10000 }, (_, index) => ({
      name: `branch-${String(index).padStart(5, '0')}`,
      current: index === 0,
      worktree: false,
      ahead: 0,
      behind: 0,
    }))
    const client = makeClient(gitState({ branches }))

    await withDom(async ({ container, root }) => {
      await mount(root, { client, live: true, project: 'C:\\work\\demo' })
      expect(rowByName(container, 'branch-09999')).toBeNull()

      await type(root, container.querySelector('.mr-repo-filter').querySelector('input'), 'branch-09999')
      await settle()

      expect(rowByName(container, 'branch-09999')).not.toBeNull()
      expect(container.querySelectorAll('.mr-repo-row')).toHaveLength(1)
      expect(container.querySelector('.mr-repo-count').textContent).toBe('Showing 1 of 10000 branches.')
    })
  })

  it('keeps the branch picked from a filtered list in the switch confirm', async () => {
    const branches = Array.from({ length: 10000 }, (_, index) => ({
      name: index === 0 ? 'main' : `branch-${String(index).padStart(5, '0')}`,
      current: index === 0,
      worktree: false,
      ahead: 0,
      behind: 0,
    }))
    branches[9999] = { name: 'feat/target', current: false, worktree: false, ahead: 0, behind: 0 }
    const client = makeClient(gitState({ branches }))

    await withDom(async ({ container, root }) => {
      await mount(root, { client, live: true, project: 'C:\\work\\demo' })
      await type(root, container.querySelector('.mr-repo-filter').querySelector('input'), 'feat/tar')
      await settle()

      const target = rowByName(container, 'feat/target')
      expect(target).not.toBeNull()
      await click(root, buttonWithText(target, 'Switch'))
      expect(container.querySelector('.mr-repo-confirm-text').textContent).toBe(
        'Switch demo to feat/target? New lanes start from it and reviews compare against it.'
      )

      await click(root, container.querySelector('.mr-repo-confirm-btn.is-primary'))
      await settle()
      expect(client.calls.switchBranch).toEqual([{ branch: 'feat/target', confirmed: true }])
    })
  })

  it('keeps every branch in the create form while the list is filtered', async () => {
    const client = makeClient(gitState())

    await withDom(async ({ container, root }) => {
      await mount(root, { client, live: true, project: 'C:\\work\\demo' })
      await type(root, container.querySelector('.mr-repo-filter').querySelector('input'), 'zzz')
      await settle()
      expect(container.querySelector('.mr-repo-count').textContent).toBe('Showing 0 of 3 branches.')
      expect(container.querySelectorAll('.mr-repo-row')).toHaveLength(0)

      await click(root, buttonWithText(container, 'New branch'))
      const options = container.querySelector('.mr-repo-select').querySelectorAll('option')
      expect(options.map((option) => option.textContent)).toEqual(['main', 'feat/login', 'feat/held'])

      await type(root, container.querySelector('.mr-repo-form').querySelector('.mr-repo-input'), 'feat/next')
      await type(root, container.querySelector('.mr-repo-select'), 'feat/login')
      await submit(root, container.querySelector('.mr-repo-form'))

      expect(container.querySelector('.mr-repo-confirm-text').textContent).toBe(
        'Create feat/next from feat/login? The new branch is made without switching to it.'
      )
    })
  })
})

describe('the inspector git view after a failed read', () => {
  function mountInspector(root, state) {
    return act(async () => {
      root.render(
        createElement(Inspector, {
          target: { kind: 'git', id: 'git' },
          live: true,
          bridge: true,
          client: { gitState: async () => state },
          lanes: [],
          onClose: () => {},
        })
      )
    })
  }

  it('shows the status sentence and no clean line', async () => {
    const state = gitState({
      dirty: null,
      changeCount: null,
      changes: [],
      statusError: 'Could not check for uncommitted changes.',
    })

    await withDom(async ({ container, root }) => {
      await mountInspector(root, state)
      await settle()
      expect(container.textContent).toContain('Could not check for uncommitted changes.')
      expect(container.textContent).not.toContain('No uncommitted changes.')
    })
  })

  it('shows the log sentence and no empty graph line', async () => {
    const state = gitState({ commits: [], logError: 'Could not read the commits.' })

    await withDom(async ({ container, root }) => {
      await mountInspector(root, state)
      await settle()
      expect(container.textContent).toContain('Could not read the commits.')
      expect(container.textContent).not.toContain('No commits.')
    })
  })
})

describe('the Repository section in the sidebar', () => {
  function sidebarClient() {
    return {
      projects: async () => ({ current: { path: 'C:\\work\\demo' }, recent: [] }),
      orchestratorSessions: async () => ({ current: { title: 'Current', startedAt: Date.now() }, sessions: [] }),
      gitState: async () => gitState(),
    }
  }

  it('sits at the top of the Projects tab in a live room', async () => {
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(Sidebar, { client: sidebarClient(), live: true, project: 'C:\\work\\demo' }))
      })
      await settle()
      await click(root, buttonWithText(container, 'Projects'))

      const projects = container.querySelector('.mr-side-projects')
      expect(projects).not.toBeNull()
      expect(projects.childNodes[0].className).toBe('mr-repo')
      expect(container.querySelector('.mr-repo-branch').textContent).toBe('main')
    })
  })

  it('leaves the Projects tab as it was in a replay', async () => {
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(Sidebar, { client: sidebarClient(), live: false, project: 'C:\\work\\demo' }))
      })
      await settle()
      await click(root, buttonWithText(container, 'Projects'))
      expect(container.querySelector('.mr-repo')).toBeNull()
    })
  })
})
