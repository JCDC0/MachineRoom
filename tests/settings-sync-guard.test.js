import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import EndpointsPanel from '../src/ui/EndpointsPanel.jsx'
import McpSettings from '../src/ui/McpSettings.jsx'
import SearchSettings from '../src/ui/SearchSettings.jsx'
import { withDom } from './helpers/uiDom.js'

async function mount(container, root, element) {
  await act(async () => {
    root.render(element)
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('first reads that throw before they return a promise', () => {
  it('shows the MCP read error instead of Loading forever', async () => {
    const client = {
      mcpServers() {
        throw new Error('The MCP read failed.')
      },
    }
    await withDom(async ({ container, root }) => {
      await mount(container, root, createElement(McpSettings, { client }))
      expect(container.textContent).toContain('The MCP read failed.')
      expect(container.textContent).not.toContain('Loading')
    })
  })

  it('shows the web search read error instead of Loading forever', async () => {
    const client = {
      searchProvider() {
        throw new Error('The search read failed.')
      },
    }
    await withDom(async ({ container, root }) => {
      await mount(container, root, createElement(SearchSettings, { client }))
      expect(container.textContent).toContain('The search read failed.')
      expect(container.textContent).not.toContain('Loading')
    })
  })

  it('shows the endpoint read error instead of Loading forever', async () => {
    const client = {
      providers() {
        return []
      },
      endpoints() {
        throw new Error('The endpoint read failed.')
      },
      keys() {
        return []
      },
    }
    await withDom(async ({ container, root }) => {
      await mount(container, root, createElement(EndpointsPanel, { client }))
      expect(container.textContent).toContain('The endpoint read failed.')
      expect(container.textContent).not.toContain('Loading endpoints.')
    })
  })
})
