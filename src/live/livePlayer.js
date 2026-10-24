import { ancestors } from '../model/paths.js'
import { apply, createState } from '../model/state.js'

export function createLivePlayer({ tree, agents, onActivity = () => {} }) {
  const state = createState(tree, agents)
  const started = performance.now()
  const listeners = new Set()
  let status = 'connecting'

  function notify() {
    listeners.forEach((listener) => listener())
  }

  function elapsed() {
    return performance.now() - started
  }

  function addFiles(paths) {
    for (const path of paths) {
      if (state.files.has(path)) continue
      state.files.set(path, { path, exists: true, reads: 0, writes: 0, failed: false, yellow: false })
      for (const dir of ancestors(path)) if (!state.dirs.has(dir)) state.dirs.set(dir, { path: dir, opened: false })
    }
  }

  return {
    live: true,
    get state() {
      return state
    },
    get position() {
      return elapsed()
    },
    get duration() {
      return elapsed()
    },
    get playing() {
      return true
    },
    get speed() {
      return 1
    },
    play() {},
    pause() {},
    toggle() {},
    setSpeed() {},
    seek() {},
    tick() {},
    push(activities) {
      if (activities.length === 0) return
      for (const activity of activities) {
        apply(state, activity)
        onActivity(activity, state)
      }
      state.now = elapsed()
      notify()
    },
    addFiles(paths) {
      addFiles(paths)
      notify()
    },
    setStatus(next) {
      status = next
      notify()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    snapshot() {
      const now = elapsed()
      return {
        position: now,
        duration: now,
        playing: true,
        speed: 1,
        live: true,
        status,
        agents: [...state.agents.values()].map((agent) => ({
          key: agent.key,
          name: agent.name,
          id: agent.id ?? null,
          harness: agent.harness ?? null,
          model: agent.model ?? null,
          status: agent.status,
          label: agent.label,
          runs: agent.runs,
          parent: agent.parent ?? null,
          depth: agent.depth ?? 0,
        })),
      }
    },
  }
}
