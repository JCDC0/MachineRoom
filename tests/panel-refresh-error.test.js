import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import MetersPanel from '../src/ui/panels/MetersPanel.jsx'
import AgentBuilder from '../src/ui/panels/AgentBuilder.jsx'
import TasksPanel from '../src/ui/panels/TasksPanel.jsx'
import { buttonWithText, settle, withDom } from './helpers/uiDom.js'

async function mountRefresh(root, node) {
  await act(async () => {
    root.render(node)
  })
  await settle()
}

function failingClient(read) {
  let calls = 0
  return {
    [read]: async () => {
      calls += 1
      if (calls > 1) throw new Error('The bridge did not answer.')
      return read === 'costs' ? { summary: {}, byAgent: [] } : read === 'agents' ? [] : []
    },
  }
}

describe('a manual panel refresh', () => {
  it('says the meters refresh failed', async () => {
    const client = failingClient('costs')
    await withDom(async ({ container, root }) => {
      await mountRefresh(root, createElement(MetersPanel, { client }))
      await act(async () => {
        buttonWithText(container, 'Refresh').click()
      })
      expect(container.textContent).toContain('The bridge did not answer.')
    })
  })

  it('says the lanes refresh failed', async () => {
    const client = failingClient('agents')
    await withDom(async ({ container, root }) => {
      await mountRefresh(root, createElement(AgentBuilder, { client }))
      await act(async () => {
        buttonWithText(container, 'Refresh').click()
      })
      expect(container.textContent).toContain('The bridge did not answer.')
    })
  })

  it('says the tasks refresh failed', async () => {
    let reads = 0
    const client = {
      issues: async () => {
        reads += 1
        if (reads > 0) throw new Error('The bridge did not answer.')
        return []
      },
      agents: async () => [],
      liveRuns: async () => [],
      comments: async () => [],
    }
    await withDom(async ({ container, root }) => {
      await mountRefresh(root, createElement(TasksPanel, { client, initialIssues: [], initialAgents: [], initialLiveRuns: [] }))
      await act(async () => {
        buttonWithText(container, 'Refresh').click()
      })
      expect(container.textContent).toContain('The bridge did not answer.')
    })
  })
})
