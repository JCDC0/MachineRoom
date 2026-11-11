import { createAgyParser } from '../model/parsers/agy.js'
import { expandBin, headLines, jsonLineReader, lastJsonLine, tokenCount } from './common.js'

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
  return words ?? ''
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
  usage(log) {
    return agyUsage(log)
  },
}
