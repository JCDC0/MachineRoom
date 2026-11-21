import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { writeAtomic } from '../scripts/recording-files.mjs'
import { inScope } from '../src/model/hierarchy.js'
import { projectHash } from './active-lanes.js'
import { AGENT_DEPTH_DEFAULT } from './agent-depth.js'

export const SEAT_ACTIONS = ['createLane', 'turnOn', 'turnOff', 'addSub', 'deleteAgent']
export const SEAT_COMMANDS = ['seats', 'grant', 'revoke', 'agents']
export const GRANT_USAGE = 'Use /grant LANES [SUBS] with whole numbers from 0, for example /grant 3 1.'
export const REVOKE_USAGE = 'Use /revoke with no arguments.'
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

export function parseSeatCommand(text) {
  const value = typeof text === 'string' ? text.trim() : ''
  const match = /^\/([A-Za-z]+)(?:[ \t]+([\s\S]*))?$/.exec(value)
  if (!match) return null
  const name = match[1].toLowerCase()
  if (!SEAT_COMMANDS.includes(name)) return null
  const rest = (match[2] ?? '').trim()
  if (name === 'seats') return { kind: 'seats' }
  if (name === 'agents') return { kind: 'agents' }
  if (name === 'revoke') {
    return rest ? { kind: 'revoke', error: REVOKE_USAGE } : { kind: 'revoke' }
  }
  const parts = rest ? rest.split(/\s+/) : []
  if (parts.length < 1 || parts.length > 2) return { kind: 'grant', error: GRANT_USAGE }
  if (!parts.every((part) => /^\d+$/.test(part))) return { kind: 'grant', error: GRANT_USAGE }
  const lanes = Number(parts[0])
  const subs = parts.length === 2 ? Number(parts[1]) : 0
  if (!Number.isSafeInteger(lanes) || !Number.isSafeInteger(subs)) return { kind: 'grant', error: GRANT_USAGE }
  return { kind: 'grant', lanes, subs }
}

export function setGrant(file, id, { lanes, subs }, io = {}) {
  if (typeof id !== 'string' || !id.trim()) throw new Error('An orchestrator id is required.')
  if (!count(lanes) || !count(subs)) throw new Error('Each grant needs lanes and subs as whole numbers from 0.')
  const current = readSeats(file)
  const grants = { ...current.grants, [id]: { lanes, subs } }
  return writeSeats(file, { rings: current.rings, grants }, io)
}

export function seatSummary({ seats, tree, id, depth = AGENT_DEPTH_DEFAULT }) {
  const nodes = tree ?? []
  const node = nodeOf(nodes, id)
  const ring = node ? levelOf(nodes, node) : 0
  const nextRing = ring + 1 < depth ? ring + 1 : null
  const raw = grantFor(seats, id)
  const grant = { lanes: raw.lanes, subs: nextRing !== null ? raw.subs : 0 }
  const usedLanes = nodes.filter((n) => n.kind === 'lane' && n.parent === id && n.active).length
  const totalLanes = nodes.filter((n) => n.kind === 'lane' && n.parent === id).length
  const usedSubs = nodes.filter((n) => n.kind === 'sub' && n.parent === id).length
  const ringDetail = (level) => {
    const taken = ringUse(nodes, level)
    const limit = count(seats?.rings?.[level]) ? seats.rings[level] : null
    const free = limit === null ? null : Math.max(0, limit - taken)
    return { ring: level, taken, limit, free }
  }
  const rings = nextRing !== null ? [ringDetail(ring), ringDetail(nextRing)] : [ringDetail(ring)]
  return {
    id,
    name: node?.label || (id === MAIN_ID ? 'Orchestrator' : id),
    harness: node?.harness || '',
    mode: node?.mode || '',
    restricted: Boolean(node?.restricted),
    ring,
    nextRing,
    depth,
    grant,
    used: { lanes: usedLanes, totalLanes, subs: usedSubs },
    rings,
  }
}

function ringStatusText(detail) {
  if (detail.limit === null) return `no seats set (${detail.taken} taken)`
  return `${detail.free} free (${detail.taken} of ${detail.limit} taken)`
}

export function formatSeatsReply({ seats, tree, id, depth = AGENT_DEPTH_DEFAULT }) {
  const info = seatSummary({ seats, tree, id, depth })
  const lastNote = info.nextRing === null ? ` (ring ${info.ring} is the last allowed ring at depth ${info.depth})` : ''
  const lines = [
    `Seat grant for ${info.name}: ${plural(info.grant.lanes, 'lane')} turned on, ${plural(info.grant.subs, 'sub')}${lastNote}.`,
    `Using: ${info.used.lanes} of ${plural(info.grant.lanes, 'lane')} on (${info.used.totalLanes} total), ${info.used.subs} of ${plural(info.grant.subs, 'sub')}.`,
    `Ring ${info.rings[0].ring} (lanes): ${ringStatusText(info.rings[0])}.`,
  ]
  if (info.rings[1]) {
    lines.push(`Ring ${info.rings[1].ring} (subs): ${ringStatusText(info.rings[1])}.`)
  }
  if (info.harness === 'agy' && info.mode && info.mode !== 'bypass') {
    lines.push('Note: AGY needs Bypass mode to use a seat grant.')
  }
  return lines.join('\n')
}

export function formatAgentsReply({ tree, id }) {
  const nodes = tree ?? []
  const host = nodeOf(nodes, id)
  const hostName = host?.label || (id === MAIN_ID ? 'Orchestrator' : id)
  const children = nodes.filter((node) => (node.kind === 'lane' || node.kind === 'sub') && isUnder(nodes, node, id))
  if (children.length === 0) return `No agents under ${hostName}.`
  const lines = [`Agents under ${hostName}:`]
  for (const child of children) {
    const level = levelOf(nodes, child)
    const status = child.active ? 'on' : 'off'
    const seat = child.active ? `1 seat on ring ${level}` : `0 seats (ring ${level})`
    const maker = child.createdBy ? (nodeOf(nodes, child.createdBy)?.label || child.createdBy) : 'owner'
    lines.push(`- ${child.label || child.id} (${child.kind}): ${status}, ${seat}, made by ${maker}.`)
  }
  return lines.join('\n')
}

export function formatRevokeNotice({ seats, tree, id, depth = AGENT_DEPTH_DEFAULT, requestedSubs = 0 }) {
  const info = seatSummary({ seats, tree, id, depth })
  const depthNote = requestedSubs > 0 && info.nextRing === null
    ? ` Ring ${info.ring} is the last allowed ring at depth ${info.depth}, so your sub grant is 0.`
    : ''
  return [
    `The owner revoked your seat grant (now 0 lanes and 0 subs).${depthNote}`,
    'Agents already made stay as they are. You may make no more and may only propose a lane with POST /api/family/proposals.',
  ].join('\n')
}

export function formatGrantNotice({ seats, tree, id, depth = AGENT_DEPTH_DEFAULT, lanes, subs, requestedSubs = subs }) {
  const info = seatSummary({ seats, tree, id, depth })
  const effectiveSubs = info.nextRing !== null ? subs : 0
  if (lanes === 0 && effectiveSubs === 0) {
    return formatRevokeNotice({ seats, tree, id, depth, requestedSubs })
  }
  const depthNote = requestedSubs > 0 && info.nextRing === null
    ? ` Ring ${info.ring} is the last allowed ring at depth ${info.depth}, so your sub grant is 0.`
    : ''
  const subRingText = info.nextRing !== null ? ` (ring ${info.nextRing})` : ''
  const abilities = []
  if (lanes > 0) abilities.push('create lanes under yourself and turn your lanes on or off')
  if (effectiveSubs > 0) abilities.push(`add subs under yourself on ring ${info.nextRing}`)
  const canDo = `You may now ${abilities.join(', and ')}.`
  const cannotDo = lanes === 0
    ? ' You may not create lanes; propose a lane with POST /api/family/proposals.'
    : effectiveSubs === 0
      ? ' You may not add subs.'
      : ''
  const routes = []
  if (lanes > 0) {
    routes.push('- POST /api/lanes/create to create a lane under yourself (turns on only if a seat is free).')
    routes.push('- POST /api/lanes/active to turn lanes under you on or off.')
  }
  if (effectiveSubs > 0) {
    routes.push(`- POST /api/orchestrator/ladder to add a sub under yourself on ring ${info.nextRing}.`)
  }
  const ringNotes = []
  if (lanes > 0 && info.rings[0]) ringNotes.push(`ring ${info.rings[0].ring}: ${ringStatusText(info.rings[0])}`)
  if (effectiveSubs > 0 && info.rings[1]) ringNotes.push(`ring ${info.rings[1].ring}: ${ringStatusText(info.rings[1])}`)
  const harnessRule = info.harness ? `Use only your own harness (${info.harness}) with a listed model.` : 'Use only your own harness with a listed model.'
  const scopeRule = info.restricted ? ' Any sub you add stays restricted to your scope or narrower.' : ''
  return [
    `The owner updated your seat grant: up to ${plural(lanes, 'lane')} turned on (ring ${info.ring}) and ${plural(effectiveSubs, 'sub')}${subRingText}.${depthNote}`,
    `${canDo}${cannotDo}`,
    'Routes (send your X-MachineRoom-Orchestrator header and confirmed: true):',
    ...routes,
    `Limits: stay within your grant (${plural(lanes, 'lane')} on, ${plural(effectiveSubs, 'sub')}) and free seats (${ringNotes.join('; ')}). ${harnessRule} Change only agents under you.${scopeRule}`,
  ].join('\n')
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
    if (action === 'turnOff') {
      const myGrant = grantFor(seats, me.id)
      if (node.kind === 'lane' && !(myGrant.lanes > 0)) return refuse(403, 'You have no grant to change lanes.')
      if (node.kind === 'sub' && !(myGrant.subs > 0)) return refuse(403, 'You have no grant to change subs.')
      return { ok: true }
    }
    if (node.active) return { ok: true }
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
