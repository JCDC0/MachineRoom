import { describe, expect, it } from 'vitest'
import {
  DIRECT_HARNESS,
  assignSubLanesPlan,
  childConfirmText,
  childDetail,
  childDraft,
  childFormProblem,
  childHarnesses,
  convertPlan,
  familyMeta,
  familyTree,
  groupSubPlan,
  harnessEfforts,
  harnessGroups,
  harnessModels,
  keyFormProblem,
  keyNames,
  labelProblem,
  proposalRows,
  removeSubPlan,
  stateWord,
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
    expect(familyMeta({})).toBe('harness unknown · no model · default')
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
    expect(labelProblem('x'.repeat(41))).toBe('Keep the label to 40 characters.')
  })
})

describe('the key slots', () => {
  it('reads names from either answer', () => {
    expect(keyNames({ keys: [{ name: 'main' }, 'backup', { name: 'main' }, ''] })).toEqual(['main', 'backup'])
    expect(keyNames(['one', 'two'])).toEqual(['one', 'two'])
    expect(keyNames(null)).toEqual([])
  })

  it('checks a key name and a value', () => {
    expect(keyFormProblem('OpenRouter main', 'sk-test')).toBe('')
    expect(keyFormProblem('', 'sk-test')).toBe('Write a name for the key slot.')
    expect(keyFormProblem('x'.repeat(41), 'sk-test')).toBe('Keep the key name to 40 characters.')
    expect(keyFormProblem('bad/name', 'sk-test')).toBe('Use letters, digits, spaces, dashes or underscores in the key name.')
    expect(keyFormProblem('main', '')).toBe('Write the key.')
    expect(keyFormProblem('main', 'x'.repeat(501))).toBe('Keep the key to 500 characters.')
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
      models: [{ id: 'deepseek/deepseek-v4.1-flash-1017', label: 'DeepSeek v4.1 Flash' }],
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
    expect(listed.at(-1).models).toEqual([{ id: 'm1', label: 'm1' }])
  })

  it('starts the form on OpenCode when it is here', () => {
    expect(childDraft(HARNESSES, MODELS)).toMatchObject({
      label: '',
      harness: 'opencode',
      model: 'qwen',
      effort: '',
      key: '',
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
      model: 'deepseek/deepseek-v4.1-flash-1017',
      effort: '',
    }
    expect(childFormProblem(direct, { harnesses: HARNESSES, models: MODELS })).toBe('')
    expect(childFormProblem({ ...direct, model: 'other' }, { harnesses: HARNESSES, models: MODELS })).toBe(
      'Choose a model for this harness.'
    )
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

  it('refuses a sixth sub and a lane with no name', () => {
    const subs = Array.from({ length: 5 }, (_, index) => ({ id: `sub-${index}`, lanes: [], scope: ['**'] }))
    expect(convertPlan({ subs }, { id: 'editor', label: 'Editor' }, 'opencode-2').problem).toBe(
      'There are at most 5 sub orchestrators.'
    )
    expect(convertPlan(ladder, { id: '', label: 'Editor' }, 'opencode-2').problem).toBe(
      'The lane has no name.'
    )
  })
})

describe('grouping code agents under a sub orchestrator', () => {
  const ladder = {
    subs: [
      {
        id: 'frontend',
        name: 'Frontend',
        harness: 'claude',
        model: 'opus',
        lanes: ['a', 'b'],
        scope: ['src/**'],
        restricted: true,
        setBy: 'owner',
      },
      {
        id: 'backend',
        name: 'Backend',
        harness: 'opencode',
        model: 'qwen',
        lanes: ['c'],
        scope: ['**'],
        restricted: false,
        setBy: 'owner',
      },
    ],
  }
  const draft = { label: 'Platform', harness: 'opencode', model: 'qwen' }

  it('adds the sub and moves the selected lanes off the other subs', () => {
    const plan = groupSubPlan(ladder, draft, [' b ', 'c', 'b', ''])
    expect(plan.problem).toBe('')
    expect(plan.sub).toEqual({
      id: 'platform',
      name: 'Platform',
      harness: 'opencode',
      model: 'qwen',
      lanes: ['b', 'c'],
      scope: ['**'],
      restricted: false,
      setBy: 'owner',
    })
    expect(plan.ladder.subs).toHaveLength(2)
    expect(plan.ladder.subs[0]).toMatchObject({ id: 'frontend', lanes: ['a'] })
    expect(plan.ladder.subs[1]).toEqual(plan.sub)
  })

  it('drops a sub that loses its last lane and keeps one whose lanes do not change', () => {
    const plan = groupSubPlan(ladder, draft, ['c'])
    expect(plan.ladder.subs.map((sub) => sub.id)).toEqual(['frontend', 'platform'])
    expect(plan.ladder.subs[0]).toBe(ladder.subs[0])
  })

  it('defaults the harness and model and frees the id from subs and lane keys', () => {
    const plan = groupSubPlan(ladder, { label: 'Frontend' }, ['a'], ['frontend-2'])
    expect(plan.sub).toMatchObject({
      id: 'frontend-3',
      name: 'Frontend',
      harness: 'opencode',
      model: '',
    })
  })

  it('asks for a label, a lane and room under the limit', () => {
    expect(groupSubPlan(ladder, { label: ' ' }, ['a']).problem).toBe('Write a label for the agent.')
    expect(groupSubPlan(ladder, draft, ['', ' ']).problem).toBe('Select at least one code agent.')
    const full = { subs: Array.from({ length: 5 }, (_, index) => ({ id: `sub-${index}`, lanes: [`lane-${index}`] })) }
    expect(groupSubPlan(full, draft, ['a']).problem).toBe('There are at most 5 sub orchestrators.')
  })
})

describe('removing a sub orchestrator', () => {
  const ladder = {
    subs: [
      { id: 'frontend', name: 'Frontend', lanes: ['a'], scope: ['**'], restricted: false, setBy: 'owner' },
      { id: 'backend', name: 'Backend', lanes: ['b', 'c'], scope: ['**'], restricted: false, setBy: 'owner' },
    ],
  }

  it('returns its lanes to the orchestrator', () => {
    const plan = removeSubPlan(ladder, 'backend')
    expect(plan.problem).toBe('')
    expect(plan.removed).toBe(ladder.subs[1])
    expect(plan.ladder.subs.map((sub) => sub.id)).toEqual(['frontend'])
    expect(plan.ladder.subs.flatMap((sub) => sub.lanes)).toEqual(['a'])
  })

  it('asks which sub to remove when it is not there', () => {
    const plan = removeSubPlan(ladder, 'missing')
    expect(plan.problem).toBe('Choose a sub orchestrator to remove.')
    expect(plan.removed).toBeNull()
    expect(plan.ladder).toBe(ladder)
  })
})

describe('assigning lanes to a sub orchestrator', () => {
  const ladder = {
    subs: [
      { id: 'frontend', name: 'Frontend', lanes: ['a', 'b'], scope: ['**'], restricted: false, setBy: 'owner' },
      { id: 'backend', name: 'Backend', lanes: ['c', 'd'], scope: ['**'], restricted: false, setBy: 'owner' },
    ],
  }

  it('sets the sub lanes and takes the same lanes off the other subs', () => {
    const plan = assignSubLanesPlan(ladder, 'backend', [' a ', 'c', 'a'])
    expect(plan.problem).toBe('')
    expect(plan.sub).toEqual({ ...ladder.subs[1], lanes: ['a', 'c'] })
    expect(plan.ladder.subs[0]).toMatchObject({ id: 'frontend', lanes: ['b'] })
    expect(plan.ladder.subs[1]).toMatchObject({ id: 'backend', lanes: ['a', 'c'] })
  })

  it('needs a lane and a sub that is there', () => {
    expect(assignSubLanesPlan(ladder, 'backend', []).problem).toBe('Select at least one code agent.')
    const missing = assignSubLanesPlan(ladder, 'missing', ['a'])
    expect(missing.problem).toBe('Choose a sub orchestrator.')
    expect(missing.sub).toBeNull()
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
