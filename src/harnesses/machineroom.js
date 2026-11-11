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
  command({ cli, prompt = '', folder, mode, bridgeUrl, orchestratorId, token, reasoning } = {}) {
    const cwd = typeof folder === 'string' && folder !== '' ? folder : '.'
    const env = {}
    if (typeof mode === 'string' && mode !== '') env.MACHINEROOM_PERMISSION_MODE = mode
    if (mode === 'ask') {
      if (typeof bridgeUrl === 'string' && bridgeUrl !== '') env.MACHINEROOM_BRIDGE = bridgeUrl
      if (typeof orchestratorId === 'string' && orchestratorId !== '') env.MACHINEROOM_ORCHESTRATOR_ID = orchestratorId
      if (typeof token === 'string' && token !== '') env.MACHINEROOM_ORCHESTRATOR_TOKEN = token
    }
    const args = [scriptFile(), '--model', String(cli?.model ?? ''), '--cwd', cwd]
    if (typeof reasoning === 'string' && reasoning !== '') args.push('--reasoning', reasoning)
    args.push(String(prompt))
    return {
      file: nodeFile(),
      args,
      cwd,
      ...(Object.keys(env).length > 0 ? { env } : {}),
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
