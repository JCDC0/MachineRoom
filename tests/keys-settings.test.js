import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import KeysSettings, { deleteKeyText } from '../src/ui/KeysSettings.jsx'
import Settings from '../src/ui/Settings.jsx'
import { buttonWithText, click, settle, withDom } from './helpers/uiDom.js'

const SECRET = 'secret-that-must-not-render'

function makeClient(names = []) {
  const calls = { keys: 0, deleteKey: [] }
  let saved = [...names]
  const client = {
    calls,
    keys: async () => {
      calls.keys += 1
      return saved.map((name) => ({ name, value: SECRET, updatedAt: 1 }))
    },
    deleteKey: async (payload) => {
      calls.deleteKey.push(payload)
      saved = saved.filter((name) => name !== payload.name)
      return { keys: saved.map((name) => ({ name, value: SECRET })) }
    },
  }
  return client
}

async function mount(root, props) {
  await act(async () => {
    root.render(createElement(KeysSettings, props))
  })
  await settle()
}

function namesIn(container) {
  return container.querySelectorAll('.mr-keys-name').map((node) => node.textContent)
}

describe('the Keys section', () => {
  it('lists the saved key names and never a value', async () => {
    const client = makeClient(['OPENROUTER_API_KEY', 'BRAVE_API_KEY'])

    await withDom(async ({ container, root }) => {
      await mount(root, { client })

      expect(namesIn(container)).toEqual(['OPENROUTER_API_KEY', 'BRAVE_API_KEY'])
      expect(client.calls.keys).toBe(1)
      expect(container.textContent).not.toContain(SECRET)
      expect(container.querySelectorAll('input')).toHaveLength(0)
    })
  })

  it('sits in Settings', async () => {
    const client = makeClient(['OPENROUTER_API_KEY'])

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(Settings, { open: true, effects: {}, onClose: () => {}, client }))
      })
      await settle()

      expect(container.querySelector('.mr-keys')).not.toBeNull()
      expect(namesIn(container)).toEqual(['OPENROUTER_API_KEY'])
    })
  })

  it('asks on a card and deletes only from the card', async () => {
    const client = makeClient(['OPENROUTER_API_KEY', 'BRAVE_API_KEY'])

    await withDom(async ({ container, root }) => {
      await mount(root, { client })

      await click(root, container.querySelectorAll('.mr-keys-delete')[0])
      const card = container.querySelector('.mr-keys-confirm')
      expect(card.querySelector('.mr-keys-confirm-text').textContent).toBe(
        deleteKeyText('OPENROUTER_API_KEY')
      )
      expect(deleteKeyText('OPENROUTER_API_KEY')).toBe(
        'Delete OPENROUTER_API_KEY? Its saved value is lost, and an endpoint or search provider that uses it stops working.'
      )
      expect(client.calls.deleteKey).toEqual([])

      await click(root, buttonWithText(card, 'Delete'))
      await settle()

      expect(client.calls.deleteKey).toEqual([{ name: 'OPENROUTER_API_KEY', confirmed: true }])
      expect(client.calls.keys).toBe(2)
      expect(namesIn(container)).toEqual(['BRAVE_API_KEY'])
      expect(container.querySelector('.mr-keys-confirm')).toBeNull()
    })
  })

  it('takes focus on the card and closes it with Escape alone', async () => {
    const client = makeClient(['OPENROUTER_API_KEY'])

    await withDom(async ({ container, dom, root }) => {
      await mount(root, { client })
      await click(root, container.querySelector('.mr-keys-delete'))

      const card = container.querySelector('.mr-keys-confirm')
      const active = dom.document.activeElement
      expect(active).toBe(card.querySelector('.mr-keys-confirm-btn.is-start'))

      const heard = []
      function onKey(event) {
        heard.push(event.key)
      }
      dom.document.addEventListener('keydown', onKey)
      try {
        await act(async () => {
          active.dispatchEvent({ type: 'keydown', key: 'Escape', bubbles: true, cancelable: true })
        })
      } finally {
        dom.document.removeEventListener('keydown', onKey)
      }

      expect(container.querySelector('.mr-keys-confirm')).toBeNull()
      expect(client.calls.deleteKey).toEqual([])
      expect(heard).toEqual([])
    })
  })

  it('closes the card on Escape from anywhere and lets no other handler see it', async () => {
    const client = makeClient(['OPENROUTER_API_KEY'])

    await withDom(async ({ container, dom, root }) => {
      await mount(root, { client })
      await click(root, container.querySelector('.mr-keys-delete'))
      expect(container.querySelector('.mr-keys-confirm')).not.toBeNull()

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

      expect(container.querySelector('.mr-keys-confirm')).toBeNull()
      expect(client.calls.deleteKey).toEqual([])
      expect(heard).toEqual([])
    })
  })

  it('shows nothing without a keys method', async () => {
    await withDom(async ({ container, root }) => {
      await mount(root, { client: { deleteKey: async () => ({}) } })
      expect(container.querySelector('.mr-keys')).toBeNull()

      await mount(root, { client: null })
      expect(container.querySelector('.mr-keys')).toBeNull()
    })
  })
})
