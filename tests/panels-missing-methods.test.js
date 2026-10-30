import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import AgentBuilder, { AGENTS_UNAVAILABLE } from '../src/ui/panels/AgentBuilder.jsx'
import ControlDrawer from '../src/ui/panels/ControlDrawer.jsx'
import MetersPanel, { METERS_UNAVAILABLE } from '../src/ui/panels/MetersPanel.jsx'
import TasksPanel, { TASKS_UNAVAILABLE } from '../src/ui/panels/TasksPanel.jsx'
import { withDom } from './helpers/handDom.js'

async function mount(container, root, element) {
  await act(async () => {
    root.render(element)
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('panels with a client that lacks a method', () => {
  it('shows the tasks sentence for a bare client', async () => {
    await withDom(async ({ container, root }) => {
      await mount(container, root, createElement(TasksPanel, { client: {} }))
      expect(container.textContent).toContain(TASKS_UNAVAILABLE)
      expect(container.textContent).not.toContain('is not a function')
    })
  })

  it('shows the tasks sentence when only comments are missing', async () => {
    const client = {
      issues: async () => [],
      agents: async () => [],
      liveRuns: async () => [],
    }
    await withDom(async ({ container, root }) => {
      await mount(container, root, createElement(TasksPanel, { client }))
      expect(container.textContent).toContain(TASKS_UNAVAILABLE)
    })
  })

  it('shows the meters sentence for a bare client', async () => {
    await withDom(async ({ container, root }) => {
      await mount(container, root, createElement(MetersPanel, { client: {} }))
      expect(container.textContent).toContain(METERS_UNAVAILABLE)
      expect(container.textContent).not.toContain('is not a function')
    })
  })

  it('shows the lanes sentence for a bare client', async () => {
    await withDom(async ({ container, root }) => {
      await mount(container, root, createElement(AgentBuilder, { client: {} }))
      expect(container.textContent).toContain(AGENTS_UNAVAILABLE)
      expect(container.textContent).not.toContain('is not a function')
    })
  })

  it('leaves the Tasks and Meters tabs out for a bare client', async () => {
    await withDom(async ({ container, root }) => {
      await mount(container, root, createElement(ControlDrawer, { client: {}, open: true }))
      expect(container.querySelector('#tab-dispatch')).not.toBeNull()
      expect(container.querySelector('#tab-tasks')).toBeNull()
      expect(container.querySelector('#tab-meters')).toBeNull()
    })
  })
})
