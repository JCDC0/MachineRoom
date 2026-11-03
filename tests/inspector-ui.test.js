import { act, createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import Inspector from '../src/ui/Inspector.jsx'
import { EXPLORER_LIMIT } from '../src/ui/inspector.js'
import { buttonWithText, click, settle, withDom } from './helpers/uiDom.js'

const lane = {
  id: 'orchestrator',
  key: 'orchestrator',
  name: 'Orchestrator',
  harness: 'claude',
  model: 'opus',
  status: 'working',
  openCalls: 1,
  tool: 'shell',
  label: '$ npm test',
}

const costs = {
  rows: [
    {
      key: 'orchestrator',
      agentId: 'orchestrator',
      costCents: 1234,
      inputTokens: 1200,
      outputTokens: 300,
      reported: true,
    },
  ],
}

const orchestrators = [
  {
    id: 'orchestrator',
    name: 'Orchestrator',
    harness: 'claude',
    model: 'opus',
    effort: 'max',
    contextTokens: 100,
    contextWindow: 1000,
  },
]

function makeClient(overrides = {}) {
  const calls = { fileInfo: [], network: 0, orchestrator: [] }
  const client = {
    calls,
    fileInfo: async (payload) => {
      calls.fileInfo.push(payload)
      return {
        path: payload.path,
        size: 2048,
        modified: '2026-10-30T10:00:00.000Z',
        binary: false,
        truncated: false,
        text: 'hello room',
      }
    },
    network: async () => {
      calls.network += 1
      return { online: true, checkedAt: 1 }
    },
    orchestrator: async (id) => {
      calls.orchestrator.push(id)
      return { state: 'idle', messages: [{ id: 'm1', from: 'owner', text: 'Carry on' }] }
    },
    ...overrides,
  }
  return client
}

async function mount(root, props) {
  await act(async () => {
    root.render(createElement(Inspector, props))
  })
  await settle(10)
}

function isDisabled(button) {
  return button.disabled === true || button.getAttribute('disabled') !== null
}

describe('the inspector panel', () => {
  it('shows the agent rows, the state word, the log and the chat', async () => {
    const client = makeClient()
    const onClose = vi.fn()

    await withDom(async ({ container, root, window }) => {
      const heard = []
      window.addEventListener('machineroom:open-chat', (event) => heard.push(event.detail))
      await mount(root, {
        target: { kind: 'agent', id: 'orchestrator' },
        live: true,
        bridge: true,
        client,
        lanes: [lane],
        working: null,
        costs,
        liveRuns: [],
        tasks: [],
        log: [{ agent: 'Orchestrator', text: 'reading src/a.js', tone: 'normal' }],
        orchestrator: orchestrators,
        family: [],
        onClose,
      })

      expect(container.querySelector('.mr-inspector-title').textContent).toBe('Orchestrator')
      const text = container.textContent
      expect(text).toContain('working')
      expect(text).toContain('shell')
      expect(text).toContain('$ npm test')
      expect(text).toContain('claude')
      expect(text).toContain('opus')
      expect(text).toContain('max')
      expect(text).toContain('10% · 100 of 1000 tokens')
      expect(text).toContain('$12.34')
      expect(text).toContain('1.2k in / 300 out')
      expect(text).toContain('reading src/a.js')
      expect(text).toContain('Carry on')

      await click(root, buttonWithText(container, 'Open chat'))
      expect(heard).toEqual([{ id: 'orchestrator' }])
      expect(onClose).toHaveBeenCalledTimes(1)

      await click(root, container.querySelector('.mr-inspector-close'))
      expect(onClose).toHaveBeenCalledTimes(2)
    })
  })

  it('shows context not reported for a lane and leaves the cost out of a replay', async () => {
    const client = makeClient()

    await withDom(async ({ container, root }) => {
      await mount(root, {
        target: { kind: 'agent', id: 'opencode' },
        live: false,
        bridge: false,
        client,
        lanes: [
          {
            key: 'opencode',
            name: 'OpenCode',
            harness: 'opencode',
            model: 'deepseek',
            status: 'working',
            openCalls: 0,
          },
        ],
        costs,
        log: [],
      })

      const text = container.textContent
      expect(text).toContain('thinking')
      expect(text).toContain('context not reported')
      expect(text).not.toContain('Cost')
    })
  })

  it('reads a file preview as plain text and shows the touches', async () => {
    const client = makeClient({
      fileInfo: async (payload) => {
        client.calls.fileInfo.push(payload)
        return {
          path: payload.path,
          size: 2048,
          modified: '2026-10-30T10:00:00.000Z',
          binary: false,
          truncated: true,
          text: '<b>hello</b>',
        }
      },
    })

    await withDom(async ({ container, root }) => {
      await mount(root, {
        target: { kind: 'file', id: 'src/a.js' },
        live: true,
        bridge: true,
        client,
        lanes: [],
        touches: [{ key: 'opencode', mode: 'read', time: Date.now() }],
      })

      expect(client.calls.fileInfo).toEqual([{ path: 'src/a.js' }])
      expect(container.querySelector('.mr-inspector-path').textContent).toBe('src/a.js')
      expect(container.textContent).toContain('2.0 KB')
      expect(container.textContent).toContain('Too large, showing the first 256 KB.')
      expect(container.textContent).toContain('opencode')
      expect(container.textContent).toContain('read')
      expect(container.querySelector('.mr-inspector-pre').textContent).toBe('<b>hello</b>')
      expect(container.querySelector('b')).toBeNull()
    })
  })

  it('shows the bridge sentence when a file preview is refused', async () => {
    const client = makeClient({
      fileInfo: async () => {
        throw new Error('That file is outside the project.')
      },
    })

    await withDom(async ({ container, root }) => {
      await mount(root, {
        target: { kind: 'file', id: '../secret.txt' },
        live: true,
        bridge: true,
        client,
        lanes: [],
      })
      expect(container.querySelector('.mr-inspector-error').textContent).toBe('That file is outside the project.')
    })
  })

  it('caps a big folder at the explorer limit and says how many more', async () => {
    const files = Array.from(
      { length: EXPLORER_LIMIT + 5 },
      (_, index) => `big/f${String(index).padStart(3, '0')}.js`
    )
    const tree = { rootName: 'demo', dirs: ['', 'big'], files }

    await withDom(async ({ container, root }) => {
      await mount(root, {
        target: { kind: 'folder', id: 'big' },
        live: true,
        tree,
        lanes: [],
      })

      expect(container.querySelectorAll('.mr-inspector-entry-btn')).toHaveLength(EXPLORER_LIMIT)
      expect(container.textContent).toContain('5 more. Open the folder card to see them all.')
    })
  })

  it('lists a folder and follows an inner folder click', async () => {
    const onOpenPath = vi.fn()
    const tree = {
      rootName: 'demo',
      dirs: ['', 'src', 'src/ui'],
      files: ['README.md', 'src/a.js', 'src/ui/Inspector.jsx'],
    }

    await withDom(async ({ container, root }) => {
      await mount(root, {
        target: { kind: 'folder', id: 'src' },
        live: true,
        tree,
        lanes: [],
        onOpenPath,
      })

      const entries = container.querySelectorAll('.mr-inspector-entry-btn')
      expect(entries.map((entry) => entry.textContent)).toEqual(['ui/ dir', 'a.js file'])
      await click(root, entries[0])
      expect(onOpenPath).toHaveBeenCalledWith('src/ui')
      await click(root, container.querySelectorAll('.mr-inspector-crumb-btn')[0])
      expect(onOpenPath).toHaveBeenCalledWith('')
    })
  })

  it('keeps only the newest network answer and lets offline win', async () => {
    let resolveNetwork = null
    const client = makeClient({
      network: () =>
        new Promise((resolve) => {
          resolveNetwork = resolve
        }),
    })

    await withDom(async ({ container, dom, root }) => {
      await mount(root, {
        target: { kind: 'internet', id: 'internet' },
        live: true,
        bridge: true,
        client,
        lanes: [],
      })
      expect(container.textContent).toContain('Connection not reported')

      await act(async () => {
        dom.window.dispatchEvent({ type: 'offline' })
      })
      expect(container.textContent).toContain('No connection')

      await act(async () => {
        resolveNetwork({ online: true, checkedAt: 1 })
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(container.textContent).toContain('No connection')
    })
  })

  it('shows the internet connection and the agents on the web', async () => {
    const client = makeClient({ network: async () => ({ online: false, checkedAt: 2 }) })

    await withDom(async ({ container, root }) => {
      await mount(root, {
        target: { kind: 'internet', id: 'internet' },
        live: true,
        bridge: true,
        client,
        lanes: [{ key: 'opencode', name: 'OpenCode' }],
        webAgents: ['opencode'],
      })
      expect(container.textContent).toContain('No connection')
      expect(container.textContent).toContain('OpenCode')
    })
  })

  it('shows the branch, the changes and the commit graph for the git target', async () => {
    const onSelect = vi.fn()
    let reads = 0
    const state = {
      git: true,
      branch: 'main',
      detached: false,
      head: 'a1b2c3d4e5f6',
      dirty: true,
      changeCount: 3,
      changes: [
        { path: 'src/ui/Inspector.jsx', status: 'M' },
        { path: 'src/gone.js', status: 'D' },
        { path: 'dist/', status: 'U' },
      ],
      branches: [{ name: 'main', head: 'a1b2c3d4e5f6', current: true }],
      commits: [
        { sha: 'a1b2c3d4e5f6', parents: ['b2c3d4e5f6a1'], subject: 'Add source control', refs: ['main'], time: 3 },
        { sha: 'b2c3d4e5f6a1', parents: [], subject: 'Start the room', refs: [], time: 2 },
      ],
      truncated: true,
    }
    const client = makeClient({
      gitState: async () => {
        reads += 1
        return state
      },
    })

    await withDom(async ({ container, root }) => {
      await mount(root, {
        target: { kind: 'git', id: 'git' },
        live: true,
        bridge: true,
        client,
        lanes: [],
        onSelect,
      })

      expect(reads).toBe(1)
      expect(container.querySelector('.mr-inspector-title').textContent).toBe('Source control')
      expect(container.textContent).toContain('Branch')
      expect(container.textContent).toContain('main')
      expect(container.textContent).toContain('Changes 3')
      expect(container.textContent).toContain('Showing the newest 200 commits.')

      const changes = container.querySelectorAll('.mr-inspector-change-btn')
      expect(changes).toHaveLength(3)
      expect(changes[0].querySelector('.mr-inspector-change-path').textContent).toBe('src/ui/Inspector.jsx')
      expect(changes[0].querySelector('.mr-inspector-change-status').textContent).toBe('M')
      expect(isDisabled(changes[1])).toBe(true)
      await click(root, changes[0])
      expect(onSelect).toHaveBeenCalledWith({ kind: 'file', id: 'src/ui/Inspector.jsx' })
      await click(root, changes[2])
      expect(onSelect).toHaveBeenCalledWith({ kind: 'folder', id: 'dist' })

      const rows = container.querySelectorAll('.mr-inspector-graph-row')
      expect(rows).toHaveLength(2)
      expect(rows[0].textContent).toContain('Add source control')
      expect(rows[0].querySelector('circle').getAttribute('fill')).toBe('#e5ff00')
      expect(rows[1].querySelector('circle').getAttribute('fill')).toBe('#ffffff')
      const ref = container.querySelector('.mr-inspector-graph-ref')
      expect(ref.textContent).toBe('main')
      expect(ref.className).toContain('is-current')
    })
  })

  it('says when the folder is not a git repository and shows nothing without the method', async () => {
    const plain = makeClient({ gitState: async () => ({ git: false }) })

    await withDom(async ({ container, root }) => {
      await mount(root, {
        target: { kind: 'git', id: 'git' },
        live: true,
        bridge: true,
        client: plain,
        lanes: [],
      })
      expect(container.textContent).toContain('This folder is not a git repository.')
    })

    await withDom(async ({ container, root }) => {
      await mount(root, {
        target: { kind: 'git', id: 'git' },
        live: false,
        bridge: false,
        client: makeClient(),
        lanes: [],
      })
      expect(container.querySelector('.mr-inspector-title').textContent).toBe('Source control')
      expect(container.textContent).not.toContain('This folder is not a git repository.')
      expect(container.textContent).not.toContain('Changes')
    })
  })
})
