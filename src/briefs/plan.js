import { parseBriefs } from './briefs.js'

const ID_SHAPE = /^[A-Z]\d+[a-z]?$/
const SIZES = ['small', 'medium', 'large']
const EM_DASH = /\u2014/
const FILES_MARKER = /\bFiles:/
const TITLE_BREAK = /[*()\r\n]/
const MAX_BRIEFS = 8

function textOf(value) {
  return typeof value === 'string' ? value : ''
}

function normalizePath(value) {
  return String(value).replace(/\\/g, '/').replace(/^\.\//, '').trim()
}

function listOf(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value.split(',').map((entry) => entry.trim()).filter(Boolean)
  }
  return []
}

function idIndex(ids) {
  const index = {}
  if (Array.isArray(ids)) {
    for (const entry of ids) {
      const id = typeof entry === 'string' ? entry.trim() : textOf(entry?.id).trim()
      if (id) index[id] = true
    }
  } else if (ids instanceof Set) {
    for (const entry of ids) {
      if (typeof entry === 'string' && entry.trim()) index[entry.trim()] = true
    }
  } else if (ids !== null && typeof ids === 'object') {
    for (const key of Object.keys(ids)) index[key] = true
  }
  return index
}

function firstObject(text) {
  const source = String(text ?? '')
  const start = source.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  return null
}

function foldedPath(value) {
  const text = normalizePath(value).toLowerCase()
  if (text.startsWith('/') || /^[a-z]:/.test(text)) return null
  const kept = []
  for (const part of text.split('/')) {
    if (part === '' || part === '.') continue
    if (part !== '..') kept.push(part)
    else if (kept.length === 0) return null
    else kept.pop()
  }
  return kept.join('/')
}

function listedPaths(text) {
  const marker = FILES_MARKER.exec(text)
  if (!marker) return []
  return [...text.slice(marker.index).matchAll(/`([^`\n]+)`/g)].map((match) => match[1].trim()).filter(Boolean)
}

export function pathAllowed(path, forbidden) {
  const target = foldedPath(path)
  if (target === null || target === '') return false
  if (!Array.isArray(forbidden)) return true
  for (const entry of forbidden) {
    const rule = normalizePath(entry).toLowerCase()
    if (rule.endsWith('/**')) {
      const dir = rule.slice(0, -3)
      if (target === dir || target.startsWith(`${dir}/`)) return false
    } else if (target === rule) {
      return false
    }
  }
  return true
}

function underTests(value) {
  const target = foldedPath(value)
  return target !== null && target.startsWith('tests/')
}

export function planPrompt({ goal, lanes, rules, ids } = {}) {
  const laneTable = lanes !== null && typeof lanes === 'object' ? lanes : {}
  const parts = rules !== null && typeof rules === 'object' ? rules : {}
  const usedIds = Object.keys(idIndex(ids))
  const lines = []
  lines.push('Plan a goal into briefs for MachineRoom.')
  lines.push('')
  lines.push(`Goal: ${textOf(goal).trim()}`)
  lines.push('')
  if (textOf(parts.about).trim()) {
    lines.push(textOf(parts.about).trim())
    lines.push('')
  }
  lines.push('House rules:')
  for (const rule of Array.isArray(parts.rules) ? parts.rules : []) lines.push(`- ${rule}`)
  lines.push('')
  lines.push('Lanes:')
  for (const key of Object.keys(laneTable)) {
    const lane = laneTable[key]
    const name = textOf(lane?.name).trim() || key
    const forbidden = Array.isArray(lane?.forbidden) ? lane.forbidden : []
    lines.push(`- ${key} (${name}): ${textOf(lane?.role).trim()}`)
    lines.push(`  Forbidden: ${forbidden.length > 0 ? forbidden.join(', ') : 'none'}`)
  }
  lines.push('')
  lines.push(`Ids already used: ${usedIds.length > 0 ? usedIds.join(', ') : 'none'}.`)
  lines.push('')
  lines.push('Answer with one JSON object and nothing else:')
  lines.push(
    '{ "briefs": [{ "id": "C7a", "title": "Short title", "owner": "hermes", "size": "small", "files": ["src/briefs/plan.js"], "tests": ["tests/plan.test.js"], "text": "The brief in one paragraph.", "dependsOn": [] }] }',
  )
  lines.push('')
  lines.push('Each brief:')
  lines.push('- id like C7a, not one already used.')
  lines.push('- owner is a lane key from the list above.')
  lines.push('- size is small, medium or large.')
  lines.push('- files holds the project paths the brief may touch, and the owner must be allowed to touch them.')
  lines.push('- tests names each test by its file name, for example tests/plan.test.js.')
  lines.push('- dependsOn holds the ids that must land first, and each one must be in the plan.')
  lines.push('')
  lines.push('Style:')
  lines.push('- One paragraph per brief.')
  lines.push('- Plain words, short sentences.')
  lines.push('- No em dashes.')
  lines.push('- Write each exact sentence the brief needs in backticks.')
  lines.push('- At most 8 briefs.')
  return lines.join('\n')
}

function loopIds(idsInPlan, entries) {
  const graph = {}
  for (const id of Object.keys(idsInPlan)) graph[id] = []
  for (const entry of entries) {
    const id = textOf(entry?.id).trim()
    if (!Object.hasOwn(graph, id)) continue
    for (const dep of listOf(entry?.dependsOn)) {
      if (Object.hasOwn(idsInPlan, dep)) graph[id].push(dep)
    }
  }
  const found = {}
  for (const start of Object.keys(graph)) {
    const seen = {}
    const stack = [...graph[start]]
    while (stack.length > 0) {
      const next = stack.pop()
      if (next === start) {
        found[start] = true
        break
      }
      if (Object.hasOwn(seen, next)) continue
      seen[next] = true
      for (const dep of graph[next] ?? []) stack.push(dep)
    }
  }
  return found
}

function briefProblem(entry, id, { laneTable, used, counts, idsInPlan }) {
  if (Object.hasOwn(used, id)) return `Brief ${id} uses an id that is taken.`
  if (counts[id] > 1) return `Brief ${id} appears twice.`
  const title = textOf(entry?.title).trim()
  if (TITLE_BREAK.test(title) || FILES_MARKER.test(title)) return `Brief ${id} has a title the brief list cannot read.`
  const owner = textOf(entry?.owner).trim()
  if (!Object.hasOwn(laneTable, owner)) return `Brief ${id} names an owner that is not a lane: ${owner}.`
  const size = textOf(entry?.size).trim().toLowerCase()
  if (!SIZES.includes(size)) return `Brief ${id} has no size of small, medium or large.`
  const files = listOf(entry?.files)
  if (files.length === 0) return `Brief ${id} lists no files.`
  const tests = listOf(entry?.tests)
  const lane = laneTable[owner]
  const forbidden = Array.isArray(lane?.forbidden) ? lane.forbidden : []
  for (const file of [...files, ...tests, ...listedPaths(textOf(entry?.text))]) {
    if (!pathAllowed(file, forbidden)) return `Brief ${id} lets ${owner} touch ${file}, which lanes.json forbids.`
  }
  for (const test of tests) {
    if (!underTests(test)) return `Brief ${id} names a test outside tests/: ${test}.`
  }
  if (tests.length === 0) return `Brief ${id} names no test.`
  const dashes = [textOf(entry?.title), textOf(entry?.text), ...files, ...tests]
  if (dashes.some((line) => EM_DASH.test(line))) return `Brief ${id} has an em dash.`
  for (const dep of listOf(entry?.dependsOn)) {
    if (!Object.hasOwn(idsInPlan, dep)) return `Brief ${id} depends on ${dep}, which is not in the plan.`
  }
  if (!briefMarkdown({ ...entry, id }, laneTable)) return `Brief ${id} cannot be written as one line of the brief list.`
  return ''
}

function briefFrom(entry, id) {
  return {
    id,
    title: textOf(entry?.title).trim(),
    owner: textOf(entry?.owner).trim(),
    size: textOf(entry?.size).trim().toLowerCase(),
    files: listOf(entry?.files),
    tests: listOf(entry?.tests),
    text: textOf(entry?.text).trim(),
    dependsOn: listOf(entry?.dependsOn),
  }
}

export function parsePlan(text, { lanes, ids } = {}) {
  const laneTable = lanes !== null && typeof lanes === 'object' ? lanes : {}
  const used = idIndex(ids)
  const raw = firstObject(text)
  if (raw === null) return { briefs: [], problems: ['The plan is not JSON.'] }
  let plan = null
  try {
    plan = JSON.parse(raw)
  } catch {
    return { briefs: [], problems: ['The plan is not JSON.'] }
  }
  const entries = plan !== null && typeof plan === 'object' && Array.isArray(plan.briefs) ? plan.briefs : null
  if (entries === null || entries.length === 0) return { briefs: [], problems: ['The plan has no briefs.'] }
  if (entries.length > MAX_BRIEFS) return { briefs: [], problems: ['The plan has more than 8 briefs.'] }
  const idsInPlan = {}
  const counts = {}
  for (const entry of entries) {
    const id = textOf(entry?.id).trim()
    if (!ID_SHAPE.test(id)) continue
    idsInPlan[id] = true
    counts[id] = (counts[id] ?? 0) + 1
  }
  const loop = loopIds(idsInPlan, entries)
  const briefs = []
  const problems = []
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const id = textOf(entry?.id).trim()
    if (!ID_SHAPE.test(id)) {
      problems.push(`Brief ${index + 1} has no id like C7a.`)
      continue
    }
    const problem = briefProblem(entry, id, { laneTable, used, counts, idsInPlan })
    if (problem) {
      problems.push(problem)
      continue
    }
    if (Object.hasOwn(loop, id)) continue
    briefs.push(briefFrom(entry, id))
  }
  if (Object.keys(loop).length > 0) problems.push('The plan has a loop in its dependencies.')
  return { briefs, problems }
}

export function briefMarkdown(brief, lanes) {
  const laneTable = lanes !== null && typeof lanes === 'object' ? lanes : {}
  const id = textOf(brief?.id).trim()
  const title = textOf(brief?.title).trim()
  const owner = textOf(brief?.owner).trim()
  const lane = Object.hasOwn(laneTable, owner) ? laneTable[owner] : null
  const name = textOf(lane?.name).trim() || owner
  const text = textOf(brief?.text).trim()
  const files = listOf(brief?.files)
  const tests = listOf(brief?.tests)
  const tick = (path) => `\`${path}\``
  const named = tests.length > 0 && !tests.some((test) => text.includes(test)) ? `Tests in ${tests.map(tick).join(', ')}.` : ''
  const allFiles = [...new Set([...files, ...tests, 'docs/agents/CHANGELOG.md'])]
  const listed = files.length > 0 && !FILES_MARKER.test(text) ? `Files: ${allFiles.map(tick).join(', ')}.` : ''
  const body = [text, named, listed].filter(Boolean).join(' ')
  const line = `**${id}. ${title} (${name}).** ${body}`.replace(/\s+/g, ' ').trim()
  const readBack = parseBriefs(line)
  if (readBack.length !== 1) return ''
  const [parsed] = readBack
  if (parsed.id !== id || parsed.title !== title.replace(/\s+/g, ' ') || parsed.ownerText !== name) return ''
  return line
}
