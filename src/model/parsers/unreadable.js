import { parseJson } from './common.js'
import { LINE as HERMES_LINE } from './hermes.js'
import { recoverCall } from './opencode.js'

const HERMES_START = /^\s*┊/u
const OPENCODE_TOOL_USE = /"type"\s*:\s*"tool_use"/

const CHECKS = {
  hermes(line) {
    return HERMES_START.test(line) && !HERMES_LINE.test(line)
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
