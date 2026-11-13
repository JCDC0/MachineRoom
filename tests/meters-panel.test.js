import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createMockClient } from '../src/control/mock.js'
import { costLabels } from '../src/engine/board.js'
import MetersPanel, { CostsModeContext } from '../src/ui/panels/MetersPanel.jsx'

const SPEND_NOTE = 'Spend comes from the lane run records. Budgets are not set here.'
const SAMPLE = costLabels('replay')

const COSTS = {
  summary: { spendCents: 405, budgetCents: 0, utilizationPercent: null },
  byAgent: [
    { agentId: 'agent-claude', agentName: 'Claude Code', costCents: 218, inputTokens: 310000, outputTokens: 26000 },
    { agentId: 'agent-opencode', agentName: 'OpenCode', costCents: 187, inputTokens: 214000, outputTokens: 31000 },
    { agentId: 'agent-agy', agentName: 'agy', costCents: 0, inputTokens: null, outputTokens: null },
    { agentId: 'agent-new', agentName: 'New lane', costCents: 0, inputTokens: 500, outputTokens: 0 },
  ],
  quota: [],
}

function renderPanel(costs = COSTS, costMode = null) {
  const panel = createElement(MetersPanel, {
    client: createMockClient({ latencyMs: 0 }),
    initialCosts: costs,
  })
  if (costMode == null) return renderToString(panel)
  return renderToString(createElement(CostsModeContext.Provider, { value: costMode }, panel))
}

describe('MetersPanel', () => {
  it('labels made-up costs in a replay and a demo', () => {
    for (const costMode of ['replay', 'demo']) {
      const html = renderPanel(COSTS, costMode)
      expect(html).toContain(SAMPLE.title)
      expect(html).toContain(SAMPLE.note)
    }
  })

  it('leaves a live room with the plain spend title and no sample note', () => {
    const html = renderPanel(COSTS, 'live')
    expect(html).toContain('Spend')
    expect(html).not.toContain(SAMPLE.title)
    expect(html).not.toContain(SAMPLE.note)
  })

  it('shows this month spend and the tokens per lane', () => {
    const html = renderPanel()
    expect(html).toContain('Spent this month')
    expect(html).toContain('$4.05')
    expect(html).toContain('Claude Code')
    expect(html).toContain('$2.18')
    expect(html).toContain('310.0k in / 26.0k out')
    expect(html).toContain('OpenCode')
    expect(html).toContain('$1.87')
    expect(html).toContain('214.0k in / 31.0k out')
    expect(html).toContain('agy')
    expect(html).toContain('tokens not reported')
    expect(html).toContain('500 in / 0 out')
  })

  it('shows the removed lanes spend after the lanes in the roster', () => {
    const costs = {
      summary: { spendCents: 445, budgetCents: 0, utilizationPercent: null },
      byAgent: [
        ...COSTS.byAgent,
        {
          agentId: 'removed-lanes',
          agentName: 'Removed lanes',
          costCents: 40,
          todayCents: 40,
          inputTokens: 1000,
          outputTokens: 200,
        },
      ],
      quota: [],
    }
    const html = renderPanel(costs)
    expect(html).toContain('Removed lanes')
    expect(html).toContain('$4.45')
    expect(html).toContain('$0.40')
    expect(html).toContain('1.0k in / 200 out')
    expect(html.indexOf('Removed lanes')).toBeGreaterThan(html.indexOf('New lane'))
  })

  it('puts the spend note under the lane rows', () => {
    const html = renderPanel()
    expect(html).toContain(SPEND_NOTE)
    expect(html.indexOf(SPEND_NOTE)).toBeGreaterThan(html.indexOf('Claude Code'))
    expect(html.indexOf(SPEND_NOTE)).toBeGreaterThan(html.indexOf('New lane'))
  })

  it('renders no input and no confirm card', () => {
    const html = renderPanel()
    expect(html).not.toContain('<input')
    expect(html).not.toContain('aria-label="Confirm budget"')
    expect(html).not.toContain('brief-confirm-card')
    expect(html).not.toContain('>Set budget</button>')
    expect(html).not.toContain('>Save</button>')
    expect(html).not.toContain('>Cancel</button>')
  })

  it('offers no budget editor wording', () => {
    const html = renderPanel()
    expect(html).not.toContain('Company Budget')
    expect(html).not.toContain('Agent Budgets')
    expect(html).not.toContain('No limit')
    expect(html).not.toContain('monthly budget')
    expect(html).not.toContain('Budget in dollars')
  })

  it('has no Backups section and no Paperclip wording', () => {
    const html = renderPanel()
    expect(html).not.toContain('Backups')
    expect(html).not.toContain('Paperclip')
  })
})
