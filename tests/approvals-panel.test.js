import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createMockClient } from '../src/control/mock.js'
import ApprovalsPanel, { decisionConfirmText } from '../src/ui/panels/ApprovalsPanel.jsx'

const AGENTS = [{ id: 'agent-orchestrator', name: 'Orchestrator' }]

const APPROVALS = [
  {
    id: 'approval-1',
    type: 'budget_override_required',
    status: 'pending',
    summary: 'Raise the monthly budget',
    requestedByAgentId: 'agent-orchestrator',
    createdAt: '2026-10-20T10:00:00.000Z',
  },
  {
    id: 'approval-2',
    type: 'hire_agent',
    status: 'pending',
    summary: 'Hire Planner',
    requestedByAgentId: 'agent-orchestrator',
    createdAt: '2026-10-20T09:00:00.000Z',
  },
]

describe('decisionConfirmText', () => {
  it('asks for each decision in its own words', () => {
    expect(decisionConfirmText('approve', 'Fix the typo')).toBe('Approve "Fix the typo"?')
    expect(decisionConfirmText('request-revision', 'Fix the typo')).toBe(
      'Request changes on "Fix the typo"?'
    )
    expect(decisionConfirmText('reject', 'Fix the typo')).toBe('Reject "Fix the typo"?')
  })

  it('adds the note sentence only when the note box has text', () => {
    expect(decisionConfirmText('approve', 'Fix the typo', 'Looks good')).toBe(
      'Approve "Fix the typo"? Your note goes with it.'
    )
    expect(decisionConfirmText('reject', 'Fix the typo', 'Not needed')).toBe(
      'Reject "Fix the typo"? Your note goes with it.'
    )
    expect(decisionConfirmText('approve', 'Fix the typo', '   ')).toBe('Approve "Fix the typo"?')
    expect(decisionConfirmText('approve', 'Fix the typo', '')).toBe('Approve "Fix the typo"?')
  })

  it('shows a control character in the title as visible text', () => {
    expect(decisionConfirmText('approve', 'Fix\u202Etypo')).toBe('Approve "Fix[U+202E]typo"?')
  })
})

describe('ApprovalsPanel decision confirm card', () => {
  it('renders the card with the request changes text and both buttons', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(
      createElement(ApprovalsPanel, {
        client,
        initialApprovals: APPROVALS,
        initialAgents: AGENTS,
        initialConfirmOpen: { id: 'approval-1', decision: 'request-revision' },
      })
    )
    expect(html).toContain('role="region"')
    expect(html).toContain('aria-label="Confirm approval decision"')
    expect(html).toContain('Request changes on &quot;Raise the monthly budget&quot;?')
    expect(html).toContain('>Request changes</button>')
    expect(html).toContain('>Cancel</button>')
  })

  it('opens only one card at a time', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(
      createElement(ApprovalsPanel, {
        client,
        initialApprovals: APPROVALS,
        initialAgents: AGENTS,
        initialConfirmOpen: { id: 'approval-2', decision: 'approve' },
      })
    )
    expect((html.match(/brief-confirm-card/g) ?? [])).toHaveLength(1)
    expect(html).toContain('Approve &quot;Hire Planner&quot;?')
    expect(html).not.toContain('Raise the monthly budget&quot;?')
  })

  it('renders no card until a decision is asked for', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(
      createElement(ApprovalsPanel, {
        client,
        initialApprovals: APPROVALS,
        initialAgents: AGENTS,
      })
    )
    expect(html).not.toContain('aria-label="Confirm approval decision"')
    expect(html).not.toContain('brief-confirm-card')
  })
})
