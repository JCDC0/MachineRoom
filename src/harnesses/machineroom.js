import { createClaudeParser } from '../model/parsers/claude.js'
import { finiteNumber, headLines, jsonLineReader, lastJsonLine, tokenCount } from './common.js'

function resultLine(log) {
  return lastJsonLine(log, (item) => item?.type === 'result' && !item.parent_tool_use_id)
}

function machineroomReply(log) {
  const text = resultLine(log)?.result
  return typeof text === 'string' ? text : ''
}

function machineroomUsage(log) {
  const line = resultLine(log)
  if (!line) return { costUsd: null, inputTokens: null, outputTokens: null }
  const usage = line.usage && typeof line.usage === 'object' ? line.usage : {}
  return {
    costUsd: finiteNumber(line.total_cost_usd),
    inputTokens: tokenCount(usage.input_tokens),
    outputTokens: tokenCount(usage.output_tokens),
  }
}

function scriptFile() {
  const url = new URL(['..', '..', 'scripts', 'mr-agent.mjs'].join('/'), import.meta.url)
  if (url.protocol !== 'file:') return 'scripts/mr-agent.mjs'
  const path = decodeURIComponent(url.pathname)
  return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path
}

function nodeFile() {
  return typeof process !== 'undefined' && typeof process.execPath === 'string' ? process.execPath : 'node'
}

export const machineroomHarness = {
  key: 'machineroom',
  name: 'MachineRoom',
  adapterType: 'machineroom_local',
  createParser: createClaudeParser,
  command({ cli, prompt = '', folder, mode } = {}) {
    const cwd = typeof folder === 'string' && folder !== '' ? folder : '.'
    return {
      file: nodeFile(),
      args: [scriptFile(), '--model', String(cli?.model ?? ''), '--cwd', cwd, String(prompt)],
      cwd,
      ...(typeof mode === 'string' && mode !== '' ? { env: { MACHINEROOM_PERMISSION_MODE: mode } } : {}),
    }
  },
  readLine() {
    return jsonLineReader(createClaudeParser)
  },
  report(log) {
    return headLines(machineroomReply(log))
  },
  reply(log) {
    return machineroomReply(log)
  },
  usage(log) {
    return machineroomUsage(log)
  },
}
