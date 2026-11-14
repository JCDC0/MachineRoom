import { createAgyParser } from '../model/parsers/agy.js'
import { expandBin, headLines, jsonLineReader, lastJsonLine, terminalText, tokenCount } from './common.js'

function agyReply(log) {
  let words = null
  for (const line of String(log ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue
    let item
    try {
      item = JSON.parse(line)
    } catch {
      continue
    }
    if (item?.event !== 'result') continue
    const text = item?.result?.response
    if (typeof text !== 'string' || !text.trim()) continue
    words = text
  }
  return terminalText(words ?? '')
}

function agyErrors(log) {
  const texts = []
  for (const line of String(log ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue
    let item
    try {
      item = JSON.parse(line)
    } catch {
      if (/^(?:ERROR|Error|error)\b/.test(line.trim())) texts.push(line.trim())
      continue
    }
    if (item?.event === 'error' || item?.type === 'error') {
      texts.push([item.message, item.error?.message, typeof item.error === 'string' ? item.error : '', item.error?.type, item.error?.code, item.code].filter((text) => typeof text === 'string' && text.trim() !== '').join(' '))
      continue
    }
    if (item?.event === 'result' && item.result?.error) {
      const error = item.result.error
      texts.push([typeof error === 'string' ? error : error?.message, error?.type, error?.code].filter((text) => typeof text === 'string' && text.trim() !== '').join(' '))
    }
  }
  return texts.filter((text) => text.trim() !== '')
}

function agyLimited(log) {
  const text = agyErrors(log).join('\n')
  if (!text) return ''
  if (/RESOURCE_EXHAUSTED|quota/i.test(text)) return 'quota'
  if (/\b503\b|UNAVAILABLE|overloaded/i.test(text)) return 'overloaded'
  if (/rate[_ -]?limit(?:ed|_error)?|\b429\b/i.test(text)) return 'rate-limit'
  return ''
}

function agyUsage(log) {
  const line = lastJsonLine(log, (item) => item?.event === 'result')
  const usage = line?.result?.usage
  const inputTokens = tokenCount(usage?.input_tokens)
  const output = tokenCount(usage?.output_tokens)
  const thinking = tokenCount(usage?.thinking_tokens)
  const outputTokens = output === null && thinking === null ? null : (output ?? 0) + (thinking ?? 0)
  return { costUsd: null, inputTokens, outputTokens }
}

export const agyHarness = {
  key: 'agy',
  name: 'AGY',
  laneName: 'agy',
  defaultProgram: '%LOCALAPPDATA%\\agy\\bin\\agy.exe',
  adapterType: 'process',
  commitAuthor: { label: 'AGY', address: 'noreply@google.com' },
  parserByAdapter: false,
  createParser: createAgyParser,
  command({ cli, prompt, env = {}, folder, mode } = {}) {
    const args = ['--print', prompt, '--output-format', 'stream-json']
    if (cli.model) args.push('--model', String(cli.model))
    if (mode === 'plan') args.push('--mode', 'plan')
    else if (mode === 'edits') args.push('--mode', 'accept-edits')
    else if (mode === 'auto') args.push('--mode', 'auto')
    else args.push('--dangerously-skip-permissions')
    return { file: expandBin(cli.bin, env), args, cwd: folder }
  },
  readLine() {
    return jsonLineReader(createAgyParser)
  },
  report(log) {
    return headLines(agyReply(log))
  },
  reply(log) {
    return agyReply(log)
  },
  limited(log) {
    return agyLimited(log)
  },
  usage(log) {
    return agyUsage(log)
  },
}
