import { beforeAll, describe, expect, it } from 'vitest'
import { replayDigest, replaySources } from '../scripts/scale-probe.mjs'
import { apply, createState } from '../src/model/state.js'
import { loadScenario } from './helpers.js'

const OTHER_FIXTURES = {
  'fixtures/sandbox': {
    activities: '485d94210c7f1c8e',
    plans: '6dab246be0dc06a2',
    layouts: '476da06f391527c9',
  },
  'fixtures/scenario-a': {
    activities: '1894ba2b0fa96ff4',
    plans: '70d7b3ec3fb1f703',
    layouts: '76dae9d1d1cd39c6',
  },
  'fixtures/scenario-b': {
    activities: '0a10dbb64e548bb9',
    plans: '8ffbd6484e9cfd8d',
    layouts: '794d090d4d94cfa7',
  },
  'fixtures/scenario-c': {
    activities: 'e6dc4d8a1b46b1d2',
    plans: '209e2edc80cfd82f',
    layouts: '3f9efee7c83e0e54',
  },
  'fixtures/scenario-d': {
    activities: '2fab820498862bc2',
    plans: '895e32dddf24ede1',
    layouts: '9f855076a1ac9be1',
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
    expect(spawns.map((activity) => state.agents.get(activity.child).parent)).toEqual(['opencode', 'opencode', 'hermes'])
    expect(ends.map((activity) => activity.agent)).toEqual(['opencode~1', 'opencode~2', 'hermes~1'])
  })

  it('ends every child and one run fails', () => {
    for (const child of ['opencode~1', 'opencode~2', 'hermes~1']) {
      expect(state.agents.get(child).status).toBe('done')
    }
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
})
