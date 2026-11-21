import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import OrchestratorChat from '../src/ui/OrchestratorChat.jsx'
import { click, settle, withDom } from './helpers/uiDom.js'

const COMMANDS = [
  { name: 'compact', description: 'Summarize the conversation.', source: 'room' },
  { name: 'new', description: 'Start a new conversation.', source: 'room' },
  { name: 'help', description: 'Show the list of commands.', source: 'room' },
  { name: 'hello', description: 'Say hello and stop.', source: 'command' },
  { name: 'style', description: 'Keep the house style.', source: 'skill' },
]

const STARTED = { state: 'idle', messages: [{ id: 'm0', from: 'owner', text: 'go' }] }

function makeClient() {
  const calls = { send: [], compact: [], created: [] }
  const client = {
    orchestrators: async () => [{ id: 'orchestrator', name: 'Orchestrator', state: 'idle' }],
    orchestrator: async () => STARTED,
    orchestratorCommands: async () => COMMANDS,
    sendOrchestrator: async (text, options) => {
      calls.send.push({ text, options })
      return { id: 'm1' }
    },
    compactOrchestrator: async (options) => {
      calls.compact.push(options)
      return { ok: true }
    },
    newOrchestratorSession: async (options) => {
      calls.created.push(options)
      return { ok: true }
    },
    subscribe: () => () => {},
  }
  return { client, calls }
}

async function mount(root, client, props = {}) {
  await act(async () => {
    root.render(createElement(OrchestratorChat, { open: true, inline: true, client, initialChat: STARTED, ...props }))
  })
  await settle()
}

function inputOf(container) {
  return container.querySelector('.mr-orch-input')
}

function rowsOf(container) {
  return container.querySelectorAll('.mr-orch-slash-row')
}

async function submit(container) {
  const form = container.querySelector('.mr-orch-form')
  await act(async () => {
    form.dispatchEvent({ type: 'submit', bubbles: true, cancelable: true })
  })
  await settle()
}

describe('the slash command list in the chat', () => {
  it('opens from a draft that starts with a slash and shows the source and the description', async () => {
    await withDom(async ({ container, root }) => {
      const { client } = makeClient()
      await mount(root, client, { initialDraft: '/' })
      expect(rowsOf(container)).toHaveLength(5)
      expect(container.textContent).toContain('/compact')
      expect(container.textContent).toContain('room')
      expect(container.textContent).toContain('Say hello and stop.')
      expect(container.textContent).toContain('skill')
    })
  })

  it('filters the list from the draft', async () => {
    await withDom(async ({ container, root }) => {
      const { client } = makeClient()
      await mount(root, client, { initialDraft: '/hell' })
      expect(rowsOf(container)).toHaveLength(1)
      expect(container.textContent).toContain('/hello')
    })
  })

  it('says when the filter matches nothing', async () => {
    await withDom(async ({ container, root }) => {
      const { client } = makeClient()
      await mount(root, client, { initialDraft: '/zzz' })
      expect(rowsOf(container)).toHaveLength(0)
      expect(container.textContent).toContain('No commands found.')
    })
  })

  it('says when the client cannot list commands', async () => {
    await withDom(async ({ container, root }) => {
      const { client } = makeClient()
      const bare = { ...client, orchestratorCommands: undefined }
      await mount(root, bare, { initialDraft: '/' })
      expect(rowsOf(container)).toHaveLength(0)
      expect(container.textContent).toContain('Commands are not available here.')
    })
  })

  it('picks a command from a click and leaves the arguments to type', async () => {
    await withDom(async ({ container, root }) => {
      const { client, calls } = makeClient()
      await mount(root, client, { initialDraft: '/' })
      const row = rowsOf(container).find((item) => item.textContent.includes('/hello'))
      await click(root, row)
      expect(inputOf(container).value).toBe('/hello ')
      expect(rowsOf(container)).toHaveLength(0)
      expect(calls.send).toHaveLength(0)
    })
  })

  it('closes the list on Escape and leaves the chat and the draft alone', async () => {
    await withDom(async ({ container, dom, root }) => {
      const { client } = makeClient()
      let closed = 0
      await mount(root, client, { initialDraft: '/', onClose: () => (closed += 1) })
      expect(rowsOf(container).length).toBeGreaterThan(0)
      await act(async () => {
        dom.window.dispatchEvent({ type: 'keydown', key: 'Escape', bubbles: true, cancelable: true })
      })
      await settle()
      expect(rowsOf(container)).toHaveLength(0)
      expect(inputOf(container).value).toBe('/')
      expect(closed).toBe(0)
    })
  })
})

describe('the room commands', () => {
  it('shows the list for /help and sends nothing', async () => {
    await withDom(async ({ container, root }) => {
      const { client, calls } = makeClient()
      await mount(root, client, { initialDraft: '/help' })
      await submit(container)
      expect(inputOf(container).value).toBe('/')
      expect(rowsOf(container).length).toBeGreaterThan(0)
      expect(calls.send).toHaveLength(0)
    })
  })

  it('opens the stop card for /stop and sends nothing', async () => {
    await withDom(async ({ container, root }) => {
      const { client, calls } = makeClient()
      await mount(root, client, { initialDraft: '/stop' })
      await submit(container)
      expect(container.textContent).toContain('Stop the orchestrator?')
      expect(calls.send).toHaveLength(0)
    })
  })

  it('starts a new conversation for /new and /clear', async () => {
    await withDom(async ({ container, root }) => {
      const { client, calls } = makeClient()
      await mount(root, client, { initialDraft: '/new' })
      await submit(container)
      expect(calls.created).toEqual([{ id: 'orchestrator' }])
      expect(inputOf(container).value).toBe('')
      expect(calls.send).toHaveLength(0)
    })

    await withDom(async ({ container, root }) => {
      const { client, calls } = makeClient()
      await mount(root, client, { initialDraft: '/clear' })
      await submit(container)
      expect(calls.created).toEqual([{ id: 'orchestrator' }])
      expect(calls.send).toHaveLength(0)
    })
  })

  it('asks first for /compact and keeps the text it carries', async () => {
    await withDom(async ({ container, root }) => {
      const { client, calls } = makeClient()
      await mount(root, client, { initialDraft: '/compact keep the plan' })
      await submit(container)
      expect(container.textContent).toContain('Compact the conversation and keep: keep the plan')
      expect(calls.compact).toHaveLength(0)

      const compact = Array.from(container.querySelectorAll('.mr-orch-confirm-btn')).find(
        (button) => button.textContent.trim() === 'Compact'
      )
      await click(root, compact)
      await settle()
      expect(calls.compact).toEqual([{ id: 'orchestrator', keep: 'keep the plan' }])
    })
  })

  it('sends an unknown slash command as plain text with no error', async () => {
    await withDom(async ({ container, root }) => {
      const { client, calls } = makeClient()
      await mount(root, client, { initialDraft: '/not-a-command' })
      await submit(container)
      expect(calls.send).toEqual([{ text: '/not-a-command', options: {} }])
      expect(container.querySelector('.mr-orch-error')).toBeNull()
    })
  })

  it('sends /seats and /agents directly without opening a confirm card even on an unstarted chat', async () => {
    const emptyChat = { state: 'idle', messages: [] }
    await withDom(async ({ container, root }) => {
      const { client, calls } = makeClient()
      client.orchestrator = async () => emptyChat
      await mount(root, client, { initialChat: emptyChat, initialDraft: '/seats' })
      await submit(container)
      expect(calls.send).toEqual([{ text: '/seats', options: {} }])
      expect(container.querySelector('.mr-orch-confirm')).toBeNull()
      expect(inputOf(container).value).toBe('')
    })

    await withDom(async ({ container, root }) => {
      const { client, calls } = makeClient()
      client.orchestrator = async () => emptyChat
      await mount(root, client, { initialChat: emptyChat, initialDraft: '/agents' })
      await submit(container)
      expect(calls.send).toEqual([{ text: '/agents', options: {} }])
      expect(container.querySelector('.mr-orch-confirm')).toBeNull()
    })
  })

  it('confirms /grant with numbers and rings before sending, and cancels cleanly', async () => {
    const seatChat = {
      ...STARTED,
      seats: {
        ring: 0,
        nextRing: 1,
        depth: 2,
        grant: { lanes: 0, subs: 0 },
        used: { lanes: 0, totalLanes: 1, subs: 0 },
        rings: [
          { ring: 0, taken: 1, limit: 3, free: 2 },
          { ring: 1, taken: 1, limit: 4, free: 3 },
        ],
      },
    }
    await withDom(async ({ container, root }) => {
      const { client, calls } = makeClient()
      client.orchestrator = async () => seatChat
      await mount(root, client, { initialChat: seatChat, initialDraft: '/grant 3 1' })
      await submit(container)
      expect(calls.send).toHaveLength(0)
      expect(container.textContent).toContain('3 lanes turned on on ring 0 (2 of 3 seats free)')
      expect(container.textContent).toContain('1 sub on ring 1 (3 of 4 seats free)')

      const cancel = Array.from(container.querySelectorAll('.mr-orch-confirm-btn')).find(
        (button) => button.textContent.trim() === 'Cancel'
      )
      await click(root, cancel)
      await settle()
      expect(container.querySelector('.mr-orch-confirm')).toBeNull()
      expect(calls.send).toHaveLength(0)

      await submit(container)
      const grant = Array.from(container.querySelectorAll('.mr-orch-confirm-btn')).find(
        (button) => button.textContent.trim() === 'Grant'
      )
      await click(root, grant)
      await settle()
      expect(calls.send).toEqual([{ text: '/grant 3 1', options: {} }])
      expect(container.querySelector('.mr-orch-confirm')).toBeNull()
      expect(inputOf(container).value).toBe('')
    })
  })

  it('confirms /revoke with numbers and rings and rejects bad /grant input without sending', async () => {
    const seatChat = {
      ...STARTED,
      seats: {
        ring: 1,
        nextRing: null,
        depth: 2,
        grant: { lanes: 2, subs: 0 },
        used: { lanes: 1, totalLanes: 1, subs: 0 },
        rings: [{ ring: 1, taken: 2, limit: 4, free: 2 }],
      },
    }
    await withDom(async ({ container, root }) => {
      const { client, calls } = makeClient()
      client.orchestrator = async () => seatChat
      await mount(root, client, { initialChat: seatChat, initialDraft: '/revoke' })
      await submit(container)
      expect(calls.send).toHaveLength(0)
      expect(container.textContent).toContain('from 2 lanes and 0 subs to 0 lanes and 0 subs')
      expect(container.textContent).toContain('ring 1 (2 of 4 seats free)')
      expect(container.textContent).toContain('Agents already made stay as they are.')

      const buttons = Array.from(container.querySelectorAll('.mr-orch-confirm-btn'))
      expect(buttons.map((button) => button.textContent.trim())).toEqual(['Cancel', 'Revoke'])
      expect(buttons[0].className).toContain('is-cancel')
      expect(buttons[1].className).toContain('is-stop')
      const revoke = buttons[1]
      await click(root, revoke)
      await settle()
      expect(calls.send).toEqual([{ text: '/revoke', options: {} }])
    })

    await withDom(async ({ container, root }) => {
      const { client, calls } = makeClient()
      await mount(root, client, { initialDraft: '/grant nope' })
      await submit(container)
      expect(calls.send).toHaveLength(0)
      expect(container.querySelector('.mr-orch-error')?.textContent).toContain('/grant LANES [SUBS]')
    })
  })
})
