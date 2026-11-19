import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { writeAtomic } from '../scripts/recording-files.mjs'
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

function levelOf(tree, node) {
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

function isUnder(tree, node, ancestorId) {
  let current = node
  for (let hops = 0; current && hops < 32; hops += 1) {
    if (current.parent === ancestorId) return true
    current = nodeOf(tree, current.parent)
  }
  return false
}

function inScope(parent, child) {
  const base = String(parent).replace(/[\\/]+$/, '')
  const sub = String(child)
  return sub === base || sub.startsWith(`${base}/`) || sub.startsWith(`${base}\\`)
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

  const onRing = (level) => nodes.filter((node) => node.kind !== 'orchestrator' && node.active && levelOf(nodes, node) === level)
  const lastRing = Math.max(0, depth - 1)

  const room = (level) => {
    const limit = rings[level]
    const taken = onRing(level).length
    if (!count(limit)) return isOwner ? { ok: true } : refuse(409, `Ring ${level} has no seats set.`)
    if (taken < limit) return { ok: true }
    if (isOwner) return { ok: true, overRing: level }
    return refuse(409, `Ring ${level} is full: ${taken} of ${limit} seats are taken.`)
  }

  const node = target === undefined ? null : nodeOf(nodes, target)
  if (action !== 'createLane' && action !== 'addSub') {
    if (!node || node.kind === 'orchestrator') return refuse(404, 'That agent is not in the list.')
    if (isOwner) {
      if (action === 'turnOn' && !node.active) return room(levelOf(nodes, node))
      return { ok: true }
    }
    if (!isUnder(nodes, node, me.id)) return refuse(403, 'You can change only the agents under you.')
    if (action === 'deleteAgent') {
      return node.createdBy === me.id ? { ok: true } : refuse(403, 'Only the owner or the agent that made it can delete it.')
    }
    if (action === 'turnOff' || node.active) return { ok: true }
    if (node.kind === 'lane' && node.parent === me.id) {
      const grant = seats?.grants?.[me.id] ?? { lanes: 0, subs: 0 }
      const on = nodes.filter((n) => n.kind === 'lane' && n.parent === me.id && n.active).length
      if (on >= grant.lanes) return refuse(409, `Your grant allows ${plural(grant.lanes, 'lane')} turned on; ${on} are on.`)
    }
    return room(levelOf(nodes, node))
  }

  const maker = isOwner ? nodeOf(nodes, parent ?? MAIN_ID) : me
  if (!maker || (maker.kind !== 'orchestrator' && maker.kind !== 'sub')) return refuse(404, 'That orchestrator is not in the list.')
  if (!isOwner) {
    if (harness && me.harness && harness !== me.harness) {
      return refuse(409, `You can make agents only on your own harness, ${me.harness}.`)
    }
    if (me.restricted && (!scope || !inScope(me.scope ?? '', scope))) {
      return refuse(409, 'Your scope is restricted: a new agent must stay inside it.')
    }
  }
  const grant = seats?.grants?.[maker.id] ?? { lanes: 0, subs: 0 }
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
