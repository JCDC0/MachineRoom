import { act, createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import Inspector from '../src/ui/Inspector.jsx'
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
})
