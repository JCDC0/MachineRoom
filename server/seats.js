import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { writeAtomic } from '../scripts/recording-files.mjs'
import { inScope } from '../src/model/hierarchy.js'
import { projectHash } from './active-lanes.js'
import { AGENT_DEPTH_DEFAULT } from './agent-depth.js'

export const SEAT_ACTIONS = ['createLane', 'turnOn', 'turnOff', 'addSub', 'deleteAgent']
const MAIN_ID = 'orchestrator'

export function seatsFileFor(projectRoot, runsFolder) {
  return join(runsFolder, `seats-${projectHash(projectRoot)}.json`)
}

const count = (value) => Number.isInteger(value) && value >= 0

function normalized(value) {
  const parsed = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const rings = Array.isArray(parsed.rings) ? parsed.rings.map((seats) => (count(seats) ? seats : null)) : []
  const grants = {}
  const source = parsed.grants && typeof parsed.grants === 'object' && !Array.isArray(parsed.grants) ? parsed.grants : {}
  for (const [id, grant] of Object.entries(source)) {
    if (grant && count(grant.lanes) && count(grant.subs)) grants[id] = { lanes: grant.lanes, subs: grant.subs }
  }
  return { rings, grants }
}

export function readSeats(file) {
  try {
    return existsSync(file) ? normalized(JSON.parse(readFileSync(file, 'utf8'))) : normalized()
  } catch {
    return normalized()
  }
}

export function seatsProblem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Seats must be an object.'
  if (!Array.isArray(value.rings) || value.rings.some((seats) => seats !== null && !count(seats))) {
    return 'Rings must be a list of whole numbers from 0, or null for no limit.'
  }
  const grants = value.grants
  if (!grants || typeof grants !== 'object' || Array.isArray(grants)) return 'Grants must be an object.'
  for (const [id, grant] of Object.entries(grants)) {
    if (!id || !grant || !count(grant.lanes) || !count(grant.subs)) {
      return 'Each grant needs lanes and subs as whole numbers from 0.'
    }
  }
  return ''
}

export function writeSeats(file, seats, io = {}) {
  const problem = seatsProblem(seats)
  if (problem) throw new Error(problem)
  mkdirSync(dirname(file), { recursive: true })
  const clean = normalized(seats)
  writeAtomic(file, `${JSON.stringify(clean, null, 2)}\n`, io)
  return clean
}

const nodeOf = (tree, id) => (tree ?? []).find((node) => node.id === id)

export function levelOf(tree, node) {
  let level = 0
  let current = node
  for (let hops = 0; current && hops < 32; hops += 1) {
    const parent = nodeOf(tree, current.parent)
    if (!parent) return level
    if (current.kind === 'sub') level += 1
    current = parent
  }
  return level
}

export function isUnder(tree, node, ancestorId) {
  let current = node
  for (let hops = 0; current && hops < 32; hops += 1) {
    if (current.parent === ancestorId) return true
    current = nodeOf(tree, current.parent)
  }
  return false
}

function scopeParts(glob) {
  if (typeof glob !== 'string' || !glob || glob.includes('\0')) return []
  const path = process.platform === 'win32' ? glob.toLowerCase() : glob
  const parts = path.replaceAll('\\', '/').split('/').filter((part) => part && part !== '.')
  if (parts.includes('..')) return []
  return path.includes('*') || parts.length === 0 ? parts : [...parts, '**']
}

function containsGlob(parent, child) {
  const outer = scopeParts(parent)
  const inner = scopeParts(child)
  if (!outer.length || !inner.length) return false
  const memo = new Map()
  function contains(p, c) {
    const key = `${p}:${c}`
    if (memo.has(key)) return memo.get(key)
    let result
    if (p === outer.length) result = c === inner.length
    else if (outer[p] === '**') result = contains(p + 1, c) || (c < inner.length && contains(p, c + 1))
    else {
      const part = inner[c]
      result = part !== undefined && part !== '**' &&
        (outer[p] === part || (outer[p].includes('*') && inScope(part.replaceAll('*', '\0'), [outer[p]]))) &&
        contains(p + 1, c + 1)
    }
    memo.set(key, result)
    return result
  }
  return contains(0, 0)
}

function ringUse(tree, level) {
  return tree.filter((node) => (node.kind === 'lane' || node.kind === 'sub') && node.active && levelOf(tree, node) === level).length
}

const grantFor = (seats, id) => seats?.grants && Object.hasOwn(seats.grants, id) ? seats.grants[id] : { lanes: 0, subs: 0 }

export function seatLine({ seats, tree, id, depth }) {
  const grant = grantFor(seats, id)
  const level = levelOf(tree, nodeOf(tree, id))
  const free = (ring) => {
    const limit = seats.rings[ring]
    return count(limit) ? Math.max(0, limit - ringUse(tree, ring)) : 'no seats set'
  }
  const next = level + 1
  const hasNext = next < depth
  return `Seat grant: ${plural(grant.lanes, 'lane')} and ${plural(hasNext ? grant.subs : 0, 'sub')}. Free seats: ring ${level}, ${free(level)}${hasNext ? `; ring ${next}, ${free(next)}` : ''}.`
}

export function overRingProblem(body, ring) {
  if (ring === undefined || body.overRing === ring || (Array.isArray(body.overRing) && body.overRing.includes(ring))) return null
  return { error: `Confirm going past the seats on ring ${ring}.`, overRing: ring }
}

const refuse = (status, reason) => ({ ok: false, status, reason })
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

export function seatCheck({ seats, tree, actor, action, target, parent, harness, scope, depth = AGENT_DEPTH_DEFAULT }) {
  if (!SEAT_ACTIONS.includes(action)) return refuse(400, `Unknown seat action: ${action}.`)
  const rings = seats?.rings ?? []
  const nodes = tree ?? []
  const isOwner = actor?.owner === true
  const me = isOwner ? null : nodeOf(nodes, actor?.id)
  if (!isOwner && (!me || (me.kind !== 'orchestrator' && me.kind !== 'sub'))) {
    return refuse(403, 'Only the owner or an orchestrator can change seats.')
  }

  const lastRing = Math.max(0, depth - 1)

  const room = (level) => {
    const limit = rings[level]
    const taken = ringUse(nodes, level)
    if (!count(limit)) return isOwner ? { ok: true } : refuse(409, `Ring ${level} has no seats set.`)
    if (taken < limit) return { ok: true }
    if (isOwner) return { ok: true, overRing: level }
    return refuse(409, `Ring ${level} is full: ${taken} of ${limit} seats are taken.`)
  }

  const node = target === undefined ? null : nodeOf(nodes, target)
  if (action !== 'createLane' && action !== 'addSub') {
    if (!node || (node.kind !== 'lane' && node.kind !== 'sub')) return refuse(404, 'That agent is not in the list.')
    if (isOwner) {
      if (action === 'turnOn' && !node.active) return room(levelOf(nodes, node))
      return { ok: true }
    }
    if (!isUnder(nodes, node, me.id)) return refuse(403, 'You can change only the agents under you.')
    if (action === 'deleteAgent') {
      return node.createdBy === me.id ? { ok: true } : refuse(403, 'Only the owner or the agent that made it can delete it.')
    }
    if (action === 'turnOff' || node.active) return { ok: true }
    if (node.kind === 'lane') {
      const grant = grantFor(seats, node.parent)
      if (node.parent !== me.id && !grantFor(seats, me.id).lanes) return refuse(409, 'Your grant allows 0 lanes turned on; 0 are on.')
      const on = nodes.filter((n) => n.kind === 'lane' && n.parent === node.parent && n.active).length
      if (on >= grant.lanes) {
        const subject = node.parent === me.id ? 'Your grant' : `The grant for ${node.parent}`
        return refuse(409, `${subject} allows ${plural(grant.lanes, 'lane')} turned on; ${on} are on.`)
      }
    }
    return room(levelOf(nodes, node))
  }

  const maker = isOwner ? nodeOf(nodes, parent ?? MAIN_ID) : me
  if (!maker || (maker.kind !== 'orchestrator' && maker.kind !== 'sub')) return refuse(404, 'That orchestrator is not in the list.')
  if (!isOwner) {
    if (harness && me.harness && harness !== me.harness) {
      return refuse(409, `You can make agents only on your own harness, ${me.harness}.`)
    }
    if (action === 'addSub' && me.restricted && (!Array.isArray(me.scope) || !Array.isArray(scope) ||
      scope.length === 0 || !scope.every((glob) => me.scope.some((base) => containsGlob(base, glob))))) {
      return refuse(409, 'Your scope is restricted: a new agent must stay inside it.')
    }
  }
  const grant = grantFor(seats, maker.id)
  const ownLevel = levelOf(nodes, maker)

  if (action === 'createLane') {
    if (!isOwner && grant.lanes < 1) return refuse(403, 'You have no grant to make lanes. You may only propose one.')
    const on = nodes.filter((n) => n.kind === 'lane' && n.parent === maker.id && n.active).length
    if (!isOwner && on >= grant.lanes) {
      return { ok: true, on: false, reason: `Your grant allows ${plural(grant.lanes, 'lane')} turned on; ${on} are on.` }
    }
    const seat = room(ownLevel)
    if (!seat.ok) return { ok: true, on: false, reason: seat.reason }
    return { ...seat, on: true }
  }

  const level = ownLevel + 1
  if (level > lastRing) return refuse(409, `Ring ${level} is past the subagent depth of ${depth}.`)
  if (!isOwner) {
    const subs = nodes.filter((n) => n.kind === 'sub' && n.parent === maker.id).length
    if (subs >= grant.subs) return refuse(403, `Your grant allows ${plural(grant.subs, 'sub')}; you have ${subs}.`)
  }
  return room(level)
}
