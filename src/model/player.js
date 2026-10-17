import { apply, createState } from './state.js'

export function createPlayer({ activities, tree, agents, idleCapMs = 4000, tailMs = 2500, onActivity = () => {}, onReset = () => {} }) {
  const stamps = []
  let virtual = 0
  let previous = activities[0]?.time ?? 0
  for (const activity of activities) {
    virtual += Math.min(Math.max(activity.time - previous, 0), idleCapMs)
    stamps.push(virtual)
    previous = activity.time
  }
  const duration = (stamps[stamps.length - 1] ?? 0) + tailMs

  let state = createState(tree, agents)
  let cursor = 0
  let position = 0
  let playing = false
  let speed = 1
  const listeners = new Set()

  function notify() {
    listeners.forEach((listener) => listener())
  }

  function advance(target) {
    position = Math.min(Math.max(target, 0), duration)
    while (cursor < activities.length && stamps[cursor] <= position) {
      apply(state, activities[cursor])
      onActivity(activities[cursor], state)
      cursor += 1
    }
    state.now = position
    if (position >= duration) playing = false
  }

  function seek(target) {
    state = createState(tree, agents)
    cursor = 0
    const goal = Math.min(Math.max(target, 0), duration)
    while (cursor < activities.length && stamps[cursor] <= goal) {
      apply(state, activities[cursor])
      cursor += 1
    }
    position = goal
    state.now = goal
    onReset(state)
    notify()
  }

  return {
    duration,
    stamps,
    get state() {
      return state
    },
    get position() {
      return position
    },
    get playing() {
      return playing
    },
    get speed() {
      return speed
    },
    play() {
      if (position >= duration) seek(0)
      playing = true
      notify()
    },
    pause() {
      playing = false
      notify()
    },
    toggle() {
      if (playing) this.pause()
      else this.play()
    },
    setSpeed(value) {
      speed = value
      notify()
    },
    seek,
    tick(deltaMs) {
      if (!playing) return
      advance(position + deltaMs * speed)
      if (!playing) notify()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    snapshot() {
      return {
        position,
        duration,
        playing,
        speed,
        agents: [...state.agents.values()].map((agent) => ({
          key: agent.key,
          name: agent.name,
          status: agent.status,
          label: agent.label,
          runs: agent.runs,
        })),
      }
    },
  }
}
