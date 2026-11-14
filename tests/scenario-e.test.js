import { beforeAll, describe, expect, it } from 'vitest'
import { replayDigest, replaySources } from '../scripts/scale-probe.mjs'
import { apply, createState } from '../src/model/state.js'
import { loadScenario } from './helpers.js'

const OTHER_FIXTURES = {
  'fixtures/sandbox': {
    activities: '4e1d0649be6925a9',
    plans: '6dab246be0dc06a2',
    layouts: 'cb9a4332076900b8',
  },
  'fixtures/scenario-a': {
    activities: '00673deaecca9630',
    plans: '70d7b3ec3fb1f703',
    layouts: '74321cc8e8feda76',
  },
  'fixtures/scenario-b': {
    activities: '0a10dbb64e548bb9',
    plans: '8ffbd6484e9cfd8d',
    layouts: '28237138c87c28bf',
  },
  'fixtures/scenario-c': {
    activities: '394bd8e0fe7863bc',
    plans: '209e2edc80cfd82f',
    layouts: 'cf9437e37f63146d',
  },
  'fixtures/scenario-d': {
    activities: 'b5b12e98ea6c1c52',
    plans: '895e32dddf24ede1',
    layouts: '76e5d528b7944672',
  },
}

describe('scenario E: an orchestrator and subagents', () => {
  const { agents, tree, activities } = loadScenario('scenario-e')
  const state = createState(tree, agents)
  for (const activity of activities) apply(state, activity)
  const spawns = activities.filter((activity) => activity.type === 'agent.spawn')
  const ends = activities.filter((activity) => activity.type === 'agent.end')

  it('has four agents, the orchestrator among them', () => {
    expect([...agents].map((agent) => agent.key).sort()).toEqual(['claude', 'hermes', 'opencode', 'orchestrator'])
    const orchestrator = agents.find((agent) => agent.key === 'orchestrator')
    expect(orchestrator.name).toBe('Orchestrator')
    expect(orchestrator.role).toBe('ceo')
    expect(state.agents.get('orchestrator')).toMatchObject({ name: 'Orchestrator', parent: null, depth: 0 })
  })

  it('spawns three children under the OpenCode and Hermes runs', () => {
    expect(spawns.map((activity) => [activity.agent, activity.child])).toEqual([
      ['opencode', 'opencode~1'],
      ['opencode', 'opencode~2'],
      ['hermes', 'hermes~1'],
    ])
    const live = createState(tree, agents)
    const parents = []
    for (const activity of activities) {
      apply(live, activity)
      if (activity.type === 'agent.spawn') parents.push(live.agents.get(activity.child).parent)
    }
    expect(parents).toEqual(['opencode', 'opencode', 'hermes'])
    expect(ends.map((activity) => activity.agent)).toEqual(['opencode~1', 'opencode~2', 'hermes~1'])
  })

  it('ends every child and one run fails', () => {
    const live = createState(tree, agents)
    const ended = []
    for (const activity of activities) {
      apply(live, activity)
      if (activity.type === 'agent.end') ended.push([activity.agent, live.agents.get(activity.agent).status])
    }
    expect(ended).toEqual([
      ['opencode~1', 'done'],
      ['opencode~2', 'done'],
      ['hermes~1', 'done'],
    ])
    const failed = activities.filter((activity) => activity.type === 'run.end' && !activity.ok)
    expect(failed).toHaveLength(1)
    expect(failed[0].agent).toBe('claude')
  })
})

describe('the replay digests', () => {
  let results

  beforeAll(() => {
    results = new Map(replaySources().filter((source) => source.name.startsWith('fixtures/')).map((source) => [source.name, replayDigest(source)]))
  })

  it('keeps the digests of the other fixtures the same', () => {
    for (const [name, digest] of Object.entries(OTHER_FIXTURES)) {
      expect(results.get(name)?.digest).toEqual(digest)
    }
  })

  it('lists fixtures/scenario-e', () => {
    expect([...results.keys()]).toContain('fixtures/scenario-e')
  })

  it('keeps the scenario E layout digest', () => {
    expect(results.get('fixtures/scenario-e')?.digest.layouts).toEqual('46f1ee22a9e7eaf8')
  })
})
