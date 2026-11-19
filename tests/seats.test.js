import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readSeats, seatCheck, seatsFileFor, writeSeats } from '../server/seats.js'

const node = (id, kind, parent, extra = {}) => ({ id, kind, parent, active: true, harness: 'claude', ...extra })
const tree = [
  node('orchestrator', 'orchestrator', null),
  node('l1', 'lane', 'orchestrator'),
  node('l2', 'lane', 'orchestrator', { active: false, createdBy: 'orchestrator' }),
  node('subA', 'sub', 'orchestrator'),
  node('subA-l', 'lane', 'subA', { createdBy: 'subA' }),
  node('other', 'sub', 'orchestrator', { harness: 'codex' }),
  node('other-l', 'lane', 'other'),
]
const seats = { rings: [3, 4], grants: { orchestrator: { lanes: 2, subs: 2 }, subA: { lanes: 1, subs: 1 } } }
const owner = { owner: true }
const as = (id) => ({ id })

describe('seats file', () => {
  it('answers defaults for a missing or broken file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'seats-'))
    try {
      const file = seatsFileFor(dir, dir)
      expect(readSeats(file)).toEqual({ rings: [], grants: {} })
      writeFileSync(file, '{nope')
      expect(readSeats(file)).toEqual({ rings: [], grants: {} })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes atomically, reads back and rejects bad shapes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'seats-'))
    try {
      const file = seatsFileFor(dir, dir)
      writeSeats(file, seats)
      expect(readSeats(file)).toEqual(seats)
      expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([])
      const bad = [null, [], { rings: 'x', grants: {} }, { rings: [-1], grants: {} }, { rings: [], grants: { a: { lanes: 1.5, subs: 0 } } }, { rings: [], grants: { a: { lanes: 1 } } }]
      for (const value of bad) expect(() => writeSeats(file, value)).toThrow()
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(seats)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('seatCheck', () => {
  const check = (extra) => seatCheck({ seats, tree, ...extra })

  it('lets the owner do anything and flags a full ring', () => {
    expect(check({ actor: owner, action: 'turnOff', target: 'l1' })).toEqual({ ok: true })
    expect(check({ actor: owner, action: 'turnOn', target: 'l2' })).toEqual({ ok: true })
    const full = { ...seats, rings: [1, 4] }
    expect(seatCheck({ seats: full, tree, actor: owner, action: 'turnOn', target: 'l2' })).toEqual({ ok: true, overRing: 0 })
    expect(seatCheck({ seats: { rings: [], grants: {} }, tree, actor: owner, action: 'addSub' })).toEqual({ ok: true })
  })

  it('refuses a stranger and unknown actions', () => {
    expect(check({ actor: as('l1'), action: 'turnOff', target: 'l1' }).status).toBe(403)
    expect(check({ actor: owner, action: 'fly' }).status).toBe(400)
  })

  it('caps turned-on lanes by the grant', () => {
    expect(check({ actor: as('orchestrator'), action: 'turnOn', target: 'l2' })).toEqual({ ok: true })
    const capped = { ...seats, grants: { orchestrator: { lanes: 1, subs: 0 } } }
    const result = seatCheck({ seats: capped, tree, actor: as('orchestrator'), action: 'turnOn', target: 'l2' })
    expect(result).toEqual({ ok: false, status: 409, reason: 'Your grant allows 1 lane turned on; 1 are on.' })
  })

  it('counts turned-on agents on the ring and refuses a full one', () => {
    const full = { ...seats, rings: [1, 4] }
    const result = seatCheck({ seats: full, tree, actor: as('orchestrator'), action: 'turnOn', target: 'l2' })
    expect(result.reason).toBe('Ring 0 is full: 1 of 1 seats are taken.')
    const unset = seatCheck({ seats: { ...seats, rings: [] }, tree, actor: as('orchestrator'), action: 'turnOn', target: 'l2' })
    expect(unset.ok).toBe(false)
  })

  it('creates a lane on only with a grant and a free seat', () => {
    expect(check({ actor: as('orchestrator'), action: 'createLane', harness: 'claude' })).toEqual({ ok: true, on: true })
    expect(check({ actor: as('other'), action: 'createLane', harness: 'codex' }).status).toBe(403)
    const full = check({ actor: as('subA'), action: 'createLane', harness: 'claude' })
    expect(full.ok).toBe(true)
    expect(full.on).toBe(false)
    expect(full.reason).toMatch(/grant allows 1 lane/)
    expect(check({ actor: owner, action: 'createLane' })).toEqual({ ok: true, on: true })
  })

  it('keeps the same harness', () => {
    expect(check({ actor: as('orchestrator'), action: 'createLane', harness: 'codex' }).status).toBe(409)
  })

  it('puts a sub one ring down and stops at the depth', () => {
    const two = { ...seats, grants: { orchestrator: { lanes: 2, subs: 2 } } }
    expect(seatCheck({ seats: two, tree, actor: as('orchestrator'), action: 'addSub' }).reason).toBe('Your grant allows 2 subs; you have 2.')
    const one = { rings: [3, 5], grants: { orchestrator: { lanes: 2, subs: 3 } } }
    expect(seatCheck({ seats: one, tree, actor: as('orchestrator'), action: 'addSub' }).ok).toBe(true)
    expect(check({ actor: as('subA'), action: 'addSub', harness: 'claude' }).reason).toBe('Ring 2 is past the subagent depth of 2.')
    const roomy = { rings: [3, 4, 2], grants: { subA: { lanes: 1, subs: 1 } } }
    expect(seatCheck({ seats: roomy, tree, actor: as('subA'), action: 'addSub', harness: 'claude', depth: 3 })).toEqual({ ok: true })
    const fullRing = { rings: [3, 2], grants: { orchestrator: { lanes: 2, subs: 5 } } }
    expect(seatCheck({ seats: fullRing, tree, actor: as('orchestrator'), action: 'addSub' }).reason).toBe('Ring 1 is full: 4 of 2 seats are taken.')
  })

  it('passes a restricted scope down', () => {
    const restricted = tree.map((n) => (n.id === 'subA' ? { ...n, restricted: true, scope: 'src/ui' } : n))
    const roomy = { rings: [3, 4, 2], grants: { subA: { lanes: 5, subs: 1 } } }
    const run = (scope) => seatCheck({ seats: roomy, tree: restricted, actor: as('subA'), action: 'addSub', harness: 'claude', depth: 3, scope })
    expect(run('src/ui/panels').ok).toBe(true)
    expect(run('src').ok).toBe(false)
    expect(run(undefined).ok).toBe(false)
  })

  it('limits turn off and delete to the own branch and the maker', () => {
    expect(check({ actor: as('subA'), action: 'turnOff', target: 'subA-l' })).toEqual({ ok: true })
    expect(check({ actor: as('subA'), action: 'turnOff', target: 'l1' }).status).toBe(403)
    expect(check({ actor: as('subA'), action: 'turnOff', target: 'other-l' }).status).toBe(403)
    expect(check({ actor: as('subA'), action: 'deleteAgent', target: 'subA-l' })).toEqual({ ok: true })
    expect(check({ actor: as('orchestrator'), action: 'deleteAgent', target: 'l1' }).status).toBe(403)
    expect(check({ actor: as('orchestrator'), action: 'deleteAgent', target: 'subA-l' }).status).toBe(403)
    expect(check({ actor: as('orchestrator'), action: 'deleteAgent', target: 'l2' })).toEqual({ ok: true })
    expect(check({ actor: owner, action: 'deleteAgent', target: 'subA-l' })).toEqual({ ok: true })
  })
})
