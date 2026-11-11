import { ancestors } from '../model/paths.js'
import { apply, createState } from '../model/state.js'

export function createLivePlayer({ tree, agents, onActivity = () => {} }) {
  const state = createState(tree, agents)
  const started = performance.now()
  const listeners = new Set()
  const pendingRemovals = new Set()
  let status = 'connecting'

  function notify() {
    listeners.forEach((listener) => listener())
  }

  function elapsed() {
    return performance.now() - started
  }

  function addFile(path) {
    if (state.files.has(path)) return
    state.files.set(path, { path, exists: true, reads: 0, writes: 0, failed: false, yellow: false })
    for (const dir of ancestors(path)) if (!state.dirs.has(dir)) state.dirs.set(dir, { path: dir, opened: false })
  }

  function addFiles(paths) {
    for (const path of paths) addFile(path)
  }

  function heldByWorkingAgent(path) {
    for (const agent of state.agents.values()) {
      if (agent.status !== 'working') continue
      if (agent.runWrites?.has(path) || agent.focus?.includes(path)) return true
      for (const touches of agent.calls?.values() ?? []) {
        for (const touch of touches) if (touch.kind === 'file' && touch.path === path) return true
      }
    }
    return false
  }

  function pruneDirs(folders) {
    if (folders.size === 0) return
    const used = new Set()
    for (const path of state.files.keys()) {
      let at = path.lastIndexOf('/')
      while (at > 0) {
        const folder = path.slice(0, at)
        if (folders.has(folder)) used.add(folder)
        at = folder.lastIndexOf('/')
      }
    }
    for (const folder of folders) if (!used.has(folder)) state.dirs.delete(folder)
  }

  function dropFile(path, folders) {
    const file = state.files.get(path)
    if (!file) return false
    state.files.delete(path)
    if (!file.exists) state.missingFiles -= 1
    for (const folder of ancestors(path)) if (folder !== '') folders.add(folder)
    state.fileVersion = (state.fileVersion ?? 0) + 1
    return true
  }

  function removeFiles(paths) {
    const folders = new Set()
    let changed = false
    for (const path of paths) {
      if (typeof path !== 'string') continue
      if (heldByWorkingAgent(path)) {
        pendingRemovals.add(path)
        continue
      }
      pendingRemovals.delete(path)
      if (dropFile(path, folders)) changed = true
    }
    if (changed) pruneDirs(folders)
    return changed
  }

  function flushRemovals() {
    const folders = new Set()
    let changed = false
    for (const path of [...pendingRemovals]) {
      if (heldByWorkingAgent(path)) continue
      pendingRemovals.delete(path)
      if (dropFile(path, folders)) changed = true
    }
    if (changed) pruneDirs(folders)
    return changed
  }

  function replaceFiles(paths) {
    addFiles(paths)
    const keep = new Set(paths)
    const gone = []
    for (const path of state.files.keys()) if (!keep.has(path)) gone.push(path)
    removeFiles(gone)
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
      flushRemovals()
      notify()
    },
    addFiles(paths) {
      addFiles(paths)
      notify()
    },
    removeFiles(paths) {
      removeFiles(paths)
      notify()
    },
    replaceFiles(paths) {
      replaceFiles(paths)
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
