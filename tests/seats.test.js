import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GRANT_USAGE,
  REVOKE_USAGE,
  formatAgentsReply,
  formatGrantNotice,
  formatRevokeNotice,
  formatSeatsReply,
  parseSeatCommand,
  readSeats,
  seatCheck,
  seatSummary,
  seatsFileFor,
  setGrant,
  writeSeats,
} from '../server/seats.js'

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
    const restricted = tree.map((n) => (n.id === 'subA' ? { ...n, restricted: true, scope: ['src/ui/**', 'tests/*/unit-*.js'] } : n))
    const roomy = { rings: [3, 4, 2], grants: { subA: { lanes: 5, subs: 1 } } }
    const run = (scope) => seatCheck({ seats: roomy, tree: restricted, actor: as('subA'), action: 'addSub', harness: 'claude', depth: 3, scope })
    expect(run(['src/ui/panels', 'tests/ui/unit-*.js']).ok).toBe(true)
    expect(run(['src/ui/panels', 'tests/**/unit-*.js']).ok).toBe(false)
    expect(run(['src']).ok).toBe(false)
    expect(run(['tests/ui/unit-one.js']).ok).toBe(false)
    expect(run(['tests/ui/unit-one.j*']).ok).toBe(false)
    expect(run([]).ok).toBe(false)
    expect(run(undefined).ok).toBe(false)
  })

  it('lets a restricted sub create a lane without a scope', () => {
    const restricted = tree.map((n) => (n.id === 'subA' ? { ...n, restricted: true, scope: ['src/ui/**'] } : n))
    const roomy = { rings: [3, 5], grants: { subA: { lanes: 2, subs: 0 } } }
    expect(check({ seats: roomy, tree: restricted, actor: as('subA'), action: 'createLane' })).toEqual({ ok: true, on: true })
  })

  it('leaves the session top out of ring zero', () => {
    const topped = [node('session-top', 'session', null), { ...tree[0], parent: 'session-top' }, ...tree.slice(1)]
    const roomy = { ...seats, rings: [2, 4] }
    expect(check({ seats: roomy, tree: topped, actor: as('orchestrator'), action: 'turnOn', target: 'l2' })).toEqual({ ok: true })
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

describe('seat slash command helpers', () => {
  it('parses /seats, /grant, /revoke and /agents and flags bad arguments', () => {
    expect(parseSeatCommand('/seats')).toEqual({ kind: 'seats' })
    expect(parseSeatCommand('  /SEATS  ')).toEqual({ kind: 'seats' })
    expect(parseSeatCommand('/agents')).toEqual({ kind: 'agents' })
    expect(parseSeatCommand('/revoke')).toEqual({ kind: 'revoke' })
    expect(parseSeatCommand('/revoke extra')).toEqual({ kind: 'revoke', error: REVOKE_USAGE })
    expect(parseSeatCommand('/grant 3')).toEqual({ kind: 'grant', lanes: 3, subs: 0 })
    expect(parseSeatCommand('/grant 3 1')).toEqual({ kind: 'grant', lanes: 3, subs: 1 })
    expect(parseSeatCommand('  /GRANT   0   0 ')).toEqual({ kind: 'grant', lanes: 0, subs: 0 })
    expect(parseSeatCommand('/grant')).toEqual({ kind: 'grant', error: GRANT_USAGE })
    expect(parseSeatCommand('/grant -1 2')).toEqual({ kind: 'grant', error: GRANT_USAGE })
    expect(parseSeatCommand('/grant 1.5')).toEqual({ kind: 'grant', error: GRANT_USAGE })
    expect(parseSeatCommand('/grant 1 2 3')).toEqual({ kind: 'grant', error: GRANT_USAGE })
    expect(parseSeatCommand('/grant two')).toEqual({ kind: 'grant', error: GRANT_USAGE })
    expect(parseSeatCommand('/grant-more')).toBeNull()
    expect(parseSeatCommand('please /grant 3 1')).toBeNull()
  })

  it('writes grants atomically while keeping rings and other grants', () => {
    const dir = mkdtempSync(join(tmpdir(), 'seats-grant-'))
    try {
      const file = seatsFileFor(dir, dir)
      writeSeats(file, seats)
      setGrant(file, 'subA', { lanes: 3, subs: 0 })
      expect(readSeats(file)).toEqual({
        rings: [3, 4],
        grants: { orchestrator: { lanes: 2, subs: 2 }, subA: { lanes: 3, subs: 0 } },
      })
      setGrant(file, 'subA', { lanes: 0, subs: 0 })
      expect(readSeats(file).grants.subA).toEqual({ lanes: 0, subs: 0 })
      expect(() => setGrant(file, '', { lanes: 1, subs: 0 })).toThrow()
      expect(() => setGrant(file, 'subA', { lanes: -1, subs: 0 })).toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('summarizes rings, clamps subs on the last ring and formats replies and notices', () => {
    const labelled = tree.map((entry) => ({ ...entry, label: entry.id === 'orchestrator' ? 'Orchestrator' : entry.id }))
    const mainInfo = seatSummary({ seats, tree: labelled, id: 'orchestrator', depth: 2 })
    expect(mainInfo).toMatchObject({
      ring: 0,
      nextRing: 1,
      grant: { lanes: 2, subs: 2 },
      used: { lanes: 1, totalLanes: 2, subs: 2 },
      rings: [
        { ring: 0, taken: 1, limit: 3, free: 2 },
        { ring: 1, taken: 4, limit: 4, free: 0 },
      ],
    })
    const subLast = seatSummary({ seats, tree: labelled, id: 'subA', depth: 2 })
    expect(subLast.nextRing).toBeNull()
    expect(subLast.grant).toEqual({ lanes: 1, subs: 0 })

    const seatsText = formatSeatsReply({ seats, tree: labelled, id: 'orchestrator', depth: 2 })
    expect(seatsText).toContain('2 lanes turned on, 2 subs')
    expect(seatsText).toContain('Using: 1 of 2 lanes on (2 total), 2 of 2 subs.')
    expect(seatsText).toContain('Ring 0 (lanes): 2 free (1 of 3 taken).')
    expect(seatsText).toContain('Ring 1 (subs): 0 free (4 of 4 taken).')

    const agyTree = [node('orchestrator', 'orchestrator', null, { label: 'Neon', harness: 'agy', mode: 'auto' })]
    expect(formatSeatsReply({ seats: { rings: [], grants: {} }, tree: agyTree, id: 'orchestrator', depth: 2 })).toContain(
      'AGY needs Bypass mode'
    )

    const agentsText = formatAgentsReply({ tree: labelled, id: 'orchestrator' })
    expect(agentsText).toContain('l1 (lane): on, 1 seat on ring 0, made by owner.')
    expect(agentsText).toContain('l2 (lane): off, 0 seats (ring 0), made by Orchestrator.')
    expect(agentsText).toContain('subA (sub): on, 1 seat on ring 1, made by owner.')
    expect(agentsText).toContain('subA-l (lane): on, 1 seat on ring 1, made by subA.')
    expect(formatAgentsReply({ tree: [labelled[0]], id: 'orchestrator' })).toBe('No agents under Orchestrator.')

    const grantNotice = formatGrantNotice({
      seats: { rings: [3, 4], grants: { orchestrator: { lanes: 3, subs: 1 } } },
      tree: labelled,
      id: 'orchestrator',
      depth: 2,
      lanes: 3,
      subs: 1,
    })
    expect(grantNotice).toContain('up to 3 lanes turned on (ring 0) and 1 sub (ring 1)')
    expect(grantNotice).toContain('POST /api/lanes/create')
    expect(grantNotice).toContain('POST /api/lanes/active')
    expect(grantNotice).toContain('POST /api/orchestrator/ladder')
    expect(grantNotice).toContain('X-MachineRoom-Orchestrator')
    expect(grantNotice).toContain('own harness (claude)')

    const clampedNotice = formatGrantNotice({
      seats: { rings: [3, 4], grants: { subA: { lanes: 2, subs: 0 } } },
      tree: labelled,
      id: 'subA',
      depth: 2,
      lanes: 2,
      subs: 0,
      requestedSubs: 1,
    })
    expect(clampedNotice).toContain('last allowed ring at depth 2')
    expect(clampedNotice).not.toContain('POST /api/orchestrator/ladder')

    const revokeNotice = formatRevokeNotice({ seats, tree: labelled, id: 'orchestrator', depth: 2 })
    expect(revokeNotice).toContain('0 lanes and 0 subs')
    expect(revokeNotice).toContain('Agents already made stay as they are.')
    expect(revokeNotice).toContain('POST /api/family/proposals')
  })
})
