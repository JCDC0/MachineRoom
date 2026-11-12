import { createClaudeParser } from '../model/parsers/claude.js'
import { expandBin, finiteNumber, headLines, jsonLineReader, lastJsonLine, sumTokens, terminalText, tokenCount } from './common.js'

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
    if (item.is_error) continue
    const text = item.result
    if (typeof text !== 'string' || !text.trim()) continue
    words = text
  }
  return terminalText(words ?? '')
}

function claudeFailure(log) {
  let failure = null
  for (const line of String(log ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue
    let item
    try {
      item = JSON.parse(line)
    } catch {
      continue
    }
    if (item?.type !== 'result' || item.parent_tool_use_id) continue
    if (!item.is_error) continue
    const message =
      typeof item.result === 'string' && item.result.trim()
        ? item.result.trim()
        : typeof item.error?.message === 'string' && item.error.message.trim()
          ? item.error.message.trim()
          : typeof item.error === 'string' && item.error.trim()
            ? item.error.trim()
            : null
    if (message) failure = message
  }
  return failure
}

function claudeUsage(log) {
  let peakTokens = null
  for (const line of String(log ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue
    let item
    try {
      item = JSON.parse(line)
    } catch {
      continue
    }
    if (item?.type !== 'assistant' || item.parent_tool_use_id) continue
    const usage =
      item.message?.usage && typeof item.message.usage === 'object' && !Array.isArray(item.message.usage)
        ? item.message.usage
        : item.usage && typeof item.usage === 'object' && !Array.isArray(item.usage)
          ? item.usage
          : null
    if (!usage) continue
    const stepTokens = sumTokens([
      usage.input_tokens ?? usage.inputTokens,
      usage.cache_creation_input_tokens ?? usage.cacheCreationInputTokens,
      usage.cache_read_input_tokens ?? usage.cacheReadInputTokens,
    ])
    if (stepTokens !== null) {
      peakTokens = peakTokens === null ? stepTokens : Math.max(peakTokens, stepTokens)
    }
  }

  const line = lastJsonLine(log, (item) => item?.type === 'result')
  if (!line) return { costUsd: null, inputTokens: null, outputTokens: null, peakTokens }
  const models = line.modelUsage && typeof line.modelUsage === 'object' ? Object.values(line.modelUsage).filter((item) => item && typeof item === 'object') : []
  if (models.length > 0) {
    return {
      costUsd: finiteNumber(line.total_cost_usd),
      inputTokens: sumTokens(models.flatMap((item) => [item.inputTokens, item.cacheCreationInputTokens, item.cacheReadInputTokens])),
      outputTokens: sumTokens(models.map((item) => item.outputTokens)),
      peakTokens,
    }
  }
  const usage = line.usage && typeof line.usage === 'object' ? line.usage : {}
  return {
    costUsd: finiteNumber(line.total_cost_usd),
    inputTokens: sumTokens([usage.input_tokens, usage.cache_creation_input_tokens, usage.cache_read_input_tokens]),
    outputTokens: tokenCount(usage.output_tokens),
    peakTokens,
  }
}

export const claudeHarness = {
  key: 'claude',
  name: 'Claude Code',
  laneName: 'Claude Code',
  defaultProgram: 'claude',
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
  failure(log) {
    return claudeFailure(log)
  },
  usage(log) {
    return claudeUsage(log)
  },
}
