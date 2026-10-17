import { createAgyParser } from './agy.js'
import { createClaudeParser } from './claude.js'
import { createHermesParser } from './hermes.js'
import { createOpencodeParser } from './opencode.js'

const BY_ADAPTER = {
  claude_local: createClaudeParser,
  hermes_local: createHermesParser,
  opencode_local: createOpencodeParser,
}

const BY_NAME = {
  claude: createClaudeParser,
  hermes: createHermesParser,
  opencode: createOpencodeParser,
  agy: createAgyParser,
}

export function createParser(agent, ctx) {
  const factory = BY_NAME[agent.parser] ?? BY_ADAPTER[agent.adapterType]
  if (!factory) return { push: () => [], flush: () => [] }
  return factory(ctx)
}
