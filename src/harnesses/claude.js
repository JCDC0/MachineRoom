import { createClaudeParser } from '../model/parsers/claude.js'
import { expandBin, finiteNumber, headLines, jsonLineReader, lastJsonLine, sumTokens, tokenCount } from './common.js'

function claudeReply(log) {
  let words = null
  for (const line of String(log ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue
    let item
    try {
      item = JSON.parse(line)
    } catch {
      continue
    }
    if (item?.type !== 'result' || item.parent_tool_use_id) continue
    const text = item.result
    if (typeof text !== 'string' || !text.trim()) continue
    words = text
  }
  return words ?? ''
}

function claudeUsage(log) {
  const line = lastJsonLine(log, (item) => item?.type === 'result')
  if (!line) return { costUsd: null, inputTokens: null, outputTokens: null }
  const models = line.modelUsage && typeof line.modelUsage === 'object' ? Object.values(line.modelUsage).filter((item) => item && typeof item === 'object') : []
  if (models.length > 0) {
    return {
      costUsd: finiteNumber(line.total_cost_usd),
      inputTokens: sumTokens(models.flatMap((item) => [item.inputTokens, item.cacheCreationInputTokens, item.cacheReadInputTokens])),
      outputTokens: sumTokens(models.map((item) => item.outputTokens)),
    }
  }
  const usage = line.usage && typeof line.usage === 'object' ? line.usage : {}
  return {
    costUsd: finiteNumber(line.total_cost_usd),
    inputTokens: sumTokens([usage.input_tokens, usage.cache_creation_input_tokens, usage.cache_read_input_tokens]),
    outputTokens: tokenCount(usage.output_tokens),
  }
}

export const claudeHarness = {
  key: 'claude',
  name: 'Claude Code',
  adapterType: 'claude_local',
  createParser: createClaudeParser,
  command({ cli, prompt, env = {}, folder, sessionId, mcpConfig } = {}) {
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--model', cli.model, '--dangerously-skip-permissions']
    if (typeof mcpConfig === 'string' && mcpConfig.trim() !== '') args.push('--mcp-config', mcpConfig.trim())
    if (typeof sessionId === 'string' && sessionId !== '') args.push('--session-id', sessionId)
    return { file: expandBin(cli.bin, env), args, cwd: folder }
  },
  readLine() {
    return jsonLineReader(createClaudeParser)
  },
  report(log) {
    return headLines(claudeReply(log))
  },
  reply(log) {
    return claudeReply(log)
  },
  usage(log) {
    return claudeUsage(log)
  },
}
