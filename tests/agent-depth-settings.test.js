import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import AgentDepthSettings, { UNLOCK_TEXT } from '../src/ui/AgentDepthSettings.jsx'
import Settings from '../src/ui/Settings.jsx'
import { buttonWithText, click, settle, withDom } from './helpers/uiDom.js'

function makeClient(start = { limit: 2, unlocked: false }) {
  const calls = { agentDepth: 0, setAgentDepth: [] }
  let saved = { ...start }
  const client = {
    calls,
    agentDepth: async () => {
      calls.agentDepth += 1
      return { ...saved }
    },
    setAgentDepth: async (payload) => {
      calls.setAgentDepth.push(payload)
      saved = { limit: payload.limit, unlocked: payload.unlocked }
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

  it('sits in Settings', async () => {
    const client = makeClient()
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(Settings, { open: true, effects: {}, onClose: () => {}, client }))
      })
      await settle()

      expect(container.querySelector('.mr-depth')).not.toBeNull()
      expect(container.textContent).toContain('Subagent depth')
    })
  })
})
