import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createMockClient } from '../src/control/mock.js'
import ControlDrawer from '../src/ui/panels/ControlDrawer.jsx'
import PlanPanel from '../src/ui/panels/PlanPanel.jsx'
import { canAsk, copyNote, copyText, planRows } from '../src/ui/panels/plan.js'

const BRIEF_ONE = {
  id: 'C7a',
  title: 'Add the plan route',
  owner: 'opencode',
  size: 'small',
  files: ['server/plans.js'],
  tests: ['tests/plans.test.js'],
  text: 'Add the plan route in the bridge with tests.',
  dependsOn: [],
}

const BRIEF_TWO = {
  id: 'C7b',
  title: 'Read the plan in the drawer',
  owner: 'hermes',
  size: 'medium',
  files: ['src/ui/panels/PlanPanel.jsx'],
  tests: ['tests/plan-panel.test.js'],
  text: 'Add the tab. Keep the panel read only.',
  dependsOn: ['C7a'],
}

const ANSWER = {
  status: 'ready',
  briefs: [BRIEF_ONE, BRIEF_TWO],
  problems: ['Brief C7b names no test.'],
}

const LANES = {
  opencode: { name: 'OpenCode' },
  hermes: { name: 'Hermes' },
}

describe('plan helpers', () => {
  it('canAsk accepts a trimmed goal of 1 to 2000 characters', () => {
    expect(canAsk('a')).toBe(true)
    expect(canAsk('  Split the work.  ')).toBe(true)
    expect(canAsk('a'.repeat(2000))).toBe(true)
    expect(canAsk('a'.repeat(2001))).toBe(false)
    expect(canAsk('')).toBe(false)
    expect(canAsk('   ')).toBe(false)
    expect(canAsk(null)).toBe(false)
    expect(canAsk(42)).toBe(false)
  })

  it('planRows reads the heading, size, files, tests and profile of each brief', () => {
    const rows = planRows(ANSWER, LANES)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      id: 'C7a',
      title: 'Add the plan route',
      owner: 'opencode',
      ownerName: 'OpenCode',
      heading: 'C7a. Add the plan route (OpenCode)',
      size: 'small',
      files: ['server/plans.js'],
      tests: ['tests/plans.test.js'],
    })
    expect(rows[0].profile).toMatchObject({
      files: 1,
      hasTests: true,
      clarity: 'clear',
      kind: 'change',
    })
    expect(rows[1].heading).toBe('C7b. Read the plan in the drawer (Hermes)')
    expect(rows[1].profile.files).toBe(1)
  })

  it('planRows falls back to the owner labels when no lanes are given', () => {
    const rows = planRows(ANSWER)
    expect(rows[0].ownerName).toBe('OpenCode')
    expect(rows[1].ownerName).toBe('Hermes')
    expect(planRows(null, LANES)).toEqual([])
    expect(planRows({ status: 'waiting', briefs: [], problems: [] }, LANES)).toEqual([])
  })

  it('copyText joins the briefMarkdown of every brief with a blank line', () => {
    const text = copyText(ANSWER, LANES)
    expect(text).toContain('**C7a. Add the plan route (OpenCode).** Add the plan route in the bridge with tests.')
    expect(text).toContain('Files: `server/plans.js`')
    expect(text).toContain('**C7b. Read the plan in the drawer (Hermes).** Add the tab. Keep the panel read only.')
    expect(text.split('\n\n')).toHaveLength(2)
    expect(copyText(ANSWER)).toContain('(OpenCode)')
    expect(copyText(null, LANES)).toBe('')
  })

  it('copyNote names the number of briefs and the next step', () => {
    expect(copyNote(1)).toBe('Copied 1 briefs. Paste them into TASKS.md and run the brief tests.')
    expect(copyNote(3)).toBe('Copied 3 briefs. Paste them into TASKS.md and run the brief tests.')
  })
})

describe('PlanPanel and ControlDrawer', () => {
  it('renders the empty tab with the goal box and the ask button', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(createElement(PlanPanel, { client }))
    expect(html).toContain('id="plan-goal"')
    expect(html).toContain('0 / 2000')
    expect(html).toContain('Ask the planner')
    expect(html).not.toContain('Waiting for PLANNER.')
    expect(html).not.toContain('Copy as Markdown')
  })

  it('renders the confirm card with the exact warning and both buttons', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(
      createElement(PlanPanel, {
        client,
        initialGoal: 'Split the room work',
        initialConfirmOpen: true,
      })
    )
    expect(html).toContain('Ask PLANNER to split this goal into briefs? It creates a task in Paperclip and spends from PLANNER&#x27;s budget.')
    expect(html).toContain('>Ask</button>')
    expect(html).toContain('>Cancel</button>')
  })

  it('renders the waiting state after a task was created', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(
      createElement(PlanPanel, {
        client,
        initialIssue: { issueId: 'issue-23', identifier: 'JC-23' },
        initialAnswer: { status: 'waiting', briefs: [], problems: [] },
      })
    )
    expect(html).toContain('Waiting for PLANNER.')
    expect(html).not.toContain('Copy as Markdown')
  })

  it('renders the ready list, the route waiting line and the problems in red', async () => {
    const client = createMockClient({ latencyMs: 0 })
    const created = await client.askPlanner('Plan the room work')
    const answer = await client.plan(created.issueId)
    const html = renderToString(
      createElement(PlanPanel, {
        client,
        initialIssue: created,
        initialAnswer: answer,
      })
    )
    expect(html).toContain('C7a. Add the plan route (OpenCode)')
    expect(html).toContain('Size: small')
    expect(html).toContain('server/plans.js')
    expect(html).toContain('tests/plans.test.js')
    expect(html).toContain('Reading the route.')
    expect(html).toContain('Copy as Markdown')
    expect(html).toContain('Brief C7b names no test.')
    expect(html).toContain('class="plan-problem"')
  })

  it('adds the Plan tab to the control drawer when the client can ask the planner', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(
      createElement(ControlDrawer, {
        client,
        open: true,
        activeTab: 'plan',
      })
    )
    expect(html).toContain('id="tab-plan"')
    expect(html).toContain('<span>Plan</span>')
    expect(html).toContain('id="plan-goal"')
  })
})
