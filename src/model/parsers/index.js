import { harnessByAdapter, harnessByKey } from '../../harnesses/index.js'

export { createCodexParser } from './codex.js'
export { createCopilotParser } from './copilot.js'

export function createParser(agent, ctx) {
  const byName = Object.hasOwn(harnessByKey, agent.parser) ? harnessByKey[agent.parser] : null
  const byAdapter = Object.hasOwn(harnessByAdapter, agent.adapterType) ? harnessByAdapter[agent.adapterType] : null
  const descriptor = byName ?? (byAdapter?.parserByAdapter === false ? null : byAdapter)
  if (!descriptor) return { push: () => [], flush: () => [] }
  return descriptor.createParser(ctx)
}
