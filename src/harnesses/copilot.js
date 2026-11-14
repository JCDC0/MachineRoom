import { createCopilotParser } from '../model/parsers/copilot.js'
import { expandBin, headLines, jsonLineReader, lastJsonLine, lastPlainBlock, sumTokens, terminalText, tokenCount } from './common.js'

function copilotReply(log) {
  let text = null
  for (const line of String(log ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue
    let item
    try {
      item = JSON.parse(line)
    } catch {
      continue
    }
    const content = item?.data?.content ?? item?.content ?? item?.text ?? item?.message
    if (typeof content === 'string' && content.trim()) text = content
  }
  if (text) return terminalText(text)
  return lastPlainBlock(log, createCopilotParser)
}

function copilotUsage(log) {
  const line = lastJsonLine(log, (item) => item?.usage || item?.tokens)
  const usage = line?.usage ?? line?.tokens
  if (!usage || typeof usage !== 'object') return { costUsd: null, inputTokens: null, outputTokens: null }
  return {
    costUsd: null,
    inputTokens: sumTokens([usage.input_tokens, usage.inputTokens, usage.prompt_tokens]),
    outputTokens: tokenCount(usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens),
  }
}

export const copilotHarness = {
  key: 'copilot',
  name: 'GitHub Copilot',
  laneName: 'GitHub Copilot',
  defaultProgram: 'copilot',
  adapterType: 'copilot_local',
  commitAuthor: { label: 'GitHub Copilot', address: 'noreply@github.com' },
  createParser: createCopilotParser,
  command({ cli, prompt, env = {}, folder, reasoning } = {}) {
    const args = ['-p', prompt, '--allow-all-tools']
    if (cli?.model) args.push('--model', String(cli.model))
    const effort = reasoning ?? cli?.effort
    if (effort) args.push('--effort', String(effort))
    args.push('--output-format', 'json')
    return { file: expandBin(cli?.bin ?? 'copilot', env), args, cwd: folder }
  },
  readLine() {
    return jsonLineReader(createCopilotParser)
  },
  report(log) {
    return headLines(copilotReply(log))
  },
  reply(log) {
    return copilotReply(log)
  },
  usage(log) {
    return copilotUsage(log)
  },
}
