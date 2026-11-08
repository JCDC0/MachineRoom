import { describe, expect, it } from 'vitest'
import { AGENT_NAME_MAX } from '../src/ui/sidebar.js'
import {
  DIRECT_HARNESS,
  DIRECT_KEY_PROBLEM,
  MAX_SUBS,
  affectedSubText,
  childConfirmText,
  childDetail,
  childDraft,
  childFormProblem,
  childHarnesses,
  convertPlan,
  deleteLaneText,
  droppedLaneLine,
  familyMeta,
  familyTree,
  harnessEfforts,
  harnessGroups,
  harnessLabel,
  harnessModels,
  hideLaneText,
  keyNames,
  labelProblem,
  laneCountLine,
  moreLanesLabel,
  proposalRows,
  rowText,
  splitMoreLanes,
  stateWord,
  subsLosingLanes,
  teamLanePool,
  teamRows,
} from '../src/ui/family.js'

const HARNESSES = {
  harnesses: [
    { key: 'claude', name: 'Claude Code', available: true, models: [{ id: 'sonnet', label: 'Sonnet' }], efforts: ['low', 'high'] },
    { key: 'opencode', name: 'OpenCode', available: true, models: [{ id: 'qwen', label: 'Qwen' }], efforts: [] },
    { key: 'agy', name: 'Antigravity', available: false, models: [], efforts: [] },
    { key: 'acp', name: 'ACP', available: true, models: [], efforts: [] },
  ],
}

const MODELS = {
  models: [
    { id: 'claude-x', harness: 'claude', label: 'Claude X' },
    { id: 'opencode-y', harness: 'opencode', label: 'OpenCode Y' },
    { id: 'deepseek/deepseek-v4.1-flash-1017', harness: DIRECT_HARNESS, label: 'DeepSeek v4.1 Flash' },
  ],
}

describe('the family tree order', () => {
  const answer = {
    nodes: [
      {
        id: 'frontend',
        kind: 'sub',
        label: 'Frontend',
        harness: 'claude',
        model: 'opus',
        effort: 'high',
        parent: 'orchestrator',
        children: ['opencode', 'editor', 'wrong'],
      },
      {
        id: 'orchestrator',
        kind: 'orchestrator',
        label: 'Orchestrator',
        harness: 'claude',
        model: 'opus',
        parent: null,
        children: ['frontend', 'designer'],
      },
      { id: 'opencode', kind: 'lane', label: 'OpenCode', parent: 'frontend', working: true, custom: true },
      { id: 'editor', kind: 'lane', label: 'Editor', parent: 'frontend', active: false },
      { id: 'designer', kind: 'lane', label: 'Designer', parent: 'orchestrator' },
      { id: 'wrong', kind: 'lane', label: 'Wrong', parent: 'orchestrator' },
      { id: 'orphan', kind: 'lane', label: 'Orphan', parent: 'missing' },
      { id: 'orchestrator', kind: 'lane', label: 'Again', parent: 'orchestrator' },
    ],
    keys: [{ name: 'main' }, 'backup', { name: 'main' }],
    proposals: [
      { id: 'p1', from: 'orchestrator', parent: 'orchestrator', label: 'Writer', harness: 'claude', model: 'sonnet', reason: 'More hands', createdAt: '2026-10-25T10:00:00Z' },
      { id: 'p1', from: 'again', label: 'Again' },
      null,
    ],
  }

  it('walks the root first, then its children by their listed order', () => {
    const tree = familyTree(answer)
    expect(tree.rows.map((row) => [row.id, row.depth])).toEqual([
      ['orchestrator', 0],
      ['frontend', 1],
      ['opencode', 2],
      ['editor', 2],
      ['designer', 1],
      ['wrong', 1],
      ['orphan', 0],
    ])
    expect(tree.root.id).toBe('orchestrator')
    expect(tree.rows.find((row) => row.id === 'opencode')).toMatchObject({
      kind: 'lane',
      label: 'OpenCode',
      working: true,
      custom: true,
    })
    expect(tree.rows.find((row) => row.id === 'editor')).toMatchObject({ active: false })
  })

  it('keeps a turned-off lane in the rows and names its state off', () => {
    const tree = familyTree({
      nodes: [
        { id: 'orchestrator', kind: 'orchestrator', children: ['a'] },
        { id: 'a', kind: 'lane', label: 'A', parent: 'orchestrator', active: false },
      ],
    })
    expect(tree.rows.map((row) => row.id)).toEqual(['orchestrator', 'a'])
    expect(stateWord(tree.rows[1])).toBe('off')
  })

  it('drops a duplicate node and falls back for a missing label', () => {
    const tree = familyTree({
      nodes: [
        { id: 'root', kind: 'orchestrator', children: ['a'] },
        { id: 'a', kind: 'lane', parent: 'root' },
        { id: 'a', kind: 'lane', label: 'Again', parent: 'root' },
      ],
    })
    expect(tree.nodes).toHaveLength(2)
    expect(tree.rows.map((row) => row.id)).toEqual(['root', 'a'])
    expect(tree.nodes[0].label).toBe('Orchestrator')
    expect(tree.nodes[1].label).toBe('Code agent')
  })

  it('keeps the tree standing when the answer is empty or broken', () => {
    expect(familyTree(null).rows).toEqual([])
    expect(familyTree({ nodes: 'no' }).rows).toEqual([])
    expect(familyTree({ nodes: [{ id: '', label: 'No id' }] }).rows).toEqual([])
  })

  it('lists the keys and the requests beside the tree', () => {
    const tree = familyTree(answer)
    expect(tree.keys).toEqual(['main', 'backup'])
    expect(tree.proposals).toHaveLength(1)
    expect(tree.proposals[0]).toMatchObject({
      id: 'p1',
      from: 'orchestrator',
      label: 'Writer',
      harness: 'claude',
      model: 'sonnet',
      reason: 'More hands',
    })
  })
})

describe('a node line', () => {
  it('joins the harness, model and effort', () => {
    expect(familyMeta({ harness: 'claude', model: 'opus', effort: 'high' })).toBe('claude · opus · high')
    expect(familyMeta({ harness: 'machineroom', model: 'openrouter/flash', effort: '' })).toBe(
      'Direct API · openrouter/flash · default'
    )
    expect(familyMeta({})).toBe('harness unknown · no model · default')
  })

  it('names the machineroom harness Direct API', () => {
    expect(harnessLabel('machineroom')).toBe('Direct API')
    expect(harnessLabel({ key: 'machineroom', name: 'MachineRoom' })).toBe('Direct API')
    expect(harnessLabel({ key: 'opencode', name: 'OpenCode' })).toBe('OpenCode')
    expect(harnessLabel('claude')).toBe('claude')
    expect(harnessLabel(null)).toBe('')
  })

  it('names the state dot', () => {
    expect(stateWord({ working: true })).toBe('working')
    expect(stateWord({ working: true, active: false })).toBe('working')
    expect(stateWord({ active: false })).toBe('off')
    expect(stateWord({})).toBe('idle')
  })

  it('shows a label or says what to write', () => {
    expect(labelProblem(' Writer ')).toBe('')
    expect(labelProblem('')).toBe('Write a label for the agent.')
    expect(labelProblem('x'.repeat(AGENT_NAME_MAX + 1))).toBe(
      `Keep the label to ${AGENT_NAME_MAX} characters.`
    )
  })

  it('names an orchestrator state and a working lane task', () => {
    expect(rowText({ kind: 'orchestrator', working: false }, 'working')).toBe('working')
    expect(rowText({ kind: 'sub', working: false }, 'paused')).toBe('paused')
    expect(rowText({ kind: 'orchestrator', working: false }, 'idle')).toBe('waiting')
    expect(rowText({ kind: 'sub', working: true }, 'paused')).toBe('working')
    expect(rowText({ kind: 'lane', working: true }, '', ' JC-19 ')).toBe('JC-19')
    expect(rowText({ kind: 'lane', working: false }, '', 'JC-19')).toBe('')
    expect(rowText(null)).toBe('')
  })
})

describe('the key slots', () => {
  it('reads names from either answer', () => {
    expect(keyNames({ keys: [{ name: 'main' }, 'backup', { name: 'main' }, ''] })).toEqual(['main', 'backup'])
    expect(keyNames(['one', 'two'])).toEqual(['one', 'two'])
    expect(keyNames(null)).toEqual([])
  })
})

describe('the harness choices', () => {
  it('splits the harnesses into the ones here and the ones missing', () => {
    const groups = harnessGroups(HARNESSES)
    expect(groups.available.map((harness) => harness.key)).toEqual(['claude', 'opencode', 'acp'])
    expect(groups.unavailable.map((harness) => harness.key)).toEqual(['agy'])
    expect(harnessModels(groups.all[0], null).map((model) => model.id)).toEqual(['sonnet'])
    expect(harnessEfforts(groups.all[0])).toEqual(['low', 'high'])
    expect(harnessEfforts(groups.all[1])).toEqual([])
  })

  it('falls back to the bridge model list for a harness key', () => {
    expect(harnessModels('claude', MODELS).map((model) => model.id)).toEqual(['claude-x'])
    expect(harnessModels({ key: 'opencode', models: [], fallback: true }, MODELS).map((model) => model.id)).toEqual([
      'opencode-y',
    ])
    expect(harnessModels('unknown', MODELS)).toEqual([])
  })

  it('offers every available harness and Direct API once', () => {
    const offered = childHarnesses(HARNESSES, MODELS)
    expect(offered.map((harness) => harness.key)).toEqual(['claude', 'opencode', 'acp', DIRECT_HARNESS])
    expect(offered.at(-1)).toMatchObject({
      key: 'machineroom',
      name: 'Direct API',
      available: true,
      models: [],
    })
    const listed = childHarnesses(
      {
        harnesses: [
          { key: 'claude', name: 'Claude Code', available: true, models: [{ id: 'sonnet' }], efforts: ['high'] },
          { key: 'machineroom', name: 'MachineRoom', available: true, models: [{ id: 'm1' }], efforts: ['low'] },
        ],
      },
      MODELS
    )
    expect(listed.filter((harness) => harness.key === DIRECT_HARNESS)).toHaveLength(1)
    expect(listed.at(-1).name).toBe('Direct API')
    expect(listed.at(-1).models).toEqual([{ id: 'm1', label: 'm1' }])
  })

  it('starts the form on OpenCode when it is here', () => {
    expect(childDraft(HARNESSES, MODELS)).toMatchObject({
      label: '',
      harness: 'opencode',
      model: 'qwen',
      effort: '',
    })
  })

  it('prefers the OpenCode default model and max effort', () => {
    const preferred = {
      harnesses: [
        { key: 'claude', available: true, models: [{ id: 'sonnet' }], efforts: ['low'] },
        {
          key: 'opencode',
          available: true,
          models: [{ id: 'other' }, { id: 'opencode-go/deepseek-v4.1-flash' }],
          efforts: ['low', 'max'],
        },
      ],
    }
    expect(childDraft(preferred, null)).toMatchObject({
      harness: 'opencode',
      model: 'opencode-go/deepseek-v4.1-flash',
      effort: 'max',
    })
  })

  it('falls back to the first available harness when OpenCode is missing', () => {
    const fallback = { harnesses: [HARNESSES.harnesses[0]] }
    expect(childDraft(fallback, null)).toMatchObject({
      harness: 'claude',
      model: 'sonnet',
      effort: 'low',
    })
  })
})

describe('the add child form', () => {
  const draft = { label: 'Writer', harness: 'claude', model: 'sonnet', effort: 'high' }

  it('checks the label, the harness, the model and the effort', () => {
    expect(childFormProblem(draft, { harnesses: HARNESSES, models: MODELS })).toBe('')
    expect(childFormProblem({ ...draft, label: ' ' }, { harnesses: HARNESSES, models: MODELS })).toBe(
      'Write a label for the agent.'
    )
    expect(childFormProblem({ ...draft, label: 'x'.repeat(41) }, { harnesses: HARNESSES, models: MODELS })).toBe(
      'Keep the label to 40 characters.'
    )
    expect(childFormProblem({ ...draft, harness: 'agy' }, { harnesses: HARNESSES, models: MODELS })).toBe(
      'Choose a harness.'
    )
    expect(childFormProblem({ ...draft, harness: 'nope' }, { harnesses: HARNESSES, models: MODELS })).toBe(
      'Choose a harness.'
    )
    expect(childFormProblem({ ...draft, harness: 'acp', model: '' }, { harnesses: HARNESSES, models: MODELS })).toBe(
      'This harness has no models.'
    )
    expect(childFormProblem({ ...draft, model: 'other' }, { harnesses: HARNESSES, models: MODELS })).toBe(
      'Choose a model for this harness.'
    )
    expect(childFormProblem({ ...draft, effort: 'max' }, { harnesses: HARNESSES, models: MODELS })).toBe(
      'Choose an effort for this harness.'
    )
    const plain = { label: 'Writer', harness: 'opencode', model: 'qwen', effort: '' }
    expect(childFormProblem(plain, { harnesses: HARNESSES, models: MODELS })).toBe('')
    expect(childFormProblem({ ...plain, effort: 'max' }, { harnesses: HARNESSES, models: MODELS })).toBe(
      'This harness has no effort levels.'
    )
  })

  it('checks Direct API against the bridge model list', () => {
    const direct = {
      label: 'Writer',
      harness: DIRECT_HARNESS,
      model: 'OpenRouter/flash',
      effort: '',
    }
    expect(childFormProblem(direct, { harnesses: HARNESSES, models: MODELS })).toBe(DIRECT_KEY_PROBLEM)
    expect(
      childFormProblem(direct, {
        harnesses: HARNESSES,
        models: MODELS,
        directModels: [{ id: 'OpenRouter/flash', label: 'flash (OpenRouter)' }],
      })
    ).toBe('')
    expect(
      childFormProblem({ ...direct, model: 'other' }, {
        harnesses: HARNESSES,
        models: MODELS,
        directModels: [{ id: 'OpenRouter/flash', label: 'flash (OpenRouter)' }],
      })
    ).toBe('Choose a model for this harness.')
  })

  it('names the parent and the change on the confirm card', () => {
    expect(childConfirmText(draft, { kind: 'orchestrator', label: 'Orchestrator' })).toBe(
      'Create "Writer" under Orchestrator?'
    )
    expect(childConfirmText(draft, { kind: 'sub', label: 'Frontend' })).toBe(
      'Create "Writer" under Frontend?'
    )
    expect(childConfirmText(draft, { kind: 'lane', label: 'Editor', id: 'editor' })).toBe(
      'Editor becomes a sub orchestrator and leads the new agent.'
    )
    expect(childDetail(draft, HARNESSES, MODELS)).toBe('Claude Code · sonnet · high')
  })
})

describe('turning a lane into a sub orchestrator', () => {
  const ladder = {
    subs: [
      {
        id: 'frontend',
        name: 'Frontend',
        harness: 'claude',
        model: 'opus',
        lanes: ['a'],
        scope: ['src/**'],
        restricted: true,
        setBy: 'owner',
      },
    ],
  }

  it('leads the new child and makes the old lane inactive', () => {
    const plan = convertPlan(
      ladder,
      { id: 'editor', label: 'Editor', harness: 'opencode', model: 'qwen' },
      'opencode-2',
      ['editor', 'a']
    )
    expect(plan.problem).toBe('')
    expect(plan.inactive).toEqual(['editor'])
    expect(plan.sub).toEqual({
      id: 'editor-2',
      name: 'Editor',
      harness: 'opencode',
      model: 'qwen',
      lanes: ['opencode-2'],
      scope: ['**'],
      restricted: true,
      setBy: 'owner',
    })
    expect(plan.ladder.subs).toHaveLength(2)
    expect(plan.ladder.subs[0]).toEqual(ladder.subs[0])
  })

  it('keeps the sub id free of the other subs and the lane keys', () => {
    const plan = convertPlan(
      ladder,
      { id: 'other', label: 'Frontend', harness: 'claude', model: 'opus' },
      'opencode-2',
      ['frontend', 'other']
    )
    expect(plan.sub.id).toBe('frontend-2')
    const lanePlan = convertPlan(
      ladder,
      { id: 'a', label: 'A', harness: 'claude', model: 'opus' },
      'opencode-2',
      ['a']
    )
    expect(lanePlan.sub.id).toBe('a-2')
  })

  it('refuses a sub past the limit and a lane with no name', () => {
    const subs = Array.from({ length: MAX_SUBS }, (_, index) => ({ id: `sub-${index}`, lanes: [], scope: ['**'] }))
    expect(convertPlan({ subs }, { id: 'editor', label: 'Editor' }, 'opencode-2').problem).toBe(
      `There are at most ${MAX_SUBS} sub orchestrators.`
    )
    expect(convertPlan(ladder, { id: '', label: 'Editor' }, 'opencode-2').problem).toBe(
      'The lane has no name.'
    )
  })
})

describe('the subs that lose lanes', () => {
  const ladder = {
    subs: [
      { id: 'frontend', name: 'Frontend', lanes: ['a', 'b'] },
      { id: 'backend', name: 'Backend', lanes: ['c'] },
    ],
  }

  it('names every other sub that loses lanes or goes away', () => {
    const affected = subsLosingLanes(ladder.subs, [' b ', 'c', 'b', '']).map((row) => ({
      ...row,
      removed: row.empty,
    }))
    expect(affected).toEqual([
      { id: 'frontend', name: 'Frontend', lost: 1, empty: false, removed: false },
      { id: 'backend', name: 'Backend', lost: 1, empty: true, removed: true },
    ])
    expect(affectedSubText(affected)).toBe('Frontend loses 1 agent. Backend goes away.')
  })

  it('says a sub loses all its agents when no row marks it removed', () => {
    const affected = subsLosingLanes(ladder.subs, ['a', 'b'])
    expect(affected).toEqual([{ id: 'frontend', name: 'Frontend', lost: 2, empty: true }])
    expect(affectedSubText(affected)).toBe('Frontend loses all its agents.')
  })
})

describe('the requests', () => {
  it('keeps one row per request and fills the label', () => {
    const rows = proposalRows([
      { id: 'p1', from: 'orchestrator', label: 'Writer', reason: 'More hands' },
      { id: 'p1', from: 'again', label: 'Again' },
      { id: 'p2', from: 'frontend' },
      null,
    ])
    expect(rows.map((row) => row.id)).toEqual(['p1', 'p2'])
    expect(rows[0]).toMatchObject({ from: 'orchestrator', label: 'Writer', reason: 'More hands' })
    expect(rows[1].label).toBe('Code agent')
  })
})

describe('the project lane count', () => {
  it('counts the active lanes of the lanes this project shows', () => {
    expect(
      laneCountLine([
        { id: 'orchestrator', kind: 'orchestrator', active: true },
        { id: 'a', kind: 'lane', active: true },
        { id: 'b', kind: 'lane', active: false },
        { id: 'c', kind: 'lane', active: true },
      ])
    ).toBe('2 of 3 lanes in this project')
    expect(laneCountLine([])).toBe('0 of 0 lanes in this project')
    expect(laneCountLine(null)).toBe('0 of 0 lanes in this project')
  })

  it('splits the inactive lanes off the tree and labels the row', () => {
    const rows = [
      { id: 'orchestrator', kind: 'orchestrator' },
      { id: 'a', kind: 'lane', active: true },
      { id: 'b', kind: 'lane', active: false },
      { id: 'frontend', kind: 'sub' },
      { id: 'c', kind: 'lane', active: false },
    ]
    const split = splitMoreLanes(rows)
    expect(split.main.map((row) => row.id)).toEqual(['orchestrator', 'a', 'frontend'])
    expect(split.more.map((row) => row.id)).toEqual(['b', 'c'])
    expect(moreLanesLabel(1)).toBe('1 more lane')
    expect(moreLanesLabel(2)).toBe('2 more lanes')
    expect(moreLanesLabel(0)).toBe('0 more lanes')
  })
})

describe('the saved teams and the lane cards', () => {
  it('reads the saved team names once each', () => {
    const rows = teamRows({
      teams: [
        { name: 'Weekend', lanes: ['a', 'b'] },
        { name: 'Weekend', lanes: ['c'] },
        { name: '  ' },
        null,
        { name: 'Night' },
      ],
    })
    expect(rows.map((row) => row.name)).toEqual(['Weekend', 'Night'])
    expect(rows[0].lanes).toEqual(['a', 'b'])
    expect(teamRows(null)).toEqual([])
  })

  it('names the lanes a team apply dropped', () => {
    expect(droppedLaneLine({ dropped: { lanes: ['a', 'b'] } })).toBe('Dropped a, b.')
    expect(droppedLaneLine({ dropped: { lanes: [] } })).toBe('')
    expect(droppedLaneLine({})).toBe('')
  })

  it('keeps a hidden lane out of the Build a team pool', () => {
    const pool = teamLanePool(
      {
        lanes: [
          { key: 'a', name: 'A', active: true },
          { key: 'hidden', name: 'Hidden', active: true, hidden: true },
          { key: 'b', name: 'B', active: false },
        ],
      },
      { subs: [] }
    )
    expect(pool.map((row) => row.key)).toEqual(['a', 'b'])
  })

  it('gives the hide and delete cards their sentence', () => {
    expect(hideLaneText('OpenCode', 'machine-room')).toBe(
      'Hide OpenCode in machine-room? It stays in your other projects.'
    )
    expect(hideLaneText('', '')).toBe('Hide this agent in this project? It stays in your other projects.')
    expect(deleteLaneText('OpenCode')).toBe(
      'Delete OpenCode in every project? Its runs stay in the records.'
    )
  })
})
