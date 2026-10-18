import { describe, expect, it } from 'vitest'
import { ACTION_TYPES, CONFIRMED, validateAction } from '../src/assistant/actions.js'
import { containsSecret, finalizeModelAction, interpret, redact, resolveAgents, resolvePaths } from '../src/assistant/intent.js'
import { askModel, buildPrompt, parseReply } from '../src/assistant/llm.js'
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

  it('marks every write as needing a confirmation', () => {
    expect([...CONFIRMED].sort()).toEqual(['propose_budget', 'propose_dispatch', 'propose_subagents'])
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
        propose_dispatch: { assignee: 'agy', title: 'Do it' },
        propose_budget: { agent: 'agy', cents: 100 },
        propose_subagents: { agent: 'agy', allowed: true },
      }[type] ?? {}
      const result = validateAction({ type, ...sample }, context)
      expect(result.ok, type).toBe(true)
      expect(result.confirm, type).toBe(CONFIRMED.has(type))
    }
  })

  it('checks the limits of each field', () => {
    expect(validateAction({ type: 'propose_budget', agent: 'agy', cents: -1 }, context).ok).toBe(false)
    expect(validateAction({ type: 'propose_budget', agent: 'agy', cents: 1.5 }, context).ok).toBe(false)
    expect(validateAction({ type: 'propose_budget', agent: 'agy', cents: 1000001 }, context).ok).toBe(false)
    expect(validateAction({ type: 'propose_dispatch', assignee: 'agy', title: ' ' }, context).ok).toBe(false)
    expect(validateAction({ type: 'propose_dispatch', assignee: 'agy', title: 'x'.repeat(201) }, context).ok).toBe(false)
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

  it('turns a delegation into a proposal that needs a confirmation', () => {
    const result = run('ask opencode to fix the typo in README')
    expect(result.kind).toBe('propose')
    expect(result.action).toEqual({ type: 'propose_dispatch', assignee: 'opencode-go', title: 'Fix the typo in README' })
    expect(validateAction(result.action, context).confirm).toBe(true)
  })

  it('reads other delegation wordings', () => {
    expect(run('tell hermes to summarise the docs.').action).toEqual({ type: 'propose_dispatch', assignee: 'hermes', title: 'Summarise the docs' })
    expect(run('have agy to review the layout').action.assignee).toBe('agy')
  })

  it('proposes a budget in dollars or cents', () => {
    expect(run('set the budget of hermes to $5').action).toEqual({ type: 'propose_budget', agent: 'hermes', cents: 500 })
    expect(run('set agy budget to 2.50 dollars').action).toEqual({ type: 'propose_budget', agent: 'agy', cents: 250 })
    expect(run('change claude code budget to 300 cents').action).toEqual({ type: 'propose_budget', agent: 'claude-code', cents: 300 })
    expect(run('set the budget of hermes to $5').kind).toBe('propose')
  })

  it('asks which agent when a budget has none', () => {
    const result = run('set the budget to $5')
    expect(result.kind).toBe('ask')
    expect(result.options.map((option) => option.agent)).toContain('hermes')
  })

  it('proposes allowing and forbidding subagents', () => {
    expect(run('allow hermes to spawn subagents').action).toEqual({ type: 'propose_subagents', agent: 'hermes', allowed: true })
    expect(run('disable subagents for claude code').action).toEqual({ type: 'propose_subagents', agent: 'claude-code', allowed: false })
    expect(run('no subagents for agy').kind).toBe('propose')
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

  it('redacts a key before any text leaves the machine', () => {
    expect(redact('use sk-proj-abcdefghijklmnop please')).toBe('use [hidden] please')
    expect(redact('go to src/engine')).toBe('go to src/engine')
  })
})

describe('model fallback', () => {
  it('builds a prompt with names only and no paths', () => {
    const prompt = buildPrompt('show me the thing', context)
    expect(prompt).toContain('hermes (Hermes)')
    expect(prompt).toContain('Request: show me the thing')
    expect(prompt).not.toContain('src/engine/room.js')
  })

  it('does not build a prompt for text that holds a key', () => {
    expect(buildPrompt('here is sk-proj-abcdefghijklmnop', context)).toBeNull()
  })

  it('parses a clean reply', () => {
    const result = parseReply('{"type":"focus_agent","agent":"agy","view":"close","say":"Going to agy."}', context)
    expect(result).toEqual({ kind: 'action', action: { type: 'focus_agent', agent: 'agy', view: 'close' }, say: 'Going to agy.' })
  })

  it('parses a reply wrapped in a code fence and text', () => {
    const reply = 'Sure!\n```json\n{"type":"open_panel","tab":"meters","say":"Costs."}\n```'
    expect(parseReply(reply, context).action).toEqual({ type: 'open_panel', tab: 'meters' })
  })

  it('resolves a path query on this side', () => {
    const result = parseReply('{"type":"focus_path","query":"engine","say":"There."}', context)
    expect(result.action).toEqual({ type: 'focus_path', path: 'src/engine' })
    expect(parseReply('{"type":"focus_path","query":"zebra"}', context).kind).toBe('unknown')
  })

  it('marks a write as a proposal', () => {
    const result = parseReply('{"type":"propose_budget","agent":"hermes","cents":200}', context)
    expect(result.kind).toBe('propose')
  })

  it('refuses an invented agent, an invented type and a bad number', () => {
    expect(parseReply('{"type":"focus_agent","agent":"gpt","view":"wide"}', context).kind).toBe('unknown')
    expect(parseReply('{"type":"run_shell","cmd":"del *"}', context).kind).toBe('unknown')
    expect(parseReply('{"type":"propose_budget","agent":"hermes","cents":"free"}', context).kind).toBe('unknown')
  })

  it('refuses text that is not json', () => {
    expect(parseReply('I think you want agy.', context).kind).toBe('unknown')
    expect(parseReply('{"type": ', context).kind).toBe('unknown')
    expect(parseReply('', context).kind).toBe('unknown')
    expect(parseReply(undefined, context).kind).toBe('unknown')
  })

  it('turns "none" into a question', () => {
    const result = parseReply('{"type":"none","say":"Do you mean costs or approvals?"}', context)
    expect(result.kind).toBe('ask')
    expect(result.say).toBe('Do you mean costs or approvals?')
  })

  it('cuts a long say to a short one', () => {
    const result = parseReply(`{"type":"overview","say":"${'word '.repeat(100)}"}`, context)
    expect(result.say.length).toBeLessThanOrEqual(160)
  })

  it('runs the model through an injected function', async () => {
    const seen = []
    const result = await askModel('uh show agy work', context, async (prompt) => {
      seen.push(prompt)
      return '{"type":"focus_agent","agent":"agy","view":"close","say":"Going."}'
    })
    expect(seen).toHaveLength(1)
    expect(result.action.agent).toBe('agy')
  })

  it('never calls the model for a key', async () => {
    let called = false
    const result = await askModel('sk-proj-abcdefghijklmnop', context, async () => {
      called = true
      return '{}'
    })
    expect(called).toBe(false)
    expect(result.kind).toBe('blocked')
  })

  it('falls back to a plain message when the model fails', async () => {
    const result = await askModel('hello', context, async () => {
      throw new Error('offline')
    })
    expect(result.kind).toBe('unknown')
    expect(result.say).toMatch(/plain commands/i)
  })

  it('finalizes a model action with the same checks', () => {
    expect(finalizeModelAction({ type: 'focus_path', query: 'layout.js' }, context).ok).toBe(true)
    expect(finalizeModelAction({ type: 'focus_path', path: '../secret' }, context).ok).toBe(false)
  })
})
