import { describe, expect, it } from 'vitest'
import { ACTION_TYPES, CARD_SAY, CONFIRMED, cardFirst, validateAction } from '../src/assistant/actions.js'
import { containsSecret, interpret, resolveAgents, resolvePaths } from '../src/assistant/intent.js'
import { ACTION_CASES } from './probes/assistant.js'
import { context } from './probes/context.js'

const run = (text) => interpret(text, context)

describe('actions', () => {
  it('accepts a known action and keeps only its fields', () => {
    const result = validateAction({ type: 'focus_agent', agent: 'agy', view: 'close', extra: 'x' }, context)
    expect(result).toEqual({ ok: true, action: { type: 'focus_agent', agent: 'agy', view: 'close' }, confirm: false })
  })

  it('rejects unknown types, unknown agents and unknown paths', () => {
    expect(validateAction({ type: 'delete_everything' }, context).ok).toBe(false)
    expect(validateAction({ type: 'focus_agent', agent: 'nobody', view: 'wide' }, context).ok).toBe(false)
    expect(validateAction({ type: 'focus_path', path: 'etc/passwd' }, context).ok).toBe(false)
    expect(validateAction(null, context).ok).toBe(false)
    expect(validateAction({}, context).ok).toBe(false)
  })

  it('offers no action that needs a confirmation', () => {
    expect([...CONFIRMED]).toEqual([])
    for (const type of ACTION_TYPES) {
      const sample = {
        focus_agent: { agent: 'agy', view: 'wide' },
        focus_terminal: { agent: 'agy' },
        focus_path: { path: 'src' },
        follow: { mode: 'wide' },
        open_panel: { tab: 'meters' },
        open_issue: { identifier: 'JC-1' },
        open_config: { agent: 'agy', section: 'keys' },
        replay: { op: 'pause' },
      }[type] ?? {}
      const result = validateAction({ type, ...sample }, context)
      expect(result.ok, type).toBe(true)
      expect(result.confirm, type).toBe(false)
    }
  })

  it('checks the limits of each field', () => {
    expect(validateAction({ type: 'propose_budget', agent: 'agy', cents: 100 }, context).ok).toBe(false)
    expect(validateAction({ type: 'propose_dispatch', assignee: 'agy', title: 'Task' }, context).ok).toBe(false)
    expect(validateAction({ type: 'propose_subagents', agent: 'agy', allowed: true }, context).ok).toBe(false)
    expect(validateAction({ type: 'open_panel', tab: 'approvals' }, context).ok).toBe(false)
    expect(validateAction({ type: 'open_issue', identifier: 'jc-1' }, context).ok).toBe(false)
    expect(validateAction({ type: 'replay', op: 'speed', value: 3 }, context).ok).toBe(false)
    expect(validateAction({ type: 'open_panel', tab: 'secrets' }, context).ok).toBe(false)
    expect(validateAction({ type: 'open_config', agent: 'agy', section: 'shell' }, context).ok).toBe(false)
  })
})

describe('agent resolution', () => {
  it('matches by name, key or the start of a word', () => {
    expect(resolveAgents('what is agy doing', context.agents).match.key).toBe('agy')
    expect(resolveAgents('check hermes', context.agents).match.key).toBe('hermes')
    expect(resolveAgents('opencode', context.agents).match.key).toBe('opencode-go')
    expect(resolveAgents('open code go', context.agents).match.key).toBe('opencode-go')
    expect(resolveAgents('orch', context.agents).match.key).toBe('orchestrator')
    expect(resolveAgents('claude', context.agents).match.key).toBe('claude-code')
  })

  it('does not match a stopword or an unrelated word', () => {
    expect(resolveAgents('show me the code', context.agents).match).toBeNull()
    expect(resolveAgents('weather', context.agents).match).toBeNull()
  })

  it('reports two close matches as ambiguous', () => {
    const twins = { agents: [{ key: 'claude-a', name: 'Claude A' }, { key: 'claude-b', name: 'Claude B' }] }
    const result = resolveAgents('claude', twins.agents)
    expect(result.match).toBeNull()
    expect(result.ambiguous).toHaveLength(2)
  })
})

describe('path resolution', () => {
  it('prefers an exact path, then a file name, then a folder name', () => {
    expect(resolvePaths('src/engine', context.paths).match).toBe('src/engine')
    expect(resolvePaths('room.js', context.paths).match).toBe('src/engine/room.js')
    expect(resolvePaths('engine', context.paths).match).toBe('src/engine')
    expect(resolvePaths('readme', context.paths).match).toBe('README.md')
    expect(resolvePaths('tasks', context.paths).match).toBe('docs/agents/TASKS.md')
  })

  it('lists the choices when a name is shared', () => {
    const result = resolvePaths('Hud', context.paths)
    expect(result.match).toBeNull()
    expect(result.ambiguous).toEqual(expect.arrayContaining(['src/ui/Hud.jsx', 'src/ui/Hud.css']))
  })

  it('finds nothing for an unknown name', () => {
    expect(resolvePaths('zebra', context.paths).match).toBeNull()
  })
})

describe('rule based intent', () => {
  for (const [text, expected] of ACTION_CASES) {
    it(`"${text}"`, () => {
      const result = run(text)
      expect(result.kind).toBe('action')
      expect(result.action).toEqual(expected)
      expect(result.say.length).toBeGreaterThan(0)
    })
  }

  it('treats a delegation as an unknown request', () => {
    expect(run('ask opencode to fix the typo in README').kind).toBe('unknown')
    expect(run('tell hermes to summarise the docs.').kind).toBe('unknown')
    expect(run('have agy to review the layout').kind).toBe('unknown')
  })

  it('treats budget changes as unknown requests', () => {
    expect(run('set the budget of hermes to $5').kind).toBe('unknown')
    expect(run('set agy budget to 2.50 dollars').kind).toBe('unknown')
    expect(run('change claude code budget to 300 cents').kind).toBe('unknown')
    expect(run('set the budget to $5').kind).toBe('unknown')
  })

  it('treats subagent toggles as unknown requests', () => {
    expect(run('allow hermes to spawn subagents').kind).toBe('unknown')
    expect(run('disable subagents for claude code').kind).toBe('unknown')
    expect(run('no subagents for agy').kind).toBe('unknown')
  })

  it('treats approvals requests as unknown requests', () => {
    expect(run('approvals').kind).toBe('unknown')
    expect(run('anything waiting for me').kind).toBe('unknown')
  })

  it('asks which agent when the request needs one', () => {
    for (const text of ['api keys', 'subagents', 'configure', 'terminal']) {
      const result = run(text)
      expect(result.kind, text).toBe('ask')
      expect(result.options.length, text).toBe(context.agents.length)
    }
  })

  it('asks which one when a path name is shared', () => {
    const result = run('open Hud')
    expect(result.kind).toBe('ask')
    expect(result.options.map((option) => option.path)).toEqual(expect.arrayContaining(['src/ui/Hud.jsx', 'src/ui/Hud.css']))
  })

  it('does not claim a folder it cannot find', () => {
    const result = run('go to zebra')
    expect(result.kind).toBe('unknown')
    expect(result.fallback).toBe(true)
  })

  it('asks for something when the text is empty', () => {
    expect(run('   ').kind).toBe('unknown')
    expect(run('').kind).toBe('unknown')
  })

  it('never returns an action the validator would refuse', () => {
    const texts = ACTION_CASES.map(([text]) => text).concat(['ask agy to x', 'budget agy', 'go to src', 'whatever'])
    for (const text of texts) {
      const result = run(text)
      if (result.action) expect(validateAction(result.action, context).ok, text).toBe(true)
    }
  })
})

describe('secrets', () => {
  const keys = [
    'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789',
    'my key is sk-proj-abcdefghijklmnop',
    'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'AIzaSyA1234567890abcdefghijklmnopqrstuv',
    'api key = 12345abcdef',
    'token: hunter2hunter2',
    'password is correcthorse',
    '-----BEGIN PRIVATE KEY-----',
    'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6',
  ]

  for (const text of keys) {
    it(`blocks "${text.slice(0, 24)}"`, () => {
      expect(containsSecret(text)).toBe(true)
      const result = run(`${text} for hermes`)
      expect(result.kind).toBe('blocked')
      expect(JSON.stringify(result)).not.toContain(text.slice(-12))
    })
  }

  it('opens the masked form for a named agent and never echoes the key', () => {
    const result = run('hermes key is sk-proj-abcdefghijklmnop')
    expect(result.kind).toBe('blocked')
    expect(result.action).toEqual({ type: 'open_config', agent: 'hermes', section: 'keys' })
    expect(result.say).not.toMatch(/sk-proj/)
  })

  it('does not block ordinary requests or long paths', () => {
    expect(containsSecret('go to src/engine/room.js')).toBe(false)
    expect(containsSecret('api keys for hermes')).toBe(false)
    expect(containsSecret('what is agy doing')).toBe(false)
    expect(containsSecret('docs/agents/ARCHITECTURE.md and the other long path names here')).toBe(false)
  })
})

describe('cardFirst', () => {
  it('turns a write that came as an action into a confirm card', () => {
    CONFIRMED.add('test_write')
    try {
      const write = { type: 'test_write' }
      expect(cardFirst({ kind: 'action', action: write, say: 'Done.' })).toEqual({ kind: 'propose', action: write, say: CARD_SAY })
      expect(CARD_SAY).toBe('That changes a task, a budget or an agent. Confirm to go on.')
      expect(cardFirst({ kind: 'blocked', action: write, say: 'No.' })).toEqual({ kind: 'blocked', say: 'No.' })
      expect(cardFirst({ kind: 'ask', action: write, say: 'Which?', options: [] })).toEqual({ kind: 'ask', say: 'Which?', options: [] })
    } finally {
      CONFIRMED.delete('test_write')
    }
  })

  it('leaves reads, cards and odd answers alone', () => {
    const read = { kind: 'action', action: { type: 'overview' }, say: 'Back.' }
    const card = { kind: 'propose', action: { type: 'test' }, say: 'Set it?' }
    expect(cardFirst(read)).toBe(read)
    expect(cardFirst(card)).toBe(card)
    expect(cardFirst(null)).toBe(null)
    expect(cardFirst({ kind: 'unknown', say: 'Hm.' })).toEqual({ kind: 'unknown', say: 'Hm.' })
  })
})
