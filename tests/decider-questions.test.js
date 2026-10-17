import { describe, expect, it } from 'vitest'
import { ACTION_TYPES, SECTIONS, TABS } from '../src/assistant/actions.js'
import { interpret } from '../src/assistant/intent.js'
import { rulesPredict } from '../src/decider/baseline.js'
import {
  ACTION_GUIDE,
  ASSISTANT_QUESTIONS,
  EFFORT_LEVELS,
  NONE,
  ROUTING_QUESTIONS,
  SECTION_GUIDE,
  SHAPE_GUIDE,
  TAB_GUIDE,
  TIER_GUIDE,
  assistantRequest,
  requestFor,
  routingRequest,
} from '../src/decider/questions.js'
import { USES_AGENT, assistantProbes } from './probes/assistant.js'
import { context } from './probes/context.js'
import { routingProbes } from './probes/routing.js'

describe('assistant questions', () => {
  it('offer every action, tab and settings page, plus an unknown or none option', () => {
    expect(Object.keys(ACTION_GUIDE).sort()).toEqual([...ACTION_TYPES, 'unknown'].sort())
    expect(Object.keys(TAB_GUIDE).sort()).toEqual([...TABS, NONE].sort())
    expect(Object.keys(SECTION_GUIDE).sort()).toEqual([...SECTIONS, NONE].sort())
  })

  it('build the five questions with the agents and a short list of paths', () => {
    const request = assistantRequest('take me to wherever the layout code lives', context)
    expect(Object.keys(request.questions)).toEqual(ASSISTANT_QUESTIONS)
    expect(Object.keys(request.questions.agent.criteria)).toEqual([NONE, ...context.agents.map((agent) => agent.key)])
    const paths = Object.keys(request.questions.path.criteria)
    expect(paths[0]).toBe(NONE)
    expect(paths).toContain('src/engine/layout.js')
    expect(paths.length).toBeLessThanOrEqual(22)
    expect(request.state).toContain('take me to wherever the layout code lives')
  })

  it('never offers the root as a path and always offers none', () => {
    const request = assistantRequest('anything', context)
    expect(Object.keys(request.questions.path.criteria)).not.toContain('')
    expect(Object.keys(request.questions.path.criteria)).toContain(NONE)
  })

  it('never put file contents or keys in the state', () => {
    const request = assistantRequest('open package.json', context)
    expect(request.state.length).toBeLessThan(200)
  })
})

describe('routing questions', () => {
  it('ask the seven questions with the required criteria', () => {
    const { questions, state } = routingRequest('Fix the typo.')
    expect(Object.keys(questions)).toEqual(ROUTING_QUESTIONS)
    expect(Object.keys(questions.tier.criteria)).toEqual(Object.keys(TIER_GUIDE))
    expect(Object.keys(questions.shape.criteria)).toEqual(Object.keys(SHAPE_GUIDE))
    expect(questions.effort.criteria).toEqual(EFFORT_LEVELS)
    for (const name of ['coordination', 'uncertainty', 'consequence', 'splits']) {
      expect(questions[name].type).toBe('noul')
      expect(Object.keys(questions[name].criteria).sort()).toEqual(['false', 'true'])
    }
    expect(state).toContain('Fix the typo.')
  })

  it('add a harness choice only when agents are given', () => {
    expect(routingRequest('x').questions.harness).toBeUndefined()
    const withAgents = routingRequest('x', [{ key: 'hermes', name: 'Hermes', profile: 'Cheap, good at docs.' }])
    expect(withAgents.questions.harness.criteria).toEqual({ hermes: 'Cheap, good at docs.' })
  })

  it('pick the request builder by probe set', () => {
    expect(Object.keys(requestFor({ set: 'assistant', text: 'costs' }, context).questions)).toEqual(ASSISTANT_QUESTIONS)
    expect(Object.keys(requestFor({ set: 'routing', text: 'Fix it.' }, context).questions)).toEqual(ROUTING_QUESTIONS)
  })
})

describe('probe sets', () => {
  const assistant = assistantProbes()
  const routing = routingProbes()

  it('have unique ids and texts', () => {
    const all = [...assistant, ...routing]
    expect(new Set(all.map((probe) => probe.id)).size).toBe(all.length)
    expect(new Set(assistant.map((probe) => probe.text)).size).toBe(assistant.length)
    expect(new Set(routing.map((probe) => probe.text)).size).toBe(routing.length)
  })

  it('hold about ninety assistant probes and forty routing tasks', () => {
    expect(assistant.length).toBeGreaterThanOrEqual(90)
    expect(routing).toHaveLength(40)
    expect(assistant.filter((probe) => probe.group === 'indirect').length).toBeGreaterThanOrEqual(40)
  })

  it('use only valid labels in the assistant set', () => {
    const keys = context.agents.map((agent) => agent.key)
    for (const probe of assistant) {
      const { action, agent, path, tab, section } = probe.expected
      expect(Object.keys(ACTION_GUIDE), probe.text).toContain(action)
      if (USES_AGENT.has(action)) expect(keys, probe.text).toContain(agent)
      else expect(agent, probe.text).toBeUndefined()
      if (action === 'focus_path') expect(context.paths, probe.text).toContain(path)
      else expect(path, probe.text).toBeUndefined()
      if (action === 'open_panel') expect(Object.keys(TAB_GUIDE), probe.text).toContain(tab)
      else expect(tab, probe.text).toBeUndefined()
      if (action === 'open_config') expect(Object.keys(SECTION_GUIDE), probe.text).toContain(section)
      else expect(section, probe.text).toBeUndefined()
    }
  })

  it('use only valid labels in the routing set', () => {
    for (const probe of routing) {
      const { tier, coordination, uncertainty, consequence, splits, effort, shape } = probe.expected
      expect(Object.keys(TIER_GUIDE), probe.text).toContain(tier)
      expect(Object.keys(SHAPE_GUIDE), probe.text).toContain(shape)
      for (const flag of [coordination, uncertainty, consequence, splits]) expect(typeof flag, probe.text).toBe('boolean')
      expect([0, 1, 2, 3], probe.text).toContain(effort)
    }
  })

  it('give every task a consequence or a size that fits its tier', () => {
    for (const probe of routing) {
      const { tier, consequence, coordination, uncertainty } = probe.expected
      if (consequence) expect(tier, probe.text).toBe('large')
      if (coordination && uncertainty) expect(tier, probe.text).toBe('large')
    }
  })

  it('cover every shape, tier and a spread of effort', () => {
    expect(new Set(routing.map((probe) => probe.expected.shape))).toEqual(new Set(Object.keys(SHAPE_GUIDE)))
    expect(new Set(routing.map((probe) => probe.expected.tier))).toEqual(new Set(Object.keys(TIER_GUIDE)))
    expect(new Set(routing.map((probe) => probe.expected.effort)).size).toBe(4)
  })

  it('are solved by the plain rules in the plain group', () => {
    for (const probe of assistant.filter((item) => item.group === 'plain')) {
      const predicted = rulesPredict(probe.text, context)
      for (const [question, expected] of Object.entries(probe.expected)) expect(predicted[question], `${probe.text} ${question}`).toBe(expected)
    }
  })

  it('leave the plain rules some work to miss in the indirect group', () => {
    const missed = assistant.filter((probe) => probe.group === 'indirect').filter((probe) => {
      const predicted = rulesPredict(probe.text, context)
      return Object.entries(probe.expected).some(([question, expected]) => predicted[question] !== expected)
    })
    expect(missed.length).toBeGreaterThan(10)
  })

  it('hold no text that looks like a key', () => {
    for (const probe of [...assistant, ...routing]) expect(interpret(probe.text, context).kind, probe.text).not.toBe('blocked')
  })
})
