import { readPolicy, TIERS } from './route.js'

const OWNER = 'owner'
const CONTEXT = 3
const EPSILON = 1e-9
const DEFAULT_POLICY_PATH = 'config/policy.json'
const NO_NEWLINE = '\\ No newline at end of file'

function policyPathText(policyPath) {
  const text = String(policyPath ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
  return text || DEFAULT_POLICY_PATH
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function countOf(value) {
  return Number.isInteger(value) && value > 0 ? value : 0
}

function modelKey(model) {
  return String(model ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function keyOf(lane, model) {
  return `${lane}\u0000${modelKey(model)}`
}

function rowMap(rows) {
  const map = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isPlainObject(row)) continue
    const lane = typeof row.lane === 'string' ? row.lane.trim() : ''
    if (lane === '') continue
    const model = typeof row.model === 'string' ? row.model.trim() : ''
    const key = keyOf(lane, model)
    if (!map.has(key)) map.set(key, row)
  }
  return map
}

function statsOf(row) {
  const merged = countOf(row?.merged)
  const rejected = countOf(row?.rejected)
  const decided = merged + rejected
  return {
    merged,
    rejected,
    decided,
    rate: decided === 0 ? null : merged / decided,
    cost: isNumber(row?.costPerMerge) ? row.costPerMerge : null,
  }
}

function costValue(cost) {
  return cost === null ? Infinity : cost
}

function percent(rate) {
  return Math.round(rate * 100)
}

function points(margin) {
  return Math.round(margin * 100)
}

function costPhrase(cost) {
  return cost === null ? 'not reported' : `$${cost.toFixed(2)} a merge`
}

function costOnly(cost) {
  return cost === null ? 'not reported' : `$${cost.toFixed(2)}`
}

function ownerNote(tier) {
  return `The ${tier} tier keeps its order: the owner choice stays where it is.`
}

function fewRunsNote(tier, choice, stats, minRuns) {
  return `The ${tier} tier keeps its order: ${choice.lane} on ${choice.model} has ${stats.decided} decided runs, fewer than ${minRuns}.`
}

function joinLine(tier, choice, row) {
  if (!row) return `${tier}: ${choice.lane} on ${choice.model} joined no row, 0 decided runs.`
  const stats = statsOf(row)
  const lane = typeof row.lane === 'string' && row.lane.trim() !== '' ? row.lane.trim() : choice.lane
  const model = typeof row.model === 'string' && row.model.trim() !== '' ? row.model.trim() : 'model unknown'
  return `${tier}: ${choice.lane} on ${choice.model} joined the row ${lane} on ${model} with ${stats.decided} decided runs.`
}

function marginNote(tier, earlier, later, earlyStats, lateStats, margin) {
  return `The ${tier} tier keeps its order: ${later.lane} on ${later.model} merges ${percent(lateStats.rate)}% against ${percent(earlyStats.rate)}% for ${earlier.lane} on ${earlier.model}, less than ${points(margin)} points ahead.`
}

function costNote(tier, earlier, later, earlyStats, lateStats) {
  return `The ${tier} tier keeps its order: ${later.lane} on ${later.model} costs ${costPhrase(lateStats.cost)} against ${costOnly(earlyStats.cost)} for ${earlier.lane} on ${earlier.model}.`
}

function changeText(tier, earlier, later, earlyStats, lateStats) {
  return `Move ${later.lane} on ${later.model} ahead of ${earlier.lane} on ${earlier.model} in the ${tier} tier: ${percent(lateStats.rate)}% merged over ${lateStats.decided} decided runs against ${percent(earlyStats.rate)}% over ${earlyStats.decided}, ${costPhrase(lateStats.cost)} against ${costOnly(earlyStats.cost)}.`
}

export function proposePolicy({ policy, rows, minDecided = 10, margin = 0.15 } = {}) {
  const clean = readPolicy(policy)
  const table = rowMap(rows)
  const minRuns = Number.isFinite(minDecided) ? Math.max(0, Math.floor(minDecided)) : 10
  const gap = Number.isFinite(margin) ? Math.max(0, margin) : 0.15
  const tiers = {}
  const changes = []
  const notes = []
  const joins = []
  for (const tier of TIERS) {
    const list = clean.tiers[tier]
    tiers[tier] = list
    for (const choice of list) {
      if (choice.lane === OWNER) continue
      joins.push(joinLine(tier, choice, table.get(keyOf(choice.lane, choice.model))))
    }
    for (let index = 0; index + 1 < list.length; index += 1) {
      const earlier = list[index]
      const later = list[index + 1]
      if (earlier.lane === OWNER || later.lane === OWNER) {
        notes.push(ownerNote(tier))
        continue
      }
      const earlyStats = statsOf(table.get(keyOf(earlier.lane, earlier.model)))
      const lateStats = statsOf(table.get(keyOf(later.lane, later.model)))
      if (earlyStats.decided < minRuns || lateStats.decided < minRuns || earlyStats.rate === null || lateStats.rate === null) {
        const [choice, stats] = earlyStats.decided <= lateStats.decided ? [earlier, earlyStats] : [later, lateStats]
        notes.push(fewRunsNote(tier, choice, stats, minRuns))
        continue
      }
      if (lateStats.rate - earlyStats.rate + EPSILON < gap) {
        notes.push(marginNote(tier, earlier, later, earlyStats, lateStats, gap))
        continue
      }
      if (costValue(lateStats.cost) > costValue(earlyStats.cost)) {
        notes.push(costNote(tier, earlier, later, earlyStats, lateStats))
        continue
      }
      const next = list.slice()
      next[index] = later
      next[index + 1] = earlier
      tiers[tier] = next
      changes.push(changeText(tier, earlier, later, earlyStats, lateStats))
      break
    }
  }
  return {
    policy: { tiers, limits: clean.limits, quotaSkipPercent: clean.quotaSkipPercent },
    changes,
    notes,
    joins,
  }
}

export function policyText(policy) {
  return `${JSON.stringify(policy, null, 2)}\n`
}

function splitText(value) {
  const source = typeof value === 'string' ? value : ''
  if (source === '') return { lines: [], trailing: true }
  const lines = source.split('\n')
  const trailing = lines[lines.length - 1] === ''
  if (trailing) lines.pop()
  return { lines, trailing }
}

function editScript(before, after) {
  const table = Array.from({ length: before.length + 1 }, () => new Array(after.length + 1).fill(0))
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i][j] = before[i] === after[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const entries = []
  let i = 0
  let j = 0
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      entries.push({ type: 'equal', text: before[i], before: i + 1, after: j + 1 })
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      entries.push({ type: 'delete', text: before[i], before: i + 1, after: null })
      i += 1
    } else {
      entries.push({ type: 'insert', text: after[j], before: null, after: j + 1 })
      j += 1
    }
  }
  while (i < before.length) {
    entries.push({ type: 'delete', text: before[i], before: i + 1, after: null })
    i += 1
  }
  while (j < after.length) {
    entries.push({ type: 'insert', text: after[j], before: null, after: j + 1 })
    j += 1
  }
  return entries
}

function blocksOf(entries) {
  const blocks = []
  for (const entry of entries) {
    const equal = entry.type === 'equal'
    const last = blocks[blocks.length - 1]
    if (last && last.equal === equal) last.entries.push(entry)
    else blocks.push({ equal, entries: [entry] })
  }
  return blocks
}

function groupsOf(entries) {
  const groups = []
  let group = []
  for (const block of blocksOf(entries)) {
    if (!block.equal || block.entries.length <= CONTEXT * 2) {
      group.push(block)
      continue
    }
    if (group.length > 0) {
      group.push({ equal: true, entries: block.entries.slice(0, CONTEXT) })
      groups.push(group)
      group = []
    }
    group.push({ equal: true, entries: block.entries.slice(-CONTEXT) })
  }
  if (group.length > 0) groups.push(group)
  const kept = groups.filter((blocks) => blocks.some((block) => !block.equal))
  if (kept.length === 0) return kept
  const first = kept[0]
  const head = first[0]
  if (head.equal && head.entries.length > CONTEXT) {
    first[0] = { equal: true, entries: head.entries.slice(-CONTEXT) }
  }
  const last = kept[kept.length - 1]
  const tail = last[last.length - 1]
  if (tail.equal && tail.entries.length > CONTEXT) {
    last[last.length - 1] = { equal: true, entries: tail.entries.slice(0, CONTEXT) }
  }
  return kept
}

function rangeText(start, count) {
  return count === 1 ? String(start) : `${start},${count}`
}

function prefixOf(type) {
  if (type === 'delete') return '-'
  if (type === 'insert') return '+'
  return ' '
}

function endsWithoutNewline(entry, before, after) {
  const oldLast = entry.before !== null && !before.trailing && entry.before === before.lines.length
  const newLast = entry.after !== null && !after.trailing && entry.after === after.lines.length
  return oldLast || newLast
}

export function policyDiff(beforeText, afterText, policyPath = DEFAULT_POLICY_PATH) {
  if (beforeText === afterText) return ''
  const before = splitText(beforeText)
  const after = splitText(afterText)
  const groups = groupsOf(editScript(before.lines, after.lines))
  if (groups.length === 0) return ''
  const name = policyPathText(policyPath)
  const output = [`--- a/${name}`, `+++ b/${name}`]
  let oldDone = 0
  let newDone = 0
  for (const group of groups) {
    const entries = group.flatMap((block) => block.entries)
    const oldEntries = entries.filter((entry) => entry.before !== null)
    const newEntries = entries.filter((entry) => entry.after !== null)
    const oldStart = oldEntries.length > 0 ? oldEntries[0].before : oldDone
    const newStart = newEntries.length > 0 ? newEntries[0].after : newDone
    output.push(`@@ -${rangeText(oldStart, oldEntries.length)} +${rangeText(newStart, newEntries.length)} @@`)
    for (const entry of entries) {
      output.push(`${prefixOf(entry.type)}${entry.text}`)
      if (endsWithoutNewline(entry, before, after)) output.push(NO_NEWLINE)
    }
    oldDone += oldEntries.length
    newDone += newEntries.length
  }
  return `${output.join('\n')}\n`
}
