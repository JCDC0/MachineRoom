import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { PROVIDERS } from '../server/endpoints.js'
import EndpointsPanel from '../src/ui/EndpointsPanel.jsx'
import { buttonWithText, withDom } from './helpers/handDom.js'

function makeClient() {
  const calls = []
  const client = {
    providers: async () => PROVIDERS,
    endpoints: async () => [],
    keys: async () => [],
    quickEndpoint: async (payload) => {
      calls.push(payload)
      return { endpoint: { models: 2 } }
    },
  }
  return { client, calls }
}

async function typeInto(node, text) {
  await act(async () => {
    node.focus()
    node.dispatchEvent({ type: 'focusin', bubbles: true, cancelable: true })
    node.value = text
    node.dispatchEvent({ type: 'keyup', bubbles: true, cancelable: true })
  })
}

describe('EndpointsPanel quick key', () => {
  it('closes the quick key confirm card when the key field changes', async () => {
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(EndpointsPanel, {
            client,
            initialProviders: PROVIDERS,
            initialEndpoints: [],
          })
        )
      })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      await typeInto(container.querySelector('#endpoints-quick-key'), 'one')
      await act(async () => {
        buttonWithText(container.querySelector('.endpoints-quick'), 'Save key').click()
      })
      expect(container.querySelector('.endpoints-confirm')).not.toBeNull()

      await typeInto(container.querySelector('#endpoints-quick-key'), 'two')
      expect(container.querySelector('.endpoints-confirm')).toBeNull()
      expect(calls).toEqual([])
    })
  })
})
