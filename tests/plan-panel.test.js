import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createMockClient } from '../src/control/mock.js'
import DispatchPanel from '../src/ui/panels/DispatchPanel.jsx'
import ControlDrawer from '../src/ui/panels/ControlDrawer.jsx'
import PlanPanel, { addConfirmText, addedText } from '../src/ui/panels/PlanPanel.jsx'
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

const ONE_BRIEF_ANSWER = {
  status: 'ready',
  briefs: [BRIEF_ONE],
  problems: [],
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
      text: 'Add the plan route in the bridge with tests.',
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

  it('addConfirmText names one or more briefs and the file, and addedText lists the ids', () => {
    expect(addConfirmText(1)).toBe(
      'Add 1 brief to docs/agents/TASKS.md? Lanes can run them after that. Nothing is committed.'
    )
    expect(addConfirmText(2)).toBe(
      'Add 2 briefs to docs/agents/TASKS.md? Lanes can run them after that. Nothing is committed.'
    )
    expect(addedText(['C7a'])).toBe('Added C7a.')
    expect(addedText(['C7a', 'C7b'])).toBe('Added C7a, C7b.')
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
    expect(html).toContain('Ask PLANNER to split this goal into briefs? The bridge refuses plan requests now: plans come from lane runs.')
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
    expect(html).toContain('Add the plan route in the bridge with tests.')
    expect(html).toContain('Reading the route.')
    expect(html).toContain('Copy as Markdown')
    expect(html).toContain('Brief C7b names no test.')
    expect(html).toContain('class="plan-problem"')
  })

  it('shows each brief text below its meta line through visibleText', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(createElement(PlanPanel, { client, initialAnswer: ANSWER }))
    expect(html).toContain('class="plan-brief-text mono"')
    expect(html).toContain('Add the plan route in the bridge with tests.')
    expect(html).toContain('Add the tab. Keep the panel read only.')

    const hidden = {
      status: 'ready',
      briefs: [{ ...BRIEF_ONE, text: 'Do it.\u202Enow' }],
      problems: [],
    }
    const escaped = renderToString(createElement(PlanPanel, { client, initialAnswer: hidden }))
    expect(escaped).toContain('[U+202E]now')
  })

  it('gives every ready brief a ticked checkbox and an Add to TASKS.md button', async () => {
    const client = createMockClient({ latencyMs: 0 })
    const created = await client.askPlanner('Plan the room work')
    const answer = await client.plan(created.issueId)
    const html = renderToString(
      createElement(PlanPanel, {
        client,
        initialIssue: created,
        initialAnswer: { ...answer, briefs: [BRIEF_ONE, BRIEF_TWO] },
      })
    )
    expect((html.match(/type="checkbox"/g) ?? [])).toHaveLength(2)
    expect((html.match(/checked=""/g) ?? [])).toHaveLength(2)
    expect(html).toContain('Add to TASKS.md')
    expect(html).not.toContain('>Add</button>')
  })

  it('turns the Add to TASKS.md button off when no brief is ticked', async () => {
    const client = createMockClient({ latencyMs: 0 })
    const created = await client.askPlanner('Plan the room work')
    const answer = await client.plan(created.issueId)
    const html = renderToString(
      createElement(PlanPanel, {
        client,
        initialIssue: created,
        initialAnswer: { ...answer, briefs: [BRIEF_ONE, BRIEF_TWO] },
        initialSelected: [],
      })
    )
    expect((html.match(/checked=""/g) ?? [])).toHaveLength(0)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Add to TASKS\.md<\/button>/)
  })

  it('reads the confirm sentence for one brief and for two briefs', async () => {
    const client = createMockClient({ latencyMs: 0 })
    const one = renderToString(
      createElement(PlanPanel, {
        client,
        initialAnswer: ONE_BRIEF_ANSWER,
        initialAcceptOpen: true,
      })
    )
    expect(one).toContain('Add 1 brief to docs/agents/TASKS.md? Lanes can run them after that. Nothing is committed.')

    const two = renderToString(
      createElement(PlanPanel, {
        client,
        initialAnswer: ANSWER,
        initialAcceptOpen: true,
      })
    )
    expect(two).toContain('Add 2 briefs to docs/agents/TASKS.md? Lanes can run them after that. Nothing is committed.')
  })

  it('shows the added line in a status line', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(
      createElement(PlanPanel, {
        client,
        initialAnswer: ANSWER,
        initialAdded: 'Added C7a, C7b.',
      })
    )
    expect(html).toContain('class="plan-added mono"')
    expect(html).toContain('Added C7a, C7b.')
  })

  it('shows an accept error in red', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(
      createElement(PlanPanel, {
        client,
        initialAnswer: ANSWER,
        initialAcceptOpen: true,
        initialAcceptError: 'Brief C7b is not in the plan, or has a problem now.',
      })
    )
    expect(html).toContain('class="plan-problem mono plan-accept-error"')
    expect(html).toContain('Brief C7b is not in the plan, or has a problem now.')
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

  it('shows a Dispatch button for each added id and none before an add', () => {
    const client = createMockClient({ latencyMs: 0 })
    const onSelectControlTarget = () => {}
    const before = renderToString(
      createElement(PlanPanel, { client, initialAnswer: ANSWER, onSelectControlTarget })
    )
    expect(before).not.toContain('Dispatch C7')
    expect(before).not.toContain('plan-dispatch-btn')

    const after = renderToString(
      createElement(PlanPanel, {
        client,
        initialAnswer: ANSWER,
        initialAdded: 'Added C7a, C7b.',
        initialAddedIds: ['C7a', 'C7b'],
        onSelectControlTarget,
      })
    )
    expect(after).toContain('>Dispatch C7a</button>')
    expect(after).toContain('>Dispatch C7b</button>')
    expect((after.match(/plan-dispatch-btn/g) ?? [])).toHaveLength(2)
  })

  it('shows no Dispatch button when the panel has no way to open Dispatch', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(
      createElement(PlanPanel, {
        client,
        initialAnswer: ANSWER,
        initialAdded: 'Added C7a.',
        initialAddedIds: ['C7a'],
      })
    )
    expect(html).not.toContain('plan-dispatch-btn')
  })

  it('shows the missing brief sentence in DispatchPanel and picks nothing', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(
      createElement(DispatchPanel, {
        client,
        initialAgents: [{ id: 'agent-opencode', name: 'OpenCode Go', role: 'engineer' }],
        initialModels: [],
        initialBriefs: [BRIEF_ONE],
        targetBriefId: 'C9z',
      })
    )
    expect(html).toContain('Brief C9z is not in the brief list.')
    expect(html).toContain('class="brief-target-problem mono"')
    expect(html).not.toContain('Route</label>')

    const found = renderToString(
      createElement(DispatchPanel, {
        client,
        initialAgents: [{ id: 'agent-opencode', name: 'OpenCode Go', role: 'engineer' }],
        initialModels: [],
        initialBriefs: [BRIEF_ONE],
        targetBriefId: 'C7a',
      })
    )
    expect(found).not.toContain('is not in the brief list.')
  })
})