import { parseJson } from './common.js'
import { LINE as HERMES_LINE } from './hermes.js'
import { recoverCall } from './opencode.js'

const HERMES_START = /^\s*┊/u
const HERMES_PROGRESS = [/^\s*┊\s+\S+\s+preparing\s+\S+/u, /^\s*┊\s+review diff\s*$/u]
const OPENCODE_TOOL_USE = /"type"\s*:\s*"tool_use"/

const CHECKS = {
  hermes(line) {
    if (!HERMES_START.test(line) || HERMES_LINE.test(line)) return false
    return !HERMES_PROGRESS.some((pattern) => pattern.test(line))
  },
  claude(line) {
    if (!line.includes('acpx.tool_call')) return false
    const json = parseJson(line)
    return !json || json.type !== 'acpx.tool_call' || !json.toolCallId
  },
  opencode(line) {
    if (!OPENCODE_TOOL_USE.test(line)) return false
    const json = parseJson(line)
    if (json?.part?.tool) return false
    return !recoverCall(line)
  },
  agy(line) {
    if (!line.includes('step_update')) return false
    const json = parseJson(line)
    return !json || json.event !== 'step_update'
  },
}

export function unreadableLines(parser, text) {
  if (!Object.hasOwn(CHECKS, parser)) return []
  const check = CHECKS[parser]
  return String(text ?? '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '' && check(line))
}

const PARSERS = ['claude', 'hermes', 'opencode', 'agy']
const MAX_RUNS = 50
const DEFAULT_TAIL_LIMIT = 65536

export function createUnreadableCounter({ tailLimit = DEFAULT_TAIL_LIMIT } = {}) {
  const limit = Number.isFinite(tailLimit) ? Math.max(0, Math.floor(tailLimit)) : DEFAULT_TAIL_LIMIT
  const tails = new Map()
  const tallies = { claude: 0, hermes: 0, opencode: 0, agy: 0 }
  let total = 0

  function add(parser, lines) {
    if (lines.length === 0) return
    tallies[parser] += lines.length
    total += lines.length
  }

  function keep(key, parser, text) {
    if (text === '' || text.length > limit) {
      tails.delete(key)
      return
    }
    const known = tails.has(key)
    tails.set(key, { parser, text })
    if (!known && tails.size > MAX_RUNS) tails.delete(tails.keys().next().value)
  }

  function push(parser, runId, chunk) {
    const key = String(runId ?? '')
    if (!PARSERS.includes(parser)) {
      tails.delete(key)
      return
    }
    const held = tails.get(key)
    const text = (held?.text ?? '') + String(chunk ?? '')
    const cut = text.lastIndexOf('\n')
    if (cut === -1) {
      keep(key, parser, text)
      return
    }
    add(parser, unreadableLines(parser, text.slice(0, cut + 1)))
    keep(key, parser, text.slice(cut + 1))
  }

  function end(runId) {
    const key = String(runId ?? '')
    const held = tails.get(key)
    tails.delete(key)
    if (!held) return
    add(held.parser, unreadableLines(held.parser, held.text))
  }

  function counts() {
    return { total, byParser: { ...tallies } }
  }

  function reset() {
    tails.clear()
    total = 0
    for (const parser of PARSERS) tallies[parser] = 0
  }

  return { push, end, counts, reset }
}
