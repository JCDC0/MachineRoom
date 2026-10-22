import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createMockClient } from '../src/control/mock.js'
import MetersPanel, { budgetConfirmText } from '../src/ui/panels/MetersPanel.jsx'

const AGENT = {
  id: 'agent-claude',
  key: 'claude-code',
  name: 'Claude Code',
  adapterType: 'claude_local',
  role: 'engineer',
  status: 'idle',
  budgetMonthlyCents: 500,
  spentMonthlyCents: 0,
}

const COSTS = {
  summary: { spendCents: 0, budgetCents: 1000, utilizationPercent: 0 },
  byAgent: [],
  quota: [],
}

describe('budgetConfirmText', () => {
  it('names the agent and the monthly budget in dollars', () => {
    expect(budgetConfirmText('Claude Code', 1234)).toBe(
      "Set Claude Code's monthly budget to $12.34 in Paperclip?"
    )
    expect(budgetConfirmText('Hermes', 29)).toBe(
      "Set Hermes's monthly budget to $0.29 in Paperclip?"
    )
  })

  it('shows a control character in the name as visible text', () => {
    expect(budgetConfirmText('Plan\u202Ener', 500)).toBe(
      "Set Plan[U+202E]ner's monthly budget to $5.00 in Paperclip?"
    )
  })
})

describe('MetersPanel budget confirm card', () => {
  it('renders the card with the text and both buttons', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(
      createElement(MetersPanel, {
        client,
        initialCosts: COSTS,
        initialAgents: [AGENT],
        initialEditingAgentId: AGENT.id,
        initialEditDollarValue: '12.34',
        initialConfirmOpen: true,
      })
    )
    expect(html).toContain('role="region"')
    expect(html).toContain('aria-label="Confirm budget"')
    expect(html).toContain('Set Claude Code&#x27;s monthly budget to $12.34 in Paperclip?')
    expect(html).toContain('>Set budget</button>')
    expect(html).toContain('>Cancel</button>')
  })

  it('renders no card until the budget is asked for', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(
      createElement(MetersPanel, {
        client,
        initialCosts: COSTS,
        initialAgents: [AGENT],
        initialEditingAgentId: AGENT.id,
        initialEditDollarValue: '12.34',
      })
    )
    expect(html).not.toContain('aria-label="Confirm budget"')
    expect(html).not.toContain('>Set budget</button>')
  })
})
