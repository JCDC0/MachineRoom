import { createOpencodeParser } from '../model/parsers/opencode.js'
import { expandBin, headLines, jsonLineReader, sumTokens } from './common.js'

function opencodeReply(log) {
  let words = null
  for (const line of String(log ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue
    let item
    try {
      item = JSON.parse(line)
    } catch {
      continue
    }
    if (item?.type !== 'text') continue
    const text = item?.part?.text
    if (typeof text !== 'string' || !text.trim()) continue
    words = text
  }
  return words ?? ''
}

function opencodeUsage(log) {
  let cost = null
  const inputs = []
  const outputs = []
  for (const line of String(log ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue
    let item
    try {
      item = JSON.parse(line)
    } catch {
      continue
    }
    if (item?.type !== 'step_finish') continue
    const stepCost = item?.part?.cost
    if (typeof stepCost === 'number' && Number.isFinite(stepCost)) cost = (cost ?? 0) + stepCost
    const tokens = item?.part?.tokens
    if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) continue
    const cache = tokens.cache && typeof tokens.cache === 'object' ? tokens.cache : {}
    inputs.push(tokens.input, cache.read, cache.write)
    outputs.push(tokens.output, tokens.reasoning)
  }
  return {
    costUsd: cost === null ? null : Math.round(cost * 1e6) / 1e6,
    inputTokens: sumTokens(inputs),
    outputTokens: sumTokens(outputs),
  }
}

export const opencodeHarness = {
  key: 'opencode',
  name: 'OpenCode',
  adapterType: 'opencode_local',
  createParser: createOpencodeParser,
  command({ cli, prompt, env = {}, folder, title, reasoning, mcpConfig } = {}) {
    const model = reasoning ? `${cli.model}#${reasoning}` : cli.model
    const result = { file: expandBin(cli.bin, env), args: ['run', '--format', 'json', '--model', model, '--auto', '--title', title, prompt], cwd: folder }
    if (typeof mcpConfig === 'string' && mcpConfig.trim() !== '') {
      result.env = { OPENCODE_CONFIG: mcpConfig.trim() }
    }
    return result
  },
  readLine() {
    return jsonLineReader(createOpencodeParser)
  },
  report(log) {
    return headLines(opencodeReply(log))
  },
  reply(log) {
    return opencodeReply(log)
  },
  usage(log) {
    return opencodeUsage(log)
  },
}
