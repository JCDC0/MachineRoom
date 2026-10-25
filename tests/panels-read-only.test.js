import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createMockClient } from '../src/control/mock.js'
import ControlDrawer from '../src/ui/panels/ControlDrawer.jsx'
import DispatchPanel from '../src/ui/panels/DispatchPanel.jsx'
import IssueThread from '../src/ui/panels/IssueThread.jsx'

const BRIEFS = [
  { id: 'B6', title: 'Late join replay', owners: ['opencode'], done: false },
  { id: 'C3e', title: 'HUD polish', owners: ['agy'], done: false },
]

const AGENTS = [
  { id: 'agent-opencode', key: 'opencode', name: 'OpenCode', adapterType: 'opencode_local', role: null },
]

function dispatchHtml(props = {}) {
  const client = createMockClient({ latencyMs: 0 })
  return renderToString(
    createElement(DispatchPanel, {
      client,
      initialAgents: AGENTS,
      initialBriefs: BRIEFS,
      ...props,
    })
  )
}

describe('DispatchPanel keeps only the runs that work', () => {
  it('offers the brief runs and the runs list, with no issue form', () => {
    const html = dispatchHtml()
    expect(html).toContain('id="dispatch-brief"')
    expect(html).toContain('Runs')
    expect(html).not.toContain('<form')
    expect(html).not.toContain('dispatch-title')
    expect(html).not.toContain('dispatch-description')
    expect(html).not.toContain('dispatch-agent')
    expect(html).not.toContain('dispatch-model')
    expect(html).not.toContain('dispatch-priority')
    expect(html).not.toContain('Start task')
    expect(html).not.toContain('Limits')
    expect(html).not.toContain('Use as description')
  })

  it('names a missing target brief and picks nothing', () => {
    const html = dispatchHtml({ targetBriefId: 'C9z' })
    expect(html).toContain('Brief C9z is not in the brief list.')
  })
})

describe('ControlDrawer tabs', () => {
  it('has no Plan tab and keeps Dispatch, Tasks, Meters, Team and Reviews', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(createElement(ControlDrawer, { client, open: true }))
    expect(html).not.toContain('id="tab-plan"')
    expect(html).not.toContain('<span>Plan</span>')
    expect(html).toContain('id="tab-dispatch"')
    expect(html).toContain('id="tab-tasks"')
    expect(html).toContain('id="tab-meters"')
    expect(html).toContain('id="tab-agents"')
    expect(html).toContain('id="tab-reviews"')
  })
})

describe('IssueThread is read only', () => {
  it('shows the run and no comment composer', () => {
    const client = createMockClient({ latencyMs: 0 })
    const issue = {
      id: 'opencode-B6-20261024-120000',
      identifier: 'B6',
      title: 'Late join replay',
      description: '',
      status: 'done',
      priority: 'medium',
      assigneeAgentId: 'agent-opencode',
    }
    const html = renderToString(createElement(IssueThread, { issue, client }))
    expect(html).toContain('B6')
    expect(html).not.toContain('thread-comment-input')
    expect(html).not.toContain('Add comment')
    expect(html).not.toContain('Post comment')
  })
})
