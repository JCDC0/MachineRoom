const MAX_SUBS = 5
const MAX_SCOPE = 20
const ID_PATTERN = /^[a-z0-9-]{1,24}$/
const TURN = Math.PI * 2

export const SECTOR_GAP = 0.04

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function folded(options) {
  return options && options.windows === true ? (text) => text.toLowerCase() : (text) => text
}

function normalizePath(value) {
  if (typeof value !== 'string') return null
  const parts = value
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part !== '' && part !== '.')
  return parts.join('/')
}

function cleanScopeEntry(value) {
  if (typeof value !== 'string') return null
  const text = value.trim().replace(/\\/g, '/')
  if (!text || text.startsWith('/') || /^[A-Za-z]:/.test(text)) return null
  const parts = text.split('/').filter((part) => part !== '' && part !== '.')
  if (parts.length === 0 || parts.some((part) => part === '..')) return null
  return parts.join('/')
}

function escapePattern(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function segmentMatches(pattern, segment) {
  if (!pattern.includes('*')) return pattern === segment
  const parts = pattern.split('*').map(escapePattern)
  return new RegExp(`^${parts.join('[^/]*')}$`).test(segment)
}

function globMatches(path, pattern) {
  const parts = path === '' ? [] : path.split('/')
  const patternParts = pattern.split('/')
  const memo = new Map()
  function walk(pi, si) {
    const key = `${pi}:${si}`
    if (memo.has(key)) return memo.get(key)
    let result
    if (pi === patternParts.length) {
      result = si === parts.length
    } else if (patternParts[pi] === '**') {
      result = walk(pi + 1, si) || (si < parts.length && walk(pi, si + 1))
    } else {
      result = si < parts.length && segmentMatches(patternParts[pi], parts[si]) && walk(pi + 1, si + 1)
    }
    memo.set(key, result)
    return result
  }
  return walk(0, 0)
}

function matchesPattern(path, pattern) {
  if (!pattern.includes('*')) return path === pattern || path.startsWith(`${pattern}/`)
  return globMatches(path, pattern)
}

function sameScope(left, right) {
  const list = (value) => {
    if (Array.isArray(value)) return value
    if (typeof value === 'string') return [value]
    return []
  }
  const clean = (value) => [...new Set(list(value).map(normalizePath).filter((entry) => entry !== null))].sort()
  const a = clean(left)
  const b = clean(right)
  return a.length === b.length && a.every((entry, index) => entry === b[index])
}

export function inScope(path, scope, options = {}) {
  if (typeof path !== 'string') return false
  const entries = Array.isArray(scope) ? scope : typeof scope === 'string' ? [scope] : []
  const fold = folded(options)
  const target = fold(normalizePath(path) ?? '')
  return entries.some((entry) => {
    if (typeof entry !== 'string') return false
    const pattern = fold(normalizePath(entry) ?? '')
    return pattern !== '' && matchesPattern(target, pattern)
  })
}

export function readLadder(value, options = {}) {
  const problems = []
  if (!isObject(value)) {
    problems.push('The ladder is not an object.')
    return { ladder: { subs: [] }, problems }
  }
  if (value.subs == null) return { ladder: { subs: [] }, problems }
  if (!Array.isArray(value.subs)) {
    problems.push('The ladder subs must be a list.')
    return { ladder: { subs: [] }, problems }
  }

  const known = options && Array.isArray(options.lanes) ? options.lanes : null
  const subs = []
  const ids = new Set()
  const claimed = new Map()

  value.subs.forEach((raw, index) => {
    if (!isObject(raw)) {
      problems.push(`Sub ${index + 1} is not an object.`)
      return
    }
    const id = raw.id
    if (typeof id !== 'string' || id.length === 0) {
      problems.push(`Sub ${index + 1} has no id.`)
      return
    }
    if (!ID_PATTERN.test(id)) {
      problems.push(`The sub id "${id}" must be 1 to 24 lower case letters, digits or dashes.`)
      return
    }
    if (id === 'orchestrator') {
      problems.push('The id "orchestrator" belongs to the main orchestrator.')
      return
    }
    if (known && known.includes(id)) {
      problems.push(`The id "${id}" is a lane key.`)
      return
    }
    if (ids.has(id)) {
      problems.push(`The sub id "${id}" appears twice.`)
      return
    }
    if (subs.length >= MAX_SUBS) {
      problems.push(`There are at most ${MAX_SUBS} sub orchestrators; "${id}" is left out.`)
      return
    }

    const lanes = []
    if (Array.isArray(raw.lanes)) {
      for (const lane of raw.lanes) {
        if (typeof lane !== 'string' || lane.length === 0) {
          problems.push(`Sub "${id}" has a lane that is not a name.`)
          continue
        }
        if (known && !known.includes(lane)) {
          problems.push(`Sub "${id}" names the lane "${lane}", which is not a lane key.`)
          continue
        }
        if (claimed.has(lane)) {
          problems.push(`The lane "${lane}" already belongs to sub "${claimed.get(lane)}".`)
          continue
        }
        if (!lanes.includes(lane)) lanes.push(lane)
      }
    }

    const rawScope = Array.isArray(raw.scope) ? raw.scope : typeof raw.scope === 'string' ? [raw.scope] : []
    if (rawScope.length === 0) problems.push(`Sub "${id}" has no scope.`)
    if (rawScope.length > MAX_SCOPE) {
      problems.push(`Sub "${id}" has more than ${MAX_SCOPE} scope entries; the extra ones are left out.`)
    }
    const scope = []
    for (const entry of rawScope.slice(0, MAX_SCOPE)) {
      const clean = cleanScopeEntry(entry)
      if (clean === null) {
        problems.push(`Sub "${id}" has a scope entry that is not a relative folder or file glob.`)
        continue
      }
      if (!scope.includes(clean)) scope.push(clean)
    }
    if (scope.length === 0 && rawScope.length > 0) problems.push(`Sub "${id}" has no usable scope.`)

    let restricted = true
    if (typeof raw.restricted === 'boolean') {
      restricted = raw.restricted
    } else if (raw.restricted !== undefined) {
      problems.push(`Sub "${id}" says whether it is restricted with a value that is not true or false.`)
    }

    let setBy = 'orchestrator'
    if (raw.setBy === 'owner' || raw.setBy === 'orchestrator') {
      setBy = raw.setBy
    } else if (raw.setBy !== undefined) {
      problems.push(`Sub "${id}" says setBy "${String(raw.setBy)}", which is not owner or orchestrator.`)
    }

    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id
    const harness = typeof raw.harness === 'string' ? raw.harness.trim() : ''
    const model = typeof raw.model === 'string' ? raw.model.trim() : ''

    ids.add(id)
    for (const lane of lanes) claimed.set(lane, id)
    subs.push({ id, name, harness, model, lanes, scope, restricted, setBy })
  })

  return { ladder: { subs }, problems }
}

export function ownerOf(ladder, laneKey) {
  if (!isObject(ladder) || !Array.isArray(ladder.subs) || typeof laneKey !== 'string') return 'orchestrator'
  const sub = ladder.subs.find((entry) => Array.isArray(entry.lanes) && entry.lanes.includes(laneKey))
  return sub && typeof sub.id === 'string' ? sub.id : 'orchestrator'
}

export function outsideScope(paths, sub, options = {}) {
  if (!isObject(sub) || sub.restricted === false) return []
  const scope = Array.isArray(sub.scope) ? sub.scope : typeof sub.scope === 'string' ? [sub.scope] : []
  if (!Array.isArray(paths)) return []
  return paths.filter((path) => !inScope(path, scope, options))
}

export function canChange(ladder, change, by) {
  if (!isObject(change)) return false
  if (by === 'owner') return true
  if (!isObject(ladder) || !Array.isArray(ladder.subs)) return true
  const sub = ladder.subs.find((entry) => entry.id === change.id)
  if (!sub || sub.setBy !== 'owner') return true
  if (Object.hasOwn(change, 'scope') && !sameScope(sub.scope, change.scope)) return false
  if (Object.hasOwn(change, 'restricted') && change.restricted !== sub.restricted) return false
  if (Object.hasOwn(change, 'setBy') && change.setBy !== sub.setBy) return false
  return true
}

export function sectorArcs(ladder, roster) {
  const keys = []
  if (Array.isArray(roster)) {
    for (const entry of roster) {
      const key = typeof entry === 'string' ? entry : isObject(entry) && typeof entry.key === 'string' ? entry.key : null
      if (key && !keys.includes(key)) keys.push(key)
    }
  }
  const subs = isObject(ladder) && Array.isArray(ladder.subs) ? ladder.subs : []
  const assigned = new Set()
  const sectors = subs.map((sub) => {
    const lanes = keys.filter((key) => !assigned.has(key) && Array.isArray(sub.lanes) && sub.lanes.includes(key))
    for (const lane of lanes) assigned.add(lane)
    return {
      id: typeof sub.id === 'string' ? sub.id : 'sub',
      name: typeof sub.name === 'string' && sub.name ? sub.name : typeof sub.id === 'string' ? sub.id : 'sub',
      lanes,
    }
  })
  sectors.push({ id: 'orchestrator', name: 'Orchestrator', lanes: keys.filter((key) => !assigned.has(key)) })

  let cursor = 0
  return sectors.map((sector) => {
    const span = keys.length === 0 ? 0 : (sector.lanes.length / keys.length) * TURN
    const inset = Math.min(SECTOR_GAP, span / 2)
    const start = cursor + inset
    const end = cursor + span - inset
    cursor += span
    return { ...sector, start, end }
  })
}

export function subPrompt(sub, parent) {
  const value = isObject(sub) ? sub : {}
  const id = typeof value.id === 'string' && value.id ? value.id : 'sub'
  const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : id
  const lanes = Array.isArray(value.lanes) ? value.lanes.filter((lane) => typeof lane === 'string' && lane) : []
  const scope = Array.isArray(value.scope) ? value.scope.filter((entry) => typeof entry === 'string' && entry) : []
  const restricted = value.restricted !== false
  let parentKey = 'orchestrator'
  if (typeof parent === 'string' && parent) parentKey = parent
  else if (isObject(parent) && typeof parent.id === 'string' && parent.id) parentKey = parent.id

  const laneLine = lanes.length ? lanes.map((lane) => `\`${lane}\``).join(', ') : 'none'
  const scopeLine = scope.length ? scope.map((entry) => `\`${entry}\``).join(', ') : 'none'
  const ruleLine = restricted
    ? 'Your scope is restricted. Your lanes may change files only in that scope.'
    : 'Your scope is open. Your lanes may change files anywhere in the project.'

  return [
    '## Your sector',
    '',
    `You are a sub orchestrator in the room's ladder. Your id is \`${id}\` and your name is ${name}.`,
    `Your parent is \`${parentKey}\`.`,
    `Your lanes: ${laneLine}.`,
    `Your scope: ${scopeLine}.`,
    ruleLine,
    `Your sector branch is \`machineroom/sector-${id}\`.`,
    'Plan for your lanes, start them, review their work and merge it into your sector branch.',
    `Then report to your parent as \`sub:${id}\`.`,
  ].join('\n')
}
