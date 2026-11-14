import { createOpencodeParser } from '../model/parsers/opencode.js'
import { expandBin, headLines, jsonLineReader, sumTokens, terminalText } from './common.js'

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
  return terminalText(words ?? '')
}

function opencodeErrors(log) {
  const errors = []
  for (const line of String(log ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue
    let item
    try {
      item = JSON.parse(line)
    } catch {
      continue
    }
    if (item?.type !== 'error') continue
    const message =
      typeof item.error?.message === 'string' && item.error.message.trim()
        ? item.error.message.trim()
        : typeof item.error === 'string' && item.error.trim()
          ? item.error.trim()
          : typeof item.message === 'string' && item.message.trim()
            ? item.message.trim()
            : ''
    const type = typeof item.error?.type === 'string' ? item.error.type.trim() : ''
    if (message !== '' || type !== '') errors.push({ message, text: [type, message].filter(Boolean).join(' ') })
  }
  return errors
}

function opencodeFailure(log) {
  const errors = opencodeErrors(log)
  for (let index = errors.length - 1; index >= 0; index -= 1) {
    if (errors[index].message !== '') return errors[index].message
  }
  return null
}

function opencodeLimited(log) {
  const text = opencodeErrors(log).map((error) => error.text).join('\n')
  if (!text) return ''
  if (/insufficient balance|quota|usage limit/i.test(text)) return 'quota'
  if (/rate[_ -]?limit(?:ed|_error)?|\b429\b/i.test(text)) return 'rate-limit'
  if (/overloaded|\b503\b|\b529\b/i.test(text)) return 'overloaded'
  return ''
}

function opencodeUsage(log) {
  let cost = null
  let peakTokens = null
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
    const stepTokens = sumTokens([tokens.input, cache.read, cache.write])
    if (stepTokens !== null) {
      peakTokens = peakTokens === null ? stepTokens : Math.max(peakTokens, stepTokens)
    }
    inputs.push(tokens.input, cache.read, cache.write)
    outputs.push(tokens.output, tokens.reasoning)
  }
  return {
    costUsd: cost === null ? null : Math.round(cost * 1e6) / 1e6,
    inputTokens: sumTokens(inputs),
    outputTokens: sumTokens(outputs),
    peakTokens,
  }
}

export const opencodeHarness = {
  key: 'opencode',
  name: 'OpenCode',
  laneName: 'OpenCode',
  defaultProgram: '%APPDATA%\\npm\\node_modules\\@opencode\\cli\\bin\\opencode.exe',
  adapterType: 'opencode_local',
  commitAuthor: { label: 'OpenCode', address: 'noreply@opencode.ai' },
  createParser: createOpencodeParser,
  command({ cli, prompt, env = {}, folder, title, reasoning, mcpConfig } = {}) {
    const model = reasoning ? `${cli.model}#${reasoning}` : cli.model
    const result = { file: expandBin(cli.bin, env), args: ['run', '--standalone', '--format', 'json', '--model', model, '--auto', '--title', title, prompt], cwd: folder }
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
  failure(log) {
    return opencodeFailure(log)
  },
  limited(log) {
    return opencodeLimited(log)
  },
  usage(log) {
    return opencodeUsage(log)
  },
}
