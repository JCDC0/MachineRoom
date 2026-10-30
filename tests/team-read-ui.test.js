import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import OrchestratorChat from '../src/ui/OrchestratorChat.jsx'
import { click, settle, withDom } from './helpers/uiDom.js'

const LIST = [
  { id: 'orchestrator', name: 'Orchestrator', state: 'idle' },
  { id: 'frontend', name: 'Frontend', state: 'idle' },
]

async function mount(root, client) {
  await act(async () => {
    root.render(createElement(OrchestratorChat, { client }))
  })
  await settle()
}

function teamTab(scope) {
  return (
    scope
      .querySelectorAll('.mr-orch-tab')
      .find((button) => button.textContent.trim() === 'Team') ?? null
  )
}

describe('the Team tab', () => {
  it('says a sub read failed instead of Nothing said yet', async () => {
    const client = {
      orchestrators: async () => LIST,
      orchestrator: (id) => {
        if (id === 'frontend') throw new Error('Frontend is gone.')
        return { state: 'idle', messages: [] }
      },
      subscribe: () => () => {},
    }

    await withDom(async ({ container, root }) => {
      await mount(root, client)
      const tab = teamTab(container)
      expect(tab).not.toBeNull()
      await click(root, tab)
      await settle(20)

      const empty = container.querySelector('.mr-orch-empty')
      expect(empty).not.toBeNull()
      expect(empty.textContent).toBe('Frontend is gone.')
      expect(empty.textContent).not.toBe('Nothing said yet.')
      expect(container.querySelector('.mr-orch-error').textContent).toContain('Frontend is gone.')
    })
  })

  it('says a rejected sub read failed', async () => {
    const client = {
      orchestrators: async () => LIST,
      orchestrator: async (id) => {
        if (id === 'frontend') return Promise.reject(new Error('The read failed.'))
        return { state: 'idle', messages: [] }
      },
      subscribe: () => () => {},
    }

    await withDom(async ({ container, root }) => {
      await mount(root, client)
      await click(root, teamTab(container))
      await settle(20)

      const empty = container.querySelector('.mr-orch-empty')
      expect(empty).not.toBeNull()
      expect(empty.textContent).toBe('Could not read Frontend.')
      expect(empty.textContent).not.toBe('Nothing said yet.')
    })
  })
})
