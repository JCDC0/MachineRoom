import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createMockClient } from '../src/control/mock.js'
import AgentBuilder, { NEW_LANES_TEXT } from '../src/ui/panels/AgentBuilder.jsx'

const SAMPLE_AGENT = {
  id: 'agent-claude',
  key: 'claude-code',
  name: 'Claude Code',
  adapterType: 'claude_local',
  role: 'engineer',
  status: 'idle',
}

describe('AgentBuilder Team panel', () => {
  it('lists the lanes and says where a new lane is made', () => {
    expect(NEW_LANES_TEXT).toBe('New lanes are made in the family tree.')
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(
      createElement(AgentBuilder, {
        client,
        initialAgents: [SAMPLE_AGENT],
      })
    )
    expect(html).toContain('Lanes (')
    expect(html).toContain('Claude Code')
    expect(html).toContain(NEW_LANES_TEXT)
    expect(html).not.toContain('Hire agent')
    expect(html).not.toContain('Monthly budget')
  })

  it('says when there are no lanes', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(createElement(AgentBuilder, { client, initialAgents: [] }))
    expect(html).toContain('No lanes found.')
  })
})
