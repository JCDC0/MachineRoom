import { describe, expect, it } from 'vitest'
import { readLadder } from '../src/model/hierarchy.js'
import {
  addSub,
  changeSub,
  freeLanes,
  idFromName,
  ladderFromOrchestrators,
  ladderSubs,
  removeSub,
  scopeLines,
  subFromForm,
} from '../src/ui/ladderForm.js'

const LANES = ['claude', 'hermes', 'opencode', 'opencode2', 'opencode3', 'agy']

const FRONTEND = {
  id: 'frontend',
  name: 'Frontend',
  harness: 'opencode',
  model: 'opencode-go/deepseek-v4.1-flash',
  lanes: ['opencode2', 'opencode3'],
  scope: ['src/ui/**', 'src/styles.css'],
  restricted: true,
  setBy: 'owner',
}

const BRIDGE = {
  id: 'bridge',
  name: 'Bridge',
  harness: 'claude',
  model: 'sonnet',
  lanes: ['opencode'],
  scope: ['server/**'],
  restricted: false,
  setBy: 'owner',
}

function ladderOf(...subs) {
  return { subs: subs.map((sub) => ({ ...sub, lanes: [...sub.lanes], scope: [...sub.scope] })) }
}

describe('idFromName', () => {
  it('makes a lower case id from a name', () => {
    expect(idFromName('Frontend')).toBe('frontend')
    expect(idFromName('  UI and Styles  ')).toBe('ui-and-styles')
    expect(idFromName('Bridge_2')).toBe('bridge-2')
    expect(idFromName('Café')).toBe('caf')
    expect(idFromName('')).toBe('')
    expect(idFromName(null)).toBe('')
    expect(idFromName('***')).toBe('')
  })

  it('keeps the id at 24 characters with no trailing dash', () => {
    const id = idFromName('a very long sub orchestrator name')
    expect(id.length).toBeLessThanOrEqual(24)
    expect(id.endsWith('-')).toBe(false)
    expect(idFromName('a'.repeat(30))).toBe('a'.repeat(24))
  })

  it('never uses the main orchestrator id', () => {
    expect(idFromName('Orchestrator')).toBe('orchestrator-sub')
    expect(idFromName('orchestrator')).toBe('orchestrator-sub')
  })
})

describe('scopeLines', () => {
  it('reads one glob per line and drops blanks and repeats', () => {
    expect(scopeLines('src/ui/**\n\n  src/styles.css  \r\nsrc/ui/**\n')).toEqual(['src/ui/**', 'src/styles.css'])
    expect(scopeLines(['server/**', ' server/** ', ''])).toEqual(['server/**'])
    expect(scopeLines(null)).toEqual([])
  })
})

describe('subFromForm', () => {
  it('turns the form into a sub owned by the owner', () => {
    expect(
      subFromForm({
        name: ' Frontend ',
        id: ' frontend ',
        harness: 'opencode',
        model: ' opencode-go/deepseek-v4.1-flash ',
        lanes: ['opencode2', 'opencode3', 'opencode2'],
        scope: 'src/ui/**\nsrc/styles.css',
        restricted: true,
      })
    ).toEqual(FRONTEND)
  })

  it('fills the id from the name when the id is empty', () => {
    const sub = subFromForm({ name: 'Frontend', scope: 'src/ui/**' })
    expect(sub.id).toBe('frontend')
    expect(sub.name).toBe('Frontend')
    expect(sub.harness).toBe('claude')
    expect(sub.restricted).toBe(true)
    expect(sub.setBy).toBe('owner')
  })

  it('falls back to the id for a missing name and keeps an open scope', () => {
    const sub = subFromForm({ id: 'bridge', harness: 'claude', restricted: false })
    expect(sub.name).toBe('bridge')
    expect(sub.restricted).toBe(false)
    expect(sub.scope).toEqual([])
    expect(sub.lanes).toEqual([])
  })

  it('turns a Restricted switch that is off into false', () => {
    expect(subFromForm({ name: 'X', restricted: false }).restricted).toBe(false)
    expect(subFromForm({ name: 'X', restricted: undefined }).restricted).toBe(true)
  })
})

describe('freeLanes', () => {
  it('leaves out the lanes another sub owns and keeps the rest in order', () => {
    expect(freeLanes(LANES, ladderOf(FRONTEND))).toEqual(['claude', 'hermes', 'opencode', 'agy'])
    expect(freeLanes(['opencode3', 'opencode4', 'opencode3'], ladderOf(FRONTEND))).toEqual(['opencode4'])
  })

  it('can ignore the sub being changed', () => {
    expect(freeLanes(LANES, ladderOf(FRONTEND, BRIDGE), { except: 'frontend' })).toEqual([
      'claude',
      'hermes',
      'opencode2',
      'opencode3',
      'agy',
    ])
    expect(freeLanes(LANES, ladderOf(FRONTEND, BRIDGE), { except: 'nothing' })).toEqual(['claude', 'hermes', 'agy'])
  })

  it('takes bad input', () => {
    expect(freeLanes(null, null)).toEqual([])
    expect(freeLanes(LANES, { subs: 'no' })).toEqual(LANES)
  })
})

describe('the ladder with a sub added, changed or removed', () => {
  it('adds a sub without changing the old ladder', () => {
    const before = ladderOf(FRONTEND)
    const after = addSub(before, BRIDGE)
    expect(after.subs.map((sub) => sub.id)).toEqual(['frontend', 'bridge'])
    expect(before.subs.map((sub) => sub.id)).toEqual(['frontend'])
  })

  it('changes a sub in its place and appends one that is missing', () => {
    const before = ladderOf(FRONTEND, BRIDGE)
    const changed = changeSub(before, { ...FRONTEND, name: 'The UI', scope: ['src/ui/**'] })
    expect(changed.subs.map((sub) => [sub.id, sub.name])).toEqual([
      ['frontend', 'The UI'],
      ['bridge', 'Bridge'],
    ])
    const appended = changeSub(before, { ...BRIDGE, id: 'later' })
    expect(appended.subs.map((sub) => sub.id)).toEqual(['frontend', 'bridge', 'later'])
    expect(before.subs[0].name).toBe('Frontend')
  })

  it('removes a sub by id', () => {
    expect(removeSub(ladderOf(FRONTEND, BRIDGE), 'frontend').subs.map((sub) => sub.id)).toEqual(['bridge'])
    expect(removeSub(ladderOf(FRONTEND), 'missing').subs.map((sub) => sub.id)).toEqual(['frontend'])
    expect(removeSub(null, 'frontend')).toEqual({ subs: [] })
  })

  it('reads a ladder that keeps a main orchestrator out', () => {
    const list = [
      { id: 'orchestrator', name: 'Orchestrator', lanes: ['opencode'], scope: [], restricted: false, setBy: 'owner' },
      { ...FRONTEND, state: 'working' },
      { id: 'ghost', name: '', lanes: 'no', scope: 'no', restricted: false },
    ]
    expect(ladderFromOrchestrators(list)).toEqual({
      subs: [
        {
          id: 'frontend',
          name: 'Frontend',
          harness: 'opencode',
          model: 'opencode-go/deepseek-v4.1-flash',
          lanes: ['opencode2', 'opencode3'],
          scope: ['src/ui/**', 'src/styles.css'],
          restricted: true,
          setBy: 'owner',
        },
        {
          id: 'ghost',
          name: 'ghost',
          harness: '',
          model: '',
          lanes: [],
          scope: [],
          restricted: false,
          setBy: 'owner',
        },
      ],
    })
    expect(ladderFromOrchestrators(null)).toEqual({ subs: [] })
  })
})

describe('a form saved through the ladder', () => {
  it('gives readLadder no problems', () => {
    const sub = subFromForm({
      name: 'Frontend',
      id: 'frontend',
      harness: 'opencode',
      model: 'opencode-go/deepseek-v4.1-flash',
      lanes: ['opencode2', 'opencode3'],
      scope: 'src/ui/**\nsrc/styles.css',
      restricted: true,
    })
    const result = readLadder(addSub({ subs: [] }, sub), { lanes: LANES })
    expect(result.problems).toEqual([])
    expect(result.ladder.subs).toEqual([FRONTEND])
  })

  it('lets readLadder refuse a lane another sub owns', () => {
    const result = readLadder(addSub(ladderOf(FRONTEND), subFromForm({ name: 'Other', scope: 'src/**', lanes: ['opencode2'] })), {
      lanes: LANES,
    })
    expect(result.problems).toContain('The lane "opencode2" already belongs to sub "frontend".')
  })

  it('lists only real sub objects', () => {
    expect(ladderSubs({ subs: [FRONTEND, null, 'no', []] })).toEqual([FRONTEND])
    expect(ladderSubs(null)).toEqual([])
  })
})
