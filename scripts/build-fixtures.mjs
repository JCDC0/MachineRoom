import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findLeaks } from '../src/briefs/audit.js'
import { gitPath } from '../server/programPath.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const SECRET = /eyJ[A-Za-z0-9_-]{40,}\.|Bearer [A-Za-z0-9._~+/=-]{16,}|xox[bp]-|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/
const LOG_TYPE = 'heartbeat.run.log'

const ACCOUNT = userInfo().username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const ACCOUNT_PATHS = new RegExp(ACCOUNT, 'gi')
const EMAILS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g

function scrub(value) {
  if (typeof value === 'string') return value.replace(ACCOUNT_PATHS, 'user').replace(EMAILS, 'user')
  if (Array.isArray(value)) return value.map(scrub)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item)]))
  }
  return value
}

function isLogFrame(frame) {
  const payload = frame?.payload
  return frame?.type === LOG_TYPE && payload !== null && typeof payload === 'object' && typeof payload.runId === 'string' && typeof payload.chunk === 'string'
}

function scrubFrame(frame) {
  if (!isLogFrame(frame)) return scrub(frame)
  const payload = Object.fromEntries(
    Object.entries(frame.payload).map(([key, value]) => [key, key === 'chunk' ? value : scrub(value)])
  )
  return { ...frame, payload }
}

function streamGroups(frames) {
  const groups = new Map()
  frames.forEach((frame, index) => {
    if (!isLogFrame(frame)) return
    const stream = typeof frame.payload.stream === 'string' ? frame.payload.stream : ''
    const key = `${frame.payload.runId}\n${stream}`
    let group = groups.get(key)
    if (!group) {
      group = { items: [] }
      groups.set(key, group)
    }
    group.items.push({ frame, index })
  })
  for (const group of groups.values()) {
    const numbered = group.items.every((item) => typeof item.frame.payload.seq === 'number')
    if (numbered) group.items.sort((a, b) => a.frame.payload.seq - b.frame.payload.seq || a.index - b.index)
  }
  return groups
}

function trackedSpans(text, pattern, replacement) {
  const spans = []
  let masked = ''
  let at = 0
  pattern.lastIndex = 0
  let match
  while ((match = pattern.exec(text)) !== null) {
    if (match[0] === '') {
      pattern.lastIndex += 1
      continue
    }
    masked += text.slice(at, match.index)
    const outStart = masked.length
    masked += replacement
    spans.push({ start: match.index, end: match.index + match[0].length, outStart, outEnd: masked.length })
    at = match.index + match[0].length
  }
  masked += text.slice(at)
  return { text: masked, spans }
}

function mapBackStart(position, spans) {
  let shift = 0
  for (const span of spans) {
    if (position <= span.outStart) return position - shift
    if (position < span.outEnd) return span.start
    shift += (span.outEnd - span.outStart) - (span.end - span.start)
  }
  return position - shift
}

function mapBackEnd(position, spans) {
  let shift = 0
  for (const span of spans) {
    if (position <= span.outStart) return position - shift
    if (position < span.outEnd) return span.end
    shift += (span.outEnd - span.outStart) - (span.end - span.start)
  }
  return position - shift
}

function maskText(text) {
  const account = ACCOUNT === '' ? { text, spans: [] } : trackedSpans(text, ACCOUNT_PATHS, 'user')
  const email = trackedSpans(account.text, EMAILS, 'user')
  const spans = account.spans.map((span) => ({ start: span.start, end: span.end }))
  for (const span of email.spans) {
    spans.push({ start: mapBackStart(span.start, account.spans), end: mapBackEnd(span.end, account.spans) })
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end)
  const merged = []
  for (const span of spans) {
    const last = merged[merged.length - 1]
    if (last && span.start < last.end) last.end = Math.max(last.end, span.end)
    else merged.push({ ...span })
  }
  if (merged.length === 0) return { text, spans: [] }
  let masked = ''
  let at = 0
  const cuts = []
  for (const span of merged) {
    masked += text.slice(at, span.start)
    const outStart = masked.length
    masked += 'user'
    cuts.push({ start: span.start, end: span.end, outStart, outEnd: masked.length })
    at = span.end
  }
  masked += text.slice(at)
  return { text: masked, spans: cuts }
}

function cutAt(boundary, spans) {
  let shift = 0
  for (const span of spans) {
    if (boundary <= span.start) break
    if (boundary < span.end) return span.outEnd
    shift += (span.outEnd - span.outStart) - (span.end - span.start)
  }
  return boundary + shift
}

function jsonStringTokens(line) {
  const tokens = []
  let index = 0
  while (index < line.length) {
    if (line[index] !== '"') {
      index += 1
      continue
    }
    let end = index + 1
    while (end < line.length && line[end] !== '"') {
      if (line[end] === '\\') end += 2
      else end += 1
    }
    if (end >= line.length) break
    const raw = line.slice(index, end + 1)
    let value = null
    try {
      value = JSON.parse(raw)
    } catch {
      value = null
    }
    tokens.push({ start: index, end: end + 1, value })
    index = end + 1
  }
  return tokens
}

function deltaOf(line) {
  let event
  try {
    event = JSON.parse(line)
  } catch {
    return null
  }
  if (event?.event !== 'step_update') return null
  const step = event.step_update
  if (!step || typeof step.text_delta !== 'string') return null
  return { delta: step.text_delta, conversation: step.conversation_id, index: step.step_index }
}

function lineParts(text) {
  const parts = []
  let at = 0
  while (at <= text.length) {
    const end = text.indexOf('\n', at)
    if (end === -1) {
      parts.push({ start: at, end: text.length, line: text.slice(at) })
      break
    }
    parts.push({ start: at, end: end + 1, line: text.slice(at, end + 1) })
    at = end + 1
  }
  return parts
}

function deltaGroups(text) {
  const groups = []
  let group = null
  for (const part of lineParts(text)) {
    const delta = deltaOf(part.line)
    if (!delta) {
      group = null
      continue
    }
    if (group && group.conversation === delta.conversation && group.index === delta.index) {
      group.items.push({ part, delta })
    } else {
      group = { conversation: delta.conversation, index: delta.index, items: [{ part, delta }] }
      groups.push(group)
    }
  }
  return groups
}

function deltaText(group) {
  return group.items.map((item) => item.delta.delta).join('')
}

function applySpans(pieces, spans) {
  const values = pieces.map((piece) => piece.value)
  const bounds = []
  let at = 0
  for (const value of values) {
    bounds.push({ start: at, end: at + value.length })
    at += value.length
  }
  for (let index = spans.length - 1; index >= 0; index -= 1) {
    const span = spans[index]
    let startPiece = -1
    let endPiece = -1
    for (let piece = 0; piece < bounds.length; piece += 1) {
      if (startPiece === -1 && span.start >= bounds[piece].start && span.start < bounds[piece].end) startPiece = piece
      if (span.end > bounds[piece].start && span.end <= bounds[piece].end) {
        endPiece = piece
        break
      }
    }
    if (startPiece === -1) continue
    if (endPiece === -1) endPiece = values.length - 1
    const startLocal = span.start - bounds[startPiece].start
    const endLocal = Math.min(span.end - bounds[endPiece].start, values[endPiece].length)
    if (startPiece === endPiece) {
      values[startPiece] = values[startPiece].slice(0, startLocal) + 'user' + values[startPiece].slice(endLocal)
    } else {
      values[startPiece] = values[startPiece].slice(0, startLocal) + 'user'
      for (let piece = startPiece + 1; piece < endPiece; piece += 1) values[piece] = ''
      values[endPiece] = values[endPiece].slice(endLocal)
    }
  }
  return values
}

function maskDeltas(text) {
  const parts = lineParts(text)
  const edited = new Map()
  for (const item of deltaGroups(text)) {
    if (item.items.length < 2) continue
    const pieces = []
    for (const entry of item.items) {
      const keyAt = entry.part.line.lastIndexOf('"text_delta"')
      const token = jsonStringTokens(entry.part.line).findLast((candidate) => candidate.start > keyAt && candidate.value === entry.delta.delta)
      if (!token) {
        pieces.length = 0
        break
      }
      pieces.push({ part: entry.part, token, value: entry.delta.delta })
    }
    if (pieces.length === 0) continue
    const result = maskText(deltaText(item))
    if (result.spans.length === 0) continue
    const values = applySpans(pieces, result.spans)
    pieces.forEach((piece, index) => {
      if (values[index] === piece.value) return
      const line = piece.part.line
      edited.set(piece.part.start, `${line.slice(0, piece.token.start)}${JSON.stringify(values[index])}${line.slice(piece.token.end)}`)
    })
  }
  if (edited.size === 0) return { text, edits: [] }
  const edits = []
  let masked = ''
  for (const part of parts) {
    const line = edited.get(part.start)
    if (line === undefined) {
      masked += part.line
      continue
    }
    edits.push({ start: part.start, end: part.end, text: line })
    masked += line
  }
  return { text: masked, edits }
}

function mapEdited(boundary, edits) {
  let shift = 0
  for (const edit of edits) {
    if (boundary <= edit.start) break
    if (boundary < edit.end) return edit.start + shift + edit.text.length
    shift += edit.text.length - (edit.end - edit.start)
  }
  return boundary + shift
}

export function scrubFrames(frames) {
  const masked = frames.map(scrubFrame)
  for (const group of streamGroups(masked).values()) {
    const chunks = group.items.map((item) => item.frame.payload.chunk)
    const deltas = maskDeltas(chunks.join(''))
    const result = maskText(deltas.text)
    const pieces = []
    let at = 0
    let from = 0
    for (const chunk of chunks) {
      at += chunk.length
      const to = cutAt(mapEdited(at, deltas.edits), result.spans)
      pieces.push(result.text.slice(from, to))
      from = to
    }
    if (from < result.text.length) pieces[pieces.length - 1] += result.text.slice(from)
    group.items.forEach((item, index) => {
      const frame = masked[item.index]
      masked[item.index] = { ...frame, payload: { ...frame.payload, chunk: pieces[index] } }
    })
  }
  return masked
}

function gitList(sandbox, args) {
  return execFileSync(gitPath(), ['-C', sandbox, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

export function fixtureLeak(lines) {
  const frames = []
  for (let index = 0; index < lines.length; index += 1) {
    let frame = null
    try {
      frame = JSON.parse(lines[index])
    } catch {
      frame = null
    }
    frames.push(frame)
    if (findLeaks(lines[index]).some((leak) => leak.kind === 'key')) return index + 1
  }
  for (const group of streamGroups(frames).values()) {
    const joined = group.items.map((item) => item.frame.payload.chunk).join('')
    const key = findLeaks(joined).some((leak) => leak.kind === 'key')
    const deltas = deltaGroups(joined).some((item) => findLeaks(deltaText(item)).some((leak) => leak.kind === 'key'))
    if (!key && !deltas) continue
    return Math.min(...group.items.map((item) => item.index)) + 1
  }
  return 0
}

function secretFrame(lines) {
  const frames = []
  for (let index = 0; index < lines.length; index += 1) {
    if (SECRET.test(lines[index])) return index + 1
    let frame = null
    try {
      frame = JSON.parse(lines[index])
    } catch {
      frame = null
    }
    frames.push(frame)
  }
  for (const group of streamGroups(frames).values()) {
    const joined = group.items.map((item) => item.frame.payload.chunk).join('')
    if (SECRET.test(joined) || deltaGroups(joined).some((item) => SECRET.test(deltaText(item)))) {
      return Math.min(...group.items.map((item) => item.index)) + 1
    }
  }
  return 0
}

export function fixtureNames(outName = 'sandbox') {
  const safeName = outName.replace(/[^A-Za-z0-9._-]/g, '-')
  return {
    run: `${safeName}-run.jsonl`,
    agents: safeName === 'sandbox' ? 'agents.json' : `${safeName}-agents.json`,
    tree: `${safeName}-tree.json`,
  }
}

export function sandboxFiles(sandbox) {
  const tracked = gitList(sandbox, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
  const files = tracked.split('\0').filter(Boolean).sort()
  const first = gitList(sandbox, ['rev-list', '--max-parents=0', 'HEAD']).trim()
  const baselineList = gitList(sandbox, ['ls-tree', '-r', '-z', '--name-only', first])
  const baseline = new Set(baselineList.split('\0').filter(Boolean))
  const created = files.filter((file) => !baseline.has(file))
  return { files, created }
}

function main(argv) {
  const [rawFile, sandbox, idsFile, outName = 'sandbox'] = argv

  if (!rawFile || !sandbox || !idsFile) {
    console.error('usage: npm run fixtures -- <frames-or-raw-events.jsonl> <sandbox-folder> <ids.json> [out-name]')
    return 1
  }

  const names = fixtureNames(outName)

  const frames = scrubFrames(
    readFileSync(rawFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .map((entry) => (entry.kind === undefined ? entry : entry.kind === 'frame' ? JSON.parse(entry.data) : null))
      .filter(Boolean)
  )

  const lines = frames.map((frame) => JSON.stringify(frame))
  const leak = fixtureLeak(lines)
  if (leak !== 0) {
    console.error(`possible key in frame ${leak}; fixture not written`)
    return 2
  }
  const secret = secretFrame(lines)
  if (secret !== 0) {
    console.error(`possible secret in frame ${secret}; fixture not written`)
    return 2
  }
  writeFileSync(join(root, 'public', 'fixtures', names.run), lines.join('\n') + '\n')

  const ids = JSON.parse(readFileSync(idsFile, 'utf8').replace(/^\uFEFF/, ''))
  const adapters = { claude: 'claude_local', hermes: 'hermes_local', opencode: 'opencode_local', agy: 'process' }
  const labels = { claude: 'Claude Code', hermes: 'Hermes', opencode: 'OpenCode Go', agy: 'agy' }
  const agents = Object.entries(ids.agents).map(([key, id]) => ({
    id,
    key,
    name: labels[key],
    adapterType: adapters[key],
    parser: key,
  }))
  writeFileSync(join(root, 'public', 'fixtures', names.agents), JSON.stringify({ projectRoot: 'agent-sandbox', agents }, null, 2) + '\n')

  const { files, created } = sandboxFiles(sandbox)
  writeFileSync(join(root, 'public', 'fixtures', names.tree), JSON.stringify({ root: 'agent-sandbox', files, created }, null, 2) + '\n')

  console.log(`frames: ${frames.length}, agents: ${agents.length}, files: ${files.length}, created: ${created.length}`)
  return 0
}

const invoked = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false
if (invoked) process.exitCode = main(process.argv.slice(2))

