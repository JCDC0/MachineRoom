import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import EndpointsPanel from '../src/ui/EndpointsPanel.jsx'
import { buttonWithText, withDom } from './helpers/uiDom.js'

const PROVIDERS = [
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { name: 'Local', baseUrl: 'http://127.0.0.1:11434/v1' },
]

function typeInto(node, text) {
  return act(async () => {
    node.focus()
    node.dispatchEvent({ type: 'focusin', bubbles: true, cancelable: true })
    node.value = text
    node.dispatchEvent({ type: 'keyup', bubbles: true, cancelable: true })
    node.dispatchEvent({ type: 'input', bubbles: true, cancelable: true })
    node.dispatchEvent({ type: 'change', bubbles: true, cancelable: true })
  })
}

describe('the custom endpoint form', () => {
  it('cannot change while the save card is up and sends what the card showed', async () => {
    const calls = []
    const client = {
      providers: async () => PROVIDERS,
      endpoints: async () => [],
      keys: async () => [{ name: 'openrouter' }],
      saveEndpoint: async (payload) => {
        calls.push(payload)
        return { ok: true }
      },
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(EndpointsPanel, {
            client,
            initialProviders: PROVIDERS,
            initialEndpoints: [],
            initialOpen: true,
            initialKeys: ['openrouter'],
          })
        )
      })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      await typeInto(container.querySelector('#endpoints-name'), 'Work')
      await typeInto(container.querySelector('#endpoints-models'), 'alpha')
      await act(async () => {
        const select = container.querySelector('#endpoints-key')
        select.value = 'openrouter'
        select.dispatchEvent({ type: 'change', bubbles: true, cancelable: true })
      })
      await act(async () => {
        buttonWithText(container.querySelector('.endpoints-form'), 'Save').click()
      })

      const card = container.querySelector('.endpoints-confirm')
      expect(card.textContent).toContain('Save Work with the base URL https://openrouter.ai/api/v1?')
      for (const id of ['endpoints-name', 'endpoints-base-url', 'endpoints-models', 'endpoints-key', 'endpoints-provider']) {
        expect(container.querySelector(`#${id}`).getAttribute('disabled')).not.toBeNull()
      }
      expect(buttonWithText(container.querySelector('.endpoints-form'), 'Save').getAttribute('disabled')).not.toBeNull()

      await act(async () => {
        buttonWithText(card, 'Save endpoint').click()
      })
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({ name: 'Work', baseUrl: 'https://openrouter.ai/api/v1', models: ['alpha'] })
    })
  })
})
