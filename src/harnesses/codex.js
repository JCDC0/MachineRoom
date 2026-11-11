import { createCodexParser } from '../model/parsers/codex.js'
import { expandBin, headLines, jsonLineReader, lastJsonLine, sumTokens, tokenCount } from './common.js'

function codexReply(log) {
  let text = null
  for (const line of String(log ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue
    let item
    try {
      item = JSON.parse(line)
    } catch {
      continue
    }
    const msg = item?.item?.type === 'agent_message' ? item.item : (item?.type === 'agent_message' ? item : null)
    if (!msg) continue
    const content = typeof msg.text === 'string' ? msg.text : (typeof msg.content === 'string' ? msg.content : (typeof msg.message === 'string' ? msg.message : ''))
    if (content.trim()) text = content
  }
  return text ?? ''
}

function codexUsage(log) {
  const line = lastJsonLine(log, (item) => item?.type === 'turn.completed' && item?.usage) ?? lastJsonLine(log, (item) => item?.usage)
  const usage = line?.usage
  if (!usage || typeof usage !== 'object') return { costUsd: null, inputTokens: null, outputTokens: null }
  return {
    costUsd: null,
    inputTokens: sumTokens([usage.input_tokens, usage.cached_input_tokens]),
    outputTokens: tokenCount(usage.output_tokens),
  }
}

export const codexHarness = {
  key: 'codex',
  name: 'Codex',
  laneName: 'Codex',
  defaultProgram: 'codex',
  adapterType: 'codex_local',
  createParser: createCodexParser,
  command({ cli, prompt, env = {}, folder, reasoning } = {}) {
    const effort = reasoning ?? cli?.effort
    const args = ['exec', '--json']
    if (cli?.model) args.push('--model', String(cli.model))
    args.push('--sandbox', 'workspace-write', '--skip-git-repo-check')
    if (effort) args.push('-c', `model_reasoning_effort=${effort}`)
    args.push(prompt)
    return { file: expandBin(cli?.bin ?? 'codex', env), args, cwd: folder }
  },
  readLine() {
    return jsonLineReader(createCodexParser)
  },
  report(log) {
    return headLines(codexReply(log))
  },
  reply(log) {
    return codexReply(log)
  },
  usage(log) {
    return codexUsage(log)
  },
}
