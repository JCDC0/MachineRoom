import { createClaudeSessionsReader } from './claude-sessions.js'
import { runsFolder as defaultRunsFolder } from './lanes-source.js'

const DEFAULT_POLL_MS = 1000

export function createSessionsSource(options = {}) {
  const projectRoot = options.projectRoot
  const runsFolder = options.runsFolder ?? defaultRunsFolder()
  const now = options.now ?? Date.now
  const onFrame = options.onFrame ?? (() => {})
  const pollMs = Number(options.pollMs ?? DEFAULT_POLL_MS)
  const makers = Array.isArray(options.readers) && options.readers.length > 0 ? options.readers : [createClaudeSessionsReader]
  const shared = { projectRoot, runsFolder, now, emit: onFrame }
  if (options.home !== undefined) shared.home = options.home
  if (options.quietMs !== undefined) shared.quietMs = options.quietMs
  const readers = makers
    .map((make) => (typeof make === 'function' ? make({ ...shared }) : make))
    .filter(Boolean)
  const agents = readers.flatMap((reader) => (Array.isArray(reader.agents) ? reader.agents : reader.agent ? [reader.agent] : []))
  let timer = null
  let ticking = false
  let stopped = false

  function tick() {
    if (stopped || ticking) return
    ticking = true
    try {
      for (const reader of readers) {
        try {
          reader.tick()
        } catch {}
      }
    } finally {
      ticking = false
    }
  }

  function start() {
    if (stopped || timer) return
    tick()
    timer = setInterval(tick, pollMs)
  }

  function stop() {
    stopped = true
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    for (const reader of readers) {
      try {
        reader.stop?.()
      } catch {}
    }
  }

  return { agents, readers, start, stop, tick }
}
