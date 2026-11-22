import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import AgentDepthSettings, { UNLOCK_TEXT, hideOccupiedText } from '../src/ui/AgentDepthSettings.jsx'
import Settings from '../src/ui/Settings.jsx'
import { buttonWithText, click, settle, withDom, openTab } from './helpers/uiDom.js'

function makeClient(start = { limit: 2, unlocked: false }, options = {}) {
  const calls = { agentDepth: 0, setAgentDepth: [] }
  const listeners = new Set()
  let saved = { ...start }
  let conflict = options.conflict ?? null
  const client = {
    calls,
    setSaved(next) {
      saved = { ...saved, ...next }
    },
    setConflict(next) {
      conflict = next
    },
    emit(notice) {
      for (const listener of [...listeners]) listener(notice)
    },
    listenerCount() {
      return listeners.size
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    agentDepth: async () => {
      calls.agentDepth += 1
      return { ...saved }
    },
    setAgentDepth: async (payload) => {
      calls.setAgentDepth.push(payload)
      if (conflict && payload.hideOccupied !== true) {
        const error = new Error(conflict.error)
        if (conflict.deepest !== undefined) error.deepest = conflict.deepest
        if (conflict.deepestAgents !== undefined) error.deepestAgents = conflict.deepestAgents
        if (conflict.rings !== undefined) error.rings = conflict.rings
        throw error
      }
      saved = { ...saved, limit: payload.limit, unlocked: payload.unlocked }
      return { ...saved }
    },
  }
  return client
}

async function mount(root, props) {
  await act(async () => {
    root.render(createElement(AgentDepthSettings, props))
  })
  await settle()
}

function depthButtons(container) {
  return container.querySelectorAll('.mr-depth-choice').map((button) => button.textContent.trim())
}

describe('the Subagents section', () => {
  it('shows subagent depth 1 and 2 and an Unlock button', async () => {
    const client = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, { client })

      expect(container.querySelector('.mr-depth')).not.toBeNull()
      expect(container.textContent).toContain('Subagents')
      expect(container.textContent).toContain('Subagent depth')
      expect(depthButtons(container)).toEqual(['1', '2'])
      expect(buttonWithText(container, 'Unlock')).not.toBeNull()
      expect(buttonWithText(container, '3')).toBeNull()
      expect(client.calls.agentDepth).toBe(1)
    })
  })

  it('posts a picked depth with confirmed true', async () => {
    const client = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, { client })

      await click(root, container.querySelector('[aria-label="Subagent depth 1"]'))
      await settle()

      expect(client.calls.setAgentDepth).toEqual([{ limit: 1, unlocked: false, confirmed: true }])
      expect(container.querySelector('[aria-label="Subagent depth 1"]').getAttribute('aria-pressed')).toBe('true')
    })
  })

  it('asks on a card before an unlock, with Cancel first and focused', async () => {
    const client = makeClient()
    await withDom(async ({ container, dom, root }) => {
      await mount(root, { client })
      await click(root, buttonWithText(container, 'Unlock'))

      const card = container.querySelector('.mr-depth-confirm')
      expect(card).not.toBeNull()
      expect(card.querySelector('.mr-depth-confirm-text').textContent).toBe(UNLOCK_TEXT)
      expect(UNLOCK_TEXT).toBe(
        'Allow subagents deeper than 2 levels? Each level can multiply the runs, tokens and cost of one task, and a deep tree is hard to stop. Only unlock this if you watch the costs.'
      )
      expect(client.calls.setAgentDepth).toEqual([])

      const buttons = card.querySelectorAll('button')
      expect(buttons[0].textContent).toBe('Cancel')
      expect(buttons[1].textContent).toBe('Unlock')
      expect(dom.document.activeElement).toBe(buttons[0])

      await click(root, buttons[1])
      await settle()

      expect(client.calls.setAgentDepth).toEqual([{ limit: 2, unlocked: true, confirmed: true }])
      expect(container.querySelector('.mr-depth-confirm')).toBeNull()
      expect(depthButtons(container)).toEqual(['1', '2', '3', '4'])
      expect(buttonWithText(container, 'Lock')).not.toBeNull()
    })
  })

  it('closes the card on Escape alone and writes nothing', async () => {
    const client = makeClient()
    await withDom(async ({ container, dom, root }) => {
      await mount(root, { client })
      await click(root, buttonWithText(container, 'Unlock'))
      expect(container.querySelector('.mr-depth-confirm')).not.toBeNull()

      const heard = []
      function onKey(event) {
        heard.push(event.key)
      }
      dom.window.addEventListener('keydown', onKey)
      try {
        await act(async () => {
          dom.window.dispatchEvent({ type: 'keydown', key: 'Escape', bubbles: true, cancelable: true })
        })
      } finally {
        dom.window.removeEventListener('keydown', onKey)
      }

      expect(container.querySelector('.mr-depth-confirm')).toBeNull()
      expect(client.calls.setAgentDepth).toEqual([])
      expect(heard).toEqual([])
    })
  })

  it('posts 3 or 4 once unlocked and locks back to 2 with no card', async () => {
    const client = makeClient({ limit: 4, unlocked: true })
    await withDom(async ({ container, root }) => {
      await mount(root, { client })

      expect(depthButtons(container)).toEqual(['1', '2', '3', '4'])
      await click(root, container.querySelector('[aria-label="Subagent depth 3"]'))
      await settle()
      expect(client.calls.setAgentDepth).toEqual([{ limit: 3, unlocked: true, confirmed: true }])

      await click(root, buttonWithText(container, 'Lock'))
      await settle()
      expect(container.querySelector('.mr-depth-confirm')).toBeNull()
      expect(client.calls.setAgentDepth).toEqual([
        { limit: 3, unlocked: true, confirmed: true },
        { limit: 2, unlocked: false, confirmed: true },
      ])
      expect(depthButtons(container)).toEqual(['1', '2'])
    })
  })

  it('asks on a card before lowering depth past an occupied ring and saves with hideOccupied on Hide', async () => {
    const client = makeClient({ limit: 2, unlocked: false, deepest: 1, deepestAgents: 3 })
    await withDom(async ({ container, dom, root }) => {
      await mount(root, { client })

      await click(root, container.querySelector('[aria-label="Subagent depth 1"]'))

      const card = container.querySelector('.mr-depth-confirm')
      expect(card).not.toBeNull()
      expect(card.querySelector('.mr-depth-confirm-text').textContent).toBe(
        'Ring 1 holds 3 agents. A depth of 1 hides them until you raise it again.'
      )
      expect(hideOccupiedText(1, 1, 1)).toBe('Ring 1 holds 1 agent. A depth of 1 hides it until you raise it again.')
      expect(client.calls.setAgentDepth).toEqual([])

      const buttons = card.querySelectorAll('button')
      expect(buttons[0].textContent).toBe('Cancel')
      expect(buttons[1].textContent).toBe('Hide')
      expect(dom.document.activeElement).toBe(buttons[0])

      await click(root, buttons[0])
      expect(container.querySelector('.mr-depth-confirm')).toBeNull()
      expect(client.calls.setAgentDepth).toEqual([])

      await click(root, container.querySelector('[aria-label="Subagent depth 1"]'))
      expect(container.querySelector('.mr-depth-confirm')).not.toBeNull()
      await act(async () => {
        dom.window.dispatchEvent({ type: 'keydown', key: 'Escape', bubbles: true, cancelable: true })
      })
      expect(container.querySelector('.mr-depth-confirm')).toBeNull()
      expect(client.calls.setAgentDepth).toEqual([])

      await click(root, container.querySelector('[aria-label="Subagent depth 1"]'))
      await click(root, buttonWithText(container, 'Hide'))
      await settle()

      expect(client.calls.setAgentDepth).toEqual([
        { limit: 1, unlocked: false, confirmed: true, hideOccupied: true },
      ])
      expect(container.querySelector('.mr-depth-confirm')).toBeNull()
      expect(container.querySelector('[aria-label="Subagent depth 1"]').getAttribute('aria-pressed')).toBe('true')
    })
  })

  it('saves at once when the picked depth still shows the deepest occupied ring, and asks on Lock if ring 2 holds agents', async () => {
    const client = makeClient({ limit: 4, unlocked: true, deepest: 2, deepestAgents: 2 })
    await withDom(async ({ container, root }) => {
      await mount(root, { client })

      await click(root, container.querySelector('[aria-label="Subagent depth 3"]'))
      await settle()

      expect(container.querySelector('.mr-depth-confirm')).toBeNull()
      expect(client.calls.setAgentDepth).toEqual([{ limit: 3, unlocked: true, confirmed: true }])

      await click(root, buttonWithText(container, 'Lock'))
      const card = container.querySelector('.mr-depth-confirm')
      expect(card).not.toBeNull()
      expect(card.querySelector('.mr-depth-confirm-text').textContent).toBe(
        'Ring 2 holds 2 agents. A depth of 2 hides them until you raise it again.'
      )

      await click(root, buttonWithText(container, 'Hide'))
      await settle()

      expect(client.calls.setAgentDepth).toEqual([
        { limit: 3, unlocked: true, confirmed: true },
        { limit: 2, unlocked: false, confirmed: true, hideOccupied: true },
      ])
    })
  })

  it('shows nothing without the client methods', async () => {
    await withDom(async ({ container, root }) => {
      await mount(root, { client: { setAgentDepth: async () => ({}) } })
      expect(container.querySelector('.mr-depth')).toBeNull()

      await mount(root, { client: { agentDepth: async () => ({ limit: 2, unlocked: false }) } })
      expect(container.querySelector('.mr-depth')).toBeNull()

      await mount(root, { client: null })
      expect(container.querySelector('.mr-depth')).toBeNull()
    })
  })

  it('refreshes on a family notice when a sub is added after mount so depth 1 asks', async () => {
    const client = makeClient({ limit: 2, unlocked: false, deepest: 0, deepestAgents: 0, rings: [] })
    await withDom(async ({ container, dom, root }) => {
      await mount(root, { client })
      expect(client.calls.agentDepth).toBe(1)

      client.setSaved({ deepest: 1, deepestAgents: 1, rings: [{ ring: 1, agents: 1 }] })
      await act(async () => {
        client.emit({ topic: 'family' })
      })
      await settle()
      expect(client.calls.agentDepth).toBe(2)

      await click(root, container.querySelector('[aria-label="Subagent depth 1"]'))
      const card = container.querySelector('.mr-depth-confirm')
      expect(card).not.toBeNull()
      expect(card.querySelector('.mr-depth-confirm-text').textContent).toBe(
        'Ring 1 holds 1 agent. A depth of 1 hides it until you raise it again.'
      )
      expect(dom.document.activeElement).toBe(card.querySelectorAll('button')[0])
      expect(client.calls.setAgentDepth).toEqual([])

      await click(root, buttonWithText(container, 'Hide'))
      await settle()
      expect(client.calls.setAgentDepth).toEqual([
        { limit: 1, unlocked: false, confirmed: true, hideOccupied: true },
      ])
    })
  })

  it('refreshes on an agents notice when a sub is removed after mount so depth 1 saves at once', async () => {
    const client = makeClient({
      limit: 2,
      unlocked: false,
      deepest: 1,
      deepestAgents: 2,
      rings: [{ ring: 1, agents: 2 }],
    })
    await withDom(async ({ container, root }) => {
      await mount(root, { client })
      expect(client.calls.agentDepth).toBe(1)

      client.setSaved({ deepest: 0, deepestAgents: 0, rings: [] })
      await act(async () => {
        client.emit({ topic: 'agents' })
      })
      await settle()
      expect(client.calls.agentDepth).toBe(2)

      await click(root, container.querySelector('[aria-label="Subagent depth 1"]'))
      await settle()
      expect(container.querySelector('.mr-depth-confirm')).toBeNull()
      expect(client.calls.setAgentDepth).toEqual([{ limit: 1, unlocked: false, confirmed: true }])
    })
  })

  it('opens the Hide card from a 409 answer instead of only showing error text', async () => {
    const client = makeClient(
      { limit: 4, unlocked: true, deepest: 0, deepestAgents: 0, rings: [] },
      {
        conflict: {
          error: 'Rings 1 and 2 hold 4 agents. A depth of 1 hides them until you raise it again.',
          deepest: 2,
          deepestAgents: 1,
          rings: [
            { ring: 1, agents: 3 },
            { ring: 2, agents: 1 },
          ],
        },
      }
    )
    await withDom(async ({ container, dom, root }) => {
      await mount(root, { client })

      await click(root, container.querySelector('[aria-label="Subagent depth 1"]'))
      await settle()

      expect(container.querySelector('.mr-depth-state.is-error')).toBeNull()
      const card = container.querySelector('.mr-depth-confirm')
      expect(card).not.toBeNull()
      expect(card.querySelector('.mr-depth-confirm-text').textContent).toBe(
        'Rings 1 and 2 hold 4 agents. A depth of 1 hides them until you raise it again.'
      )
      const buttons = card.querySelectorAll('button')
      expect(buttons[0].textContent).toBe('Cancel')
      expect(buttons[1].textContent).toBe('Hide')
      expect(dom.document.activeElement).toBe(buttons[0])

      await click(root, buttons[1])
      await settle()

      expect(client.calls.setAgentDepth).toEqual([
        { limit: 1, unlocked: true, confirmed: true },
        { limit: 1, unlocked: true, confirmed: true, hideOccupied: true },
      ])
      expect(container.querySelector('.mr-depth-confirm')).toBeNull()
      expect(container.querySelector('[aria-label="Subagent depth 1"]').getAttribute('aria-pressed')).toBe('true')
    })
  })

  it('ignores unrelated notices, closes a stale Hide card when agents leave, and unsubscribes on unmount', async () => {
    const client = makeClient({
      limit: 2,
      unlocked: false,
      deepest: 1,
      deepestAgents: 1,
      rings: [{ ring: 1, agents: 1 }],
    })
    await withDom(async ({ container, root }) => {
      await mount(root, { client })
      expect(client.listenerCount()).toBe(1)

      await act(async () => {
        client.emit({ topic: 'runs' })
      })
      await settle()
      expect(client.calls.agentDepth).toBe(1)

      await click(root, container.querySelector('[aria-label="Subagent depth 1"]'))
      expect(container.querySelector('.mr-depth-confirm')).not.toBeNull()

      client.setSaved({ deepest: 0, deepestAgents: 0, rings: [] })
      await act(async () => {
        client.emit({ topic: 'family' })
      })
      await settle()
      expect(container.querySelector('.mr-depth-confirm')).toBeNull()
      expect(
        hideOccupiedText(
          [
            { ring: 0, agents: 2 },
            { ring: 1, agents: 3 },
            { ring: 2, agents: 1 },
          ],
          1
        )
      ).toBe('Rings 1 and 2 hold 4 agents. A depth of 1 hides them until you raise it again.')

      await act(async () => {
        root.unmount()
      })
      expect(client.listenerCount()).toBe(0)
      client.emit({ topic: 'family' })
      await settle()
      expect(client.calls.agentDepth).toBe(2)
    })
  })

  it('counts only newly hidden rings on a second drop after hiding a deeper ring', async () => {
    const client = makeClient({
      limit: 4,
      unlocked: true,
      deepest: 2,
      deepestAgents: 1,
      rings: [
        { ring: 1, agents: 1 },
        { ring: 2, agents: 1 },
      ],
    })
    await withDom(async ({ container, root }) => {
      await mount(root, { client })

      await click(root, buttonWithText(container, 'Lock'))
      const firstCard = container.querySelector('.mr-depth-confirm')
      expect(firstCard).not.toBeNull()
      expect(firstCard.querySelector('.mr-depth-confirm-text').textContent).toBe(
        'Ring 2 holds 1 agent. A depth of 2 hides it until you raise it again.'
      )

      await click(root, buttonWithText(container, 'Hide'))
      await settle()
      expect(client.calls.setAgentDepth).toEqual([
        { limit: 2, unlocked: false, confirmed: true, hideOccupied: true },
      ])

      await click(root, container.querySelector('[aria-label="Subagent depth 1"]'))
      const secondCard = container.querySelector('.mr-depth-confirm')
      expect(secondCard).not.toBeNull()
      expect(secondCard.querySelector('.mr-depth-confirm-text').textContent).toBe(
        'Ring 1 holds 1 agent. A depth of 1 hides it until you raise it again.'
      )
      expect(client.calls.setAgentDepth).toHaveLength(1)

      await click(root, buttonWithText(container, 'Hide'))
      await settle()
      expect(client.calls.setAgentDepth).toEqual([
        { limit: 2, unlocked: false, confirmed: true, hideOccupied: true },
        { limit: 1, unlocked: false, confirmed: true, hideOccupied: true },
      ])
    })

    expect(
      hideOccupiedText(
        [
          { ring: 1, agents: 1 },
          { ring: 2, agents: 1 },
        ],
        1,
        2
      )
    ).toBe('Ring 1 holds 1 agent. A depth of 1 hides it until you raise it again.')
    expect(
      hideOccupiedText(
        [
          { ring: 1, agents: 2 },
          { ring: 2, agents: 1 },
          { ring: 3, agents: 2 },
        ],
        1,
        3
      )
    ).toBe('Rings 1 and 2 hold 3 agents. A depth of 1 hides them until you raise it again.')
    expect(hideOccupiedText([{ ring: 2, agents: 1 }], 1, 2)).toBe('')
  })

  it('saves at once without asking when only already-hidden deeper rings hold agents', async () => {
    const atTwo = makeClient({
      limit: 2,
      unlocked: false,
      deepest: 2,
      deepestAgents: 1,
      rings: [{ ring: 2, agents: 1 }],
    })
    await withDom(async ({ container, root }) => {
      await mount(root, { client: atTwo })

      await click(root, container.querySelector('[aria-label="Subagent depth 1"]'))
      await settle()

      expect(container.querySelector('.mr-depth-confirm')).toBeNull()
      expect(atTwo.calls.setAgentDepth).toEqual([{ limit: 1, unlocked: false, confirmed: true }])
    })

    const atThree = makeClient({
      limit: 3,
      unlocked: true,
      deepest: 3,
      deepestAgents: 1,
      rings: [
        { ring: 1, agents: 1 },
        { ring: 3, agents: 1 },
      ],
    })
    await withDom(async ({ container, root }) => {
      await mount(root, { client: atThree })

      await click(root, buttonWithText(container, 'Lock'))
      await settle()

      expect(container.querySelector('.mr-depth-confirm')).toBeNull()
      expect(atThree.calls.setAgentDepth).toEqual([{ limit: 2, unlocked: false, confirmed: true }])
    })
  })

  it('closes a stale Hide card when newly hidden rings empty while a hidden ring stays occupied, and scopes 409 text', async () => {
    const client = makeClient({
      limit: 2,
      unlocked: false,
      deepest: 2,
      deepestAgents: 1,
      rings: [
        { ring: 1, agents: 1 },
        { ring: 2, agents: 1 },
      ],
    })
    await withDom(async ({ container, root }) => {
      await mount(root, { client })

      await click(root, container.querySelector('[aria-label="Subagent depth 1"]'))
      expect(container.querySelector('.mr-depth-confirm-text').textContent).toBe(
        'Ring 1 holds 1 agent. A depth of 1 hides it until you raise it again.'
      )

      client.setSaved({
        limit: 2,
        unlocked: false,
        deepest: 2,
        deepestAgents: 1,
        rings: [{ ring: 2, agents: 1 }],
      })
      await act(async () => {
        client.emit({ topic: 'family' })
      })
      await settle()
      expect(container.querySelector('.mr-depth-confirm')).toBeNull()
    })

    const conflictClient = makeClient(
      { limit: 2, unlocked: false, deepest: 0, deepestAgents: 0, rings: [] },
      {
        conflict: {
          error: 'Ring 1 holds 1 agent. A depth of 1 hides it until you raise it again.',
          deepest: 2,
          deepestAgents: 1,
          rings: [
            { ring: 1, agents: 1 },
            { ring: 2, agents: 1 },
          ],
        },
      }
    )
    await withDom(async ({ container, root }) => {
      await mount(root, { client: conflictClient })

      await click(root, container.querySelector('[aria-label="Subagent depth 1"]'))
      await settle()

      const card = container.querySelector('.mr-depth-confirm')
      expect(card).not.toBeNull()
      expect(card.querySelector('.mr-depth-confirm-text').textContent).toBe(
        'Ring 1 holds 1 agent. A depth of 1 hides it until you raise it again.'
      )
    })
  })

  it('sits in Settings', async () => {
    const client = makeClient()
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(Settings, { open: true, effects: {}, onClose: () => {}, client }))
      })
      await settle()
      await openTab(root, container, 'Subagents')
      await settle()

      expect(container.querySelector('.mr-depth')).not.toBeNull()
      expect(container.textContent).toContain('Subagent depth')
    })
  })
})
