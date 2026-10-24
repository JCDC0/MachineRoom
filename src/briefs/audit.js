export const LEAK_KINDS = ['key', 'email', 'userpath', 'profile', 'graded']

export const SAMPLE_WIDTH = 80

const SK_TOKEN = /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}/g
const GOOGLE_KEY = /(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}/g
const GITHUB_TOKEN = /(?<![A-Za-z0-9_])(?:ghp_|gho_|github_pat_)\w{20,}/g
const AWS_TOKEN = /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}/g
const KEY_SETTING = /(?<![A-Za-z0-9_])(OPENROUTER_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY)(?![A-Za-z0-9_])\s*(?::|=)(?![=>])\s*(['"]?)([^\s'"]*)\2/g
const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g
const USER_PATH = /[A-Za-z]:[\\/]Users[\\/](<[^<>\s]{1,64}>|\$env:[A-Za-z_][A-Za-z0-9_]*|%[A-Za-z_][A-Za-z0-9_]*%|[^\s\\/"'`,;:<>|?*)\]}]+)/gi
const GRADED_PATH = /(?<![A-Za-z0-9])coursework(?![A-Za-z0-9])/gi

const PLACEHOLDER = /^(?:your[-_ ]?(?:key|token|api[-_ ]?key).*|your[-_ ]?api.*|x{3,}|changeme|change[-_ ]?me|placeholder|redacted|example.*|todo|none|null|secret|key|\*+|\$\{.*\}|\$[A-Za-z_][A-Za-z0-9_]*)$/i

const ALLOWED_EMAILS = new Set(['noreply@anthropic.com', 'noreply@github.com'])
const ALLOWED_EMAIL_DOMAIN = '@users.noreply.github.com'

const PLACEHOLDER_USER_FOLDERS = new Set([
  'user',
  'owner',
  'name',
  'you',
  'me',
  'example',
  'username',
  '%username%',
  '$env:username',
  '<user>',
  '<name>',
])
const EXAMPLE_EMAIL_DOMAINS = new Set(['example.com', 'example.org', 'example.net'])
const EXAMPLE_EMAIL_SUFFIXES = ['.example', '.invalid', '.test', '.localhost']

function isPlaceholderUserFolder(folder) {
  if (folder.startsWith('${')) return true
  return PLACEHOLDER_USER_FOLDERS.has(folder.toLowerCase())
}

function isExampleDomain(domain) {
  if (EXAMPLE_EMAIL_DOMAINS.has(domain)) return true
  return EXAMPLE_EMAIL_SUFFIXES.some((suffix) => domain.endsWith(suffix))
}

function isVersionDomain(domain) {
  return /^\d+(?:\.\d+)*$/.test(domain)
}

function isPlaceholder(value) {
  if (value === '') return true
  if (value.startsWith('<')) return true
  if (value.includes('...') || value.includes('…')) return true
  return PLACEHOLDER.test(value)
}

function mask(secret) {
  return `${secret.slice(0, 4)}… (${secret.length} characters)`
}

function windowAround(line, index, length, width = SAMPLE_WIDTH) {
  if (line.length <= width) return line
  const room = Math.max(1, width - Math.min(length, width))
  const want = index - Math.floor(room / 2)
  const start = Math.max(0, Math.min(line.length - width, want))
  const end = Math.min(line.length, start + width)
  let text = line.slice(start, end)
  if (start > 0) text = `…${text.slice(1)}`
  if (end < line.length) text = `${text.slice(0, -1)}…`
  return text
}

function escapeWord(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function eachMatch(re, line, visit) {
  re.lastIndex = 0
  let match
  let seen = 0
  while ((match = re.exec(line)) !== null) {
    if (match[0] === '') {
      re.lastIndex += 1
      continue
    }
    visit(match)
    seen += 1
    if (seen >= 200) return
  }
}

function scanLine(line, profileName) {
  const found = []
  const values = []
  eachMatch(KEY_SETTING, line, (match) => {
    const value = match[3] ?? ''
    if (value === '' || value === KEY_MASK) return
    const start = match.index + match[0].lastIndexOf(value)
    values.push([start, start + value.length])
    if (isPlaceholder(value)) return
    const masked = `${line.slice(0, start)}${mask(value)}${line.slice(start + value.length)}`
    found.push({ kind: 'key', index: match.index, sample: windowAround(masked, match.index, match[0].length) })
  })
  const secrets = values.filter(([start, end]) => !isPlaceholder(line.slice(start, end)))
  for (const re of [SK_TOKEN, GITHUB_TOKEN, AWS_TOKEN, GOOGLE_KEY]) {
    eachMatch(re, line, (match) => {
      const inside = values.some(([start, end]) => match.index >= start && match.index < end)
      if (inside) return
      secrets.push([match.index, match.index + match[0].length])
      found.push({ kind: 'key', index: match.index, sample: mask(match[0]) })
    })
  }
  if (secrets.length > 0) {
    let safe = line
    for (const [start, end] of [...secrets].sort((a, b) => b[0] - a[0])) {
      safe = `${safe.slice(0, start)}${mask(safe.slice(start, end))}${safe.slice(end)}`
    }
    line = safe
  }
  eachMatch(EMAIL, line, (match) => {
    const address = match[0].toLowerCase()
    if (ALLOWED_EMAILS.has(address)) return
    if (address.endsWith(ALLOWED_EMAIL_DOMAIN)) return
    const domain = address.slice(address.lastIndexOf('@') + 1)
    if (isExampleDomain(domain) || isVersionDomain(domain)) return
    found.push({ kind: 'email', index: match.index, sample: windowAround(line, match.index, match[0].length) })
  })
  eachMatch(USER_PATH, line, (match) => {
    if (isPlaceholderUserFolder(match[1] ?? '')) return
    found.push({ kind: 'userpath', index: match.index, sample: windowAround(line, match.index, match[0].length) })
  })
  if (profileName) {
    const profile = new RegExp(`(?<![A-Za-z0-9_])${escapeWord(profileName)}(?![A-Za-z0-9_])`, 'gi')
    eachMatch(profile, line, (match) => {
      found.push({ kind: 'profile', index: match.index, sample: windowAround(line, match.index, match[0].length) })
    })
  }
  eachMatch(GRADED_PATH, line, (match) => {
    found.push({ kind: 'graded', index: match.index, sample: windowAround(line, match.index, match[0].length) })
  })
  found.sort((a, b) => a.index - b.index || LEAK_KINDS.indexOf(a.kind) - LEAK_KINDS.indexOf(b.kind))
  return found
}

export function findLeaks(text, { profileName } = {}) {
  if (typeof text !== 'string' || text === '') return []
  const name = typeof profileName === 'string' ? profileName.trim() : ''
  const lines = text.split(/\r\n|\r|\n/)
  const findings = []
  lines.forEach((line, index) => {
    if (line === '') return
    for (const hit of scanLine(line, name)) findings.push({ kind: hit.kind, line: index + 1, sample: hit.sample })
  })
  return findings
}

export const KEY_MASK = '[key]'

function keyRanges(line) {
  const ranges = []
  const settings = []
  eachMatch(KEY_SETTING, line, (match) => {
    const raw = match[3] ?? ''
    const start = match.index + match[0].lastIndexOf(raw)
    const value = raw.replace(/\\+$/, '')
    if (value === '') return
    settings.push([start, start + value.length])
    if (value === KEY_MASK || isPlaceholder(value)) return
    ranges.push([start, start + value.length])
  })
  for (const re of [SK_TOKEN, GITHUB_TOKEN, AWS_TOKEN, GOOGLE_KEY]) {
    eachMatch(re, line, (match) => {
      const inside = settings.some(([start, end]) => match.index >= start && match.index < end)
      if (inside) return
      ranges.push([match.index, match.index + match[0].length])
    })
  }
  const merged = []
  for (const [start, end] of ranges.sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1]
    if (last && start < last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  return merged
}

function maskLine(line) {
  const ranges = keyRanges(line)
  if (ranges.length === 0) return { text: line, count: 0 }
  let text = line
  for (const [start, end] of [...ranges].sort((a, b) => b[0] - a[0])) {
    text = `${text.slice(0, start)}${KEY_MASK}${text.slice(end)}`
  }
  return { text, count: ranges.length }
}

export function maskKeys(text) {
  if (typeof text !== 'string') return { text: '', count: 0 }
  if (text === '') return { text: '', count: 0 }
  const parts = text.split(/(\r\n|\r|\n)/)
  let count = 0
  for (let index = 0; index < parts.length; index += 2) {
    const masked = maskLine(parts[index])
    parts[index] = masked.text
    count += masked.count
  }
  return { text: parts.join(''), count }
}

export function countLeaks(findings) {
  const counts = {}
  for (const kind of LEAK_KINDS) counts[kind] = 0
  for (const finding of findings) {
    if (Object.hasOwn(counts, finding.kind)) counts[finding.kind] += 1
  }
  return counts
}

export const SPLIT_HOLD_MS = 1000
export const KEY_LONGEST = 256
const CONTEXT_KEPT = 4096
const STREAMS_KEPT = 256
const TAIL_SCAN = 1024
const RUN_ENDS = new Set(['succeeded', 'failed', 'cancelled', 'timed_out'])
const LINE_BREAK = /(\r\n|\r|\n)/
const TOKEN_CHAR = /[A-Za-z0-9_-]/
const SETTING_NAMES = ['OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']
const GITHUB_HEADS = ['ghp_', 'gho_', 'github_pat_']
const OPEN_SETTING = /(?<![A-Za-z0-9_])(?:OPENROUTER_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY)\s*(?:[:=]\s*['"]?[^\s'"]*)?$/
const OPEN_SK = /^(?:s|sk|sk-[A-Za-z0-9_-]*)$/
const OPEN_GOOGLE = /^(?:A|AI|AIz|AIza[0-9A-Za-z_-]{0,34})$/
const OPEN_GITHUB = /^(?:ghp_|gho_|github_pat_)\w*$/
const OPEN_AWS = /^(?:A|AK|AKI|AKIA[0-9A-Z]{0,15})$/

function isHeadOf(words, text) {
  return words.some((word) => word.startsWith(text))
}

function openToken(word) {
  for (let index = 0; index < word.length; index += 1) {
    const before = index === 0 ? '' : word[index - 1]
    if (index > 0 && before !== '-' && before !== '_') continue
    const rest = word.slice(index)
    if (index === 0 && (OPEN_SK.test(rest) || OPEN_GOOGLE.test(rest))) return index
    if (before !== '_' && (OPEN_GITHUB.test(rest) || isHeadOf(GITHUB_HEADS, rest) || isHeadOf(SETTING_NAMES, rest))) return index
    if (OPEN_AWS.test(rest)) return index
  }
  return -1
}

export function openKeyStart(line) {
  if (typeof line !== 'string' || line === '') return -1
  const offset = Math.max(0, line.length - TAIL_SCAN)
  const tail = line.slice(offset)
  let wordStart = tail.length
  while (wordStart > 0 && TOKEN_CHAR.test(tail[wordStart - 1])) wordStart -= 1
  const token = openToken(tail.slice(wordStart))
  const setting = OPEN_SETTING.exec(tail)
  const starts = [token === -1 ? -1 : wordStart + token, setting ? setting.index : -1].filter((start) => start !== -1)
  return starts.length === 0 ? -1 : offset + Math.min(...starts)
}

function lineCuts(line, base, keyEnded) {
  const cuts = []
  for (const [start, end] of keyRanges(line)) {
    if (end <= base) continue
    const place = start >= base ? start : keyEnded ? null : base
    cuts.push({ from: Math.max(start, base), to: end, place })
  }
  return cuts
}

function cutText(line, from, to, cuts) {
  let text = ''
  let at = from
  for (const cut of cuts) {
    if (cut.to <= from || cut.from >= to) continue
    const start = Math.max(cut.from, at)
    text += line.slice(at, start)
    if (cut.place !== null && cut.place >= from && cut.place < to) text += KEY_MASK
    at = Math.max(at, Math.min(cut.to, to))
  }
  return text + line.slice(at, to)
}

function keptContext(line) {
  return line.length > CONTEXT_KEPT ? line.slice(-CONTEXT_KEPT) : line
}

function isSplitLog(frame) {
  const payload = frame?.payload
  return frame?.type === 'heartbeat.run.log' && payload !== null && typeof payload === 'object' && typeof payload.runId === 'string' && typeof payload.chunk === 'string'
}

function streamKeyOf(payload) {
  return `${payload.runId}\n${typeof payload.stream === 'string' ? payload.stream : ''}`
}

export function createSplitMasker({ holdMs = SPLIT_HOLD_MS } = {}) {
  const streams = new Map()
  const lastSeq = new Map()
  const queue = []
  let count = 0

  function maskFields(frame, fields) {
    const payload = frame?.payload
    if (!payload || typeof payload !== 'object') return frame
    let copy = null
    for (const field of fields) {
      if (typeof payload[field] !== 'string') continue
      const result = maskKeys(payload[field])
      if (result.count === 0) continue
      copy = copy ?? { ...payload }
      copy[field] = result.text
      count += result.count
    }
    return copy ? { ...frame, payload: copy } : frame
  }

  function finish(entry, chunk) {
    entry.frame = { ...entry.frame, payload: { ...entry.frame.payload, chunk } }
    entry.ready = true
  }

  function settle(state, line, pieces) {
    const base = state.context.length
    const cuts = lineCuts(line, base, state.keyEnded)
    let at = base
    for (const piece of pieces) {
      piece.text = cutText(line, at, at + piece.seg.length, cuts)
      at += piece.seg.length
    }
    count += cuts.filter((cut) => cut.place !== null).length
    return cuts
  }

  function releaseOpen(state, line, pieces) {
    const cuts = settle(state, line, pieces)
    for (const piece of pieces) {
      if (piece.item) finish(piece.item.entry, piece.item.done + piece.text)
    }
    state.held = []
    state.context = keptContext(line)
    state.keyEnded = cuts.some((cut) => cut.to === line.length)
  }

  function heldPieces(state) {
    return state.held.map((item) => ({ item, seg: item.seg }))
  }

  function heldLine(state) {
    return state.context + state.held.map((item) => item.seg).join('')
  }

  function releaseStream(state) {
    if (state.held.length === 0) return
    releaseOpen(state, heldLine(state), heldPieces(state))
  }

  function restartStream(state) {
    releaseStream(state)
    state.context = ''
    state.keyEnded = false
  }

  function restartRun(runId) {
    const prefix = `${runId}\n`
    for (const [key, state] of streams) {
      if (key.startsWith(prefix)) restartStream(state)
    }
  }

  function seqGap(payload) {
    if (typeof payload.seq !== 'number') return false
    const runId = payload.runId
    const gap = lastSeq.has(runId) && payload.seq !== lastSeq.get(runId) + 1
    lastSeq.delete(runId)
    lastSeq.set(runId, payload.seq)
    if (lastSeq.size > STREAMS_KEPT) lastSeq.delete(lastSeq.keys().next().value)
    return gap
  }

  function stateFor(key) {
    let state = streams.get(key)
    if (state) {
      streams.delete(key)
    } else {
      state = { context: '', keyEnded: false, held: [] }
    }
    streams.set(key, state)
    if (streams.size > STREAMS_KEPT) {
      for (const [oldKey, old] of streams) {
        if (streams.size <= STREAMS_KEPT) break
        if (old.held.length === 0) streams.delete(oldKey)
      }
    }
    return state
  }

  function pushLog(frame, now) {
    const masked = maskFields(frame, ['message', 'error'])
    const entry = { frame: masked, ready: false }
    if (seqGap(masked.payload)) restartRun(masked.payload.runId)
    queue.push(entry)
    const state = stateFor(streamKeyOf(masked.payload))
    if (masked.payload.truncated === true) restartStream(state)
    const parts = masked.payload.chunk.split(LINE_BREAK)
    const first = parts[0]
    const line = heldLine(state) + first
    const pieces = heldPieces(state)
    if (parts.length === 1) {
      const start = openKeyStart(line)
      if (start !== -1 && line.length - start <= KEY_LONGEST) {
        state.held.push({ entry, done: '', seg: first, since: now })
        return
      }
      releaseOpen(state, line, [...pieces, { item: { entry, done: '' }, seg: first }])
      return
    }
    const own = { seg: first }
    settle(state, line, [...pieces, own])
    for (const piece of pieces) finish(piece.item.entry, piece.item.done + piece.text)
    const middle = maskKeys(parts.slice(1, -1).join(''))
    count += middle.count
    const done = own.text + middle.text
    const last = parts[parts.length - 1]
    state.held = []
    state.context = ''
    state.keyEnded = false
    const start = openKeyStart(last)
    if (start !== -1 && last.length - start <= KEY_LONGEST) {
      state.held.push({ entry, done, seg: last, since: now })
      return
    }
    releaseOpen(state, last, [{ item: { entry, done }, seg: last }])
  }

  function endRun(runId) {
    const prefix = `${runId}\n`
    for (const [key, state] of streams) {
      if (!key.startsWith(prefix)) continue
      releaseStream(state)
      streams.delete(key)
    }
    lastSeq.delete(runId)
  }

  function drain() {
    const frames = []
    while (queue.length > 0 && queue[0].ready) frames.push(queue.shift().frame)
    const result = { frames, count }
    count = 0
    return result
  }

  return {
    push(frame, now = Date.now()) {
      if (!frame || typeof frame !== 'object') {
        queue.push({ frame, ready: true })
        return drain()
      }
      if (isSplitLog(frame)) {
        pushLog(frame, now)
        return drain()
      }
      if (frame.type === 'heartbeat.run.status' && RUN_ENDS.has(frame.payload?.status) && typeof frame.payload?.runId === 'string') {
        endRun(frame.payload.runId)
      }
      queue.push({ frame: maskFields(frame, ['chunk', 'message', 'error']), ready: true })
      return drain()
    },

    due(now = Date.now()) {
      for (const state of streams.values()) {
        if (state.held.length > 0 && now - state.held[0].since >= holdMs) releaseStream(state)
      }
      return drain()
    },

    nextDue() {
      let next = null
      for (const state of streams.values()) {
        if (state.held.length === 0) continue
        const at = state.held[0].since + holdMs
        if (next === null || at < next) next = at
      }
      return next
    },

    flush() {
      for (const state of streams.values()) releaseStream(state)
      return drain()
    },

    reset() {
      for (const state of streams.values()) releaseStream(state)
      streams.clear()
      lastSeq.clear()
      return drain()
    },

    holding() {
      return queue.filter((entry) => !entry.ready).length
    },
  }
}
