import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import OrchestratorChat from '../src/ui/OrchestratorChat.jsx'
import { settle, withDom } from './helpers/uiDom.js'

function chatWith(text) {
  return { state: 'idle', messages: [{ id: text, from: 'owner', text }] }
}

describe('the chat read', () => {
  it('keeps the newest answer when an older read answers last', async () => {
    const pending = []
    let notice = null
    const client = {
      orchestrator: () => new Promise((resolve) => pending.push(resolve)),
      orchestrators: async () => [],
      subscribe: (fn) => {
        notice = fn
        return () => {}
      },
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(OrchestratorChat, { open: true, client, initialChat: chatWith('starting') }))
      })
      await settle()
      expect(pending).toHaveLength(1)

      await act(async () => {
        notice({ topic: 'orchestrator' })
      })
      expect(pending).toHaveLength(2)

      await act(async () => {
        pending[1](chatWith('newest answer'))
      })
      await act(async () => {
        pending[0](chatWith('older answer'))
      })

      expect(container.textContent).toContain('newest answer')
      expect(container.textContent).not.toContain('older answer')
    })
  })
})
