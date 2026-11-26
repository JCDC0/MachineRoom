import { describe, expect, it } from 'vitest'
import { agentModelText, doingText, modelLabel, nameLabel } from '../src/engine/agents.js'
import { apply, createState } from '../src/model/state.js'

describe('agent name label', () => {
  it('answers a short name in capitals', () => {
    expect(nameLabel('Hermes')).toBe('HERMES')
  })

  it('keeps a name of exactly 32 characters', () => {
    const name = 'abcdefghijklmnopqrstuvwxyz012345'
    expect(name).toHaveLength(32)
    expect(nameLabel(name)).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ012345')
  })

  it('cuts a long name to 32 characters with a tilde last', () => {
    const name = 'Claude Code '.repeat(5)
    expect(name).toHaveLength(60)
    const label = nameLabel(name)
    expect(label).toBe('CLAUDE CODE CLAUDE CODE CLAUDE ~')
    expect(label).toHaveLength(32)
  })

  it('answers empty text for a name that is not text', () => {
    expect(nameLabel(null)).toBe('')
  })
})

describe('doingText', () => {
  it('says what an agent is doing, or its state', () => {
    expect(doingText({ status: 'working', label: 'Read src/App.jsx' })).toBe('read src/app.jsx')
    expect(doingText({ status: 'working', label: 'x'.repeat(60) })).toBe(`${'x'.repeat(39)}~`)
    expect(doingText({ status: 'idle' })).toBe('idle')
    expect(doingText({ status: 'done', label: 'done' })).toBe('finished')
    expect(doingText({ status: 'error' })).toBe('failed')
    expect(doingText({})).toBe('')
    expect(doingText(null)).toBe('')
  })

  it('says queued for a queued entry with an old label', () => {
    expect(doingText({ status: 'queued', label: 'done', calls: new Map() })).toBe('queued')
    expect(doingText({ status: 'queued', label: 'Edit src/a.js' })).toBe('queued')
  })

  it('says thinking for a working entry with no open call', () => {
    expect(doingText({ status: 'working', label: 'edit src/a.js', openCalls: new Map(), calls: new Map([['c1', []]]) })).toBe('thinking')
    expect(doingText({ status: 'working', label: 'edit src/a.js', openCalls: new Set(), calls: new Map([['c1', []]]) })).toBe('thinking')
    expect(doingText({ status: 'working', label: 'edit src/a.js', openCalls: 0 })).toBe('thinking')
    expect(doingText({ status: 'working', label: 'edit src/a.js', calls: new Map() })).toBe('thinking')
    expect(doingText({ status: 'working', calls: new Map() })).toBe('thinking')
  })

  it('shows the label for a working entry with an open call', () => {
    const calls = new Map([['c1', []]])
    expect(doingText({ status: 'working', label: 'Edit src/a.js', openCalls: new Map([['c1', { tool: 'edit', label: 'Edit src/a.js', touches: [] }]]), calls })).toBe('edit src/a.js')
    expect(doingText({ status: 'working', label: '', openCalls: new Map([['c1', { tool: 'shell', label: 'npm run dev', touches: [] }]]), calls })).toBe('npm run dev')
    expect(doingText({ status: 'working', label: 'Edit src/a.js', openCalls: new Set(['c1']), calls })).toBe('edit src/a.js')
    expect(doingText({ status: 'working', label: 'Edit src/a.js', calls })).toBe('edit src/a.js')
  })

  it('shows the label for a working entry with no calls at all', () => {
    expect(doingText({ status: 'working', label: 'Edit src/a.js' })).toBe('edit src/a.js')
  })
})

describe('modelLabel', () => {
  it('names the model in capitals with its effort, and never twice', () => {
    expect(modelLabel({ model: 'gpt-6.2-sol', effort: 'high' })).toBe('GPT-6.2-SOL · HIGH')
    expect(modelLabel({ model: 'gpt-6.1-terra', effort: 'high' })).toBe('GPT-6.1-TERRA · HIGH')
    expect(modelLabel({ model: 'gemini-4-hydrogen-xhigh' })).toBe('GEMINI-4-HYDROGEN-XHIGH')
    expect(modelLabel({ model: 'gemini-4-neon-high', effort: 'high' })).toBe('GEMINI-4-NEON-HIGH')
    expect(modelLabel({ model: 'gemini-4-neon-xhigh', effort: 'high' })).toBe('GEMINI-4-NEON-XHIGH · HIGH')
  })

  it('drops the provider path and keeps an effort without a model', () => {
    expect(modelLabel({ model: 'OpenRouter/deepseek/deepseek-v4.1-flash-1017', effort: 'xhigh' })).toBe('DEEPSEEK-V4.1-FLASH-1017 · XHIGH')
    expect(modelLabel({ effort: 'high' })).toBe('HIGH')
  })

  it('answers empty text with no model, and cuts a long one to 40 characters', () => {
    expect(modelLabel(null)).toBe('')
    expect(modelLabel({ model: 42 })).toBe('')
    const label = modelLabel({ model: 'm'.repeat(60) })
    expect(label).toHaveLength(40)
    expect(label.endsWith('~')).toBe(true)
  })
})

describe('agentModelText', () => {
  it('takes the roster model first and the model a session reported otherwise', () => {
    const roster = [{ key: 'claude-session', name: 'Claude Code session' }]
    const state = createState({ files: [], dirs: [], created: [] }, roster)
    const entry = state.agents.get('claude-session')
    expect(agentModelText(roster[0], entry)).toBe('')
    apply(state, { type: 'agent.model', agent: 'claude-session', model: 'claude-opus-5-5', time: 1 })
    expect(agentModelText(roster[0], entry)).toBe('CLAUDE-OPUS-5-5')
    expect(agentModelText({ key: 'codex3', model: 'gpt-6.2-sol', effort: 'high' }, entry)).toBe('GPT-6.2-SOL · HIGH')
  })
})
