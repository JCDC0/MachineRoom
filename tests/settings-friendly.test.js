import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import EndpointsPanel from '../src/ui/EndpointsPanel.jsx'
import LanesSettings from '../src/ui/LanesSettings.jsx'
import { settle, type, withDom } from './helpers/uiDom.js'

describe('friendly settings states', () => {
  it('offers model refresh only for a saved endpoint name', async () => {
    const endpoint = { name: 'Saved', provider: 'Custom', baseUrl: '', models: [] }
    const client = { endpoints: async () => [endpoint] }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(EndpointsPanel, { client, initialEndpoints: [endpoint], initialOpen: true }))
      })
      await settle()
      const form = container.querySelector('#endpoints-models').parentNode
      await type(root, container.querySelector('#endpoints-name'), 'New endpoint')
      expect(form.querySelector('button[aria-label="Refresh models"]')).toBeNull()
      expect(form.textContent).toContain('Save first, then use Refresh models on its row.')
      await type(root, container.querySelector('#endpoints-name'), 'Saved')
      expect(form.querySelector('button[aria-label="Refresh models"]')).not.toBeNull()
    })
  })

  it('shows a lanes read error without calling the list empty', async () => {
    const client = { lanes: async () => { throw new Error('Could not read lanes.') }, showLane: async () => {} }
    await withDom(async ({ container, root }) => {
      await act(async () => { root.render(createElement(LanesSettings, { client })) })
      await settle()
      expect(container.textContent).toContain('Could not read lanes.')
      expect(container.textContent).not.toContain('No lanes are listed.')
    })
  })
})
