import { LINE as HERMES_LINE, createHermesParser } from '../model/parsers/hermes.js'
import { expandBin, headLines } from './common.js'

function hermesReply(log) {
  const lines = String(log ?? '').split(/\r?\n/)
  const firstTool = lines.findIndex((line) => line.trimStart().startsWith('┊'))
  return (firstTool === -1 ? lines : lines.slice(0, firstTool)).join('\n').replace(/\s+$/, '')
}

export const hermesHarness = {
  key: 'hermes',
  name: 'Hermes',
  laneName: 'Hermes',
  defaultProgram: '%LOCALAPPDATA%\\hermes\\bin\\hermes.exe',
  adapterType: 'hermes_local',
  createParser: createHermesParser,
  command({ cli, prompt, env = {}, folder, usageFile, reasoning } = {}) {
    const args = ['-z', prompt, '-m', cli.model, '--provider', cli.provider]
    if (cli.toolsets) args.push('-t', String(cli.toolsets))
    if (reasoning) args.push('--reasoning', String(reasoning))
    if (usageFile) args.push('--usage-file', usageFile)
    return { file: expandBin(cli.bin, env), args, cwd: folder }
  },
  readLine() {
    return function readLine(line, at = null) {
      const text = String(line ?? '')
      if (!text.trim()) return null
      return { chunk: `${text}\n`, at: Number.isFinite(at) ? at : null, read: HERMES_LINE.test(text) }
    }
  },
  report(log) {
    return headLines(hermesReply(log))
  },
  reply(log) {
    return hermesReply(log)
  },
  usage() {
    return { costUsd: null, inputTokens: null, outputTokens: null }
  },
}
