import { describe, expect, it } from 'vitest'
import { apply, createState } from '../src/model/state.js'
import { loadScenario } from './helpers.js'

describe('an agy run with a child conversation', () => {
  const { agents, tree, activities } = loadScenario('scenario-f')

  it('spawns the child before its first tool call and credits its calls to it', () => {
    const spawnAt = activities.findIndex((activity) => activity.type === 'agent.spawn')
    const spawn = activities[spawnAt]
    expect(spawn).toMatchObject({ agent: 'agy', child: 'agy~1', name: 'Checker' })
    const firstChild = activities.findIndex((activity) => activity.agent === 'agy~1')
    expect(spawnAt).toBeLessThan(firstChild)

    const starts = activities.filter((activity) => activity.type === 'tool.start' && (activity.agent === 'agy' || activity.agent === 'agy~1'))
    expect(starts.map((activity) => activity.agent)).toEqual(['agy', 'agy~1', 'agy', 'agy~1', 'agy', 'agy'])
    expect(starts.filter((activity) => activity.agent === 'agy~1').map((activity) => activity.label)).toEqual([
      'read docs/notes.md',
      'write docs/child-summary.md',
    ])
  })

  it('ends the child once, before the parent run ends', () => {
    const ends = activities.filter((activity) => activity.type === 'agent.end' && activity.agent === 'agy~1')
    const runEnd = activities.find((activity) => activity.type === 'run.end' && activity.agent === 'agy')
    expect(ends).toHaveLength(1)
    expect(ends[0]).toMatchObject({ ok: true })
    expect(ends[0].time).toBeLessThan(runEnd.time)
  })

  it('keeps the child working beside its parent with its own focus', () => {
    const state = createState(tree, agents)
    let together = null
    for (const activity of activities) {
      apply(state, activity)
      const parent = state.agents.get('agy')
      const child = state.agents.get('agy~1')
      if (!together && parent?.status === 'working' && child?.status === 'working' && child.focus.length > 0) {
        together = { parentFocus: [...parent.focus], childFocus: [...child.focus] }
      }
    }
    expect(together).not.toBeNull()
    expect(together.parentFocus).toEqual(['src/math.js'])
    expect(together.childFocus).toEqual(['docs/notes.md'])
    expect(state.agents.get('agy~1')).toMatchObject({ status: 'done', parent: 'agy', depth: 1 })
    expect(state.agents.get('agy')).toMatchObject({ status: 'done', runs: 1 })
  })
})

describe('a real agy run with a subagent', () => {
  const { agents, tree, activities } = loadScenario('scenario-g')
  const starts = activities.filter((activity) => activity.type === 'tool.start')

  it('reads and writes with the file tools this agy names', () => {
    const reads = starts.filter((activity) => activity.tool === 'read').map((activity) => activity.touches[0].path)
    expect(reads.slice(0, 2)).toEqual(['src/strings.js', 'test/strings.test.js'])
    const writes = starts.filter((activity) => activity.touches.some((touch) => touch.mode === 'write'))
    expect(writes.map((activity) => activity.touches[0].path)).toEqual(['docs/main-notes.md', 'docs/main-notes.md'])
    expect(writes.map((activity) => activity.label)).toEqual(['write docs/main-notes.md', 'edit docs/main-notes.md'])
  })

  it('spawns the subagent before the first read and ends it at the first idle', () => {
    const spawnAt = activities.findIndex((activity) => activity.type === 'agent.spawn')
    expect(spawnAt).toBeGreaterThan(-1)
    expect(activities[spawnAt]).toMatchObject({ agent: 'agy', child: 'agy~1', name: 'Math Documenter' })
    expect(activities[spawnAt].label).toContain('Read src/math.js')
    const firstRead = activities.findIndex((activity) => activity.type === 'tool.start' && activity.tool === 'read')
    expect(spawnAt).toBeLessThan(firstRead)

    const lists = starts.filter((activity) => activity.label === 'manage_subagents')
    expect(lists).toHaveLength(3)
    const idleEnd = activities.find((activity) => activity.type === 'tool.end' && activity.id === lists[2].id)
    const ends = activities.filter((activity) => activity.type === 'agent.end' && activity.agent === 'agy~1')
    expect(ends).toHaveLength(1)
    expect(ends[0]).toMatchObject({ ok: true, time: idleEnd.time })
  })

  it('leaves no tool call open', () => {
    const opened = new Set(starts.map((activity) => activity.id))
    const closed = new Set(activities.filter((activity) => activity.type === 'tool.end').map((activity) => activity.id))
    expect([...opened].filter((id) => !closed.has(id))).toEqual([])
    expect(closed.size).toBe(opened.size)
  })

  it('keeps the subagent working while the parent reads', () => {
    const state = createState(tree, agents)
    let together = null
    for (const activity of activities) {
      apply(state, activity)
      const parent = state.agents.get('agy')
      const child = state.agents.get('agy~1')
      if (!together && parent?.status === 'working' && child?.status === 'working' && parent.focus[0]) {
        together = { parentFocus: [...parent.focus], childFocus: [...child.focus] }
      }
    }
    expect(together).not.toBeNull()
    expect(together.parentFocus).toEqual(['src/strings.js'])
    expect(together.childFocus).toEqual([])
    expect(state.agents.get('agy~1')).toMatchObject({ status: 'done', parent: 'agy', depth: 1 })
    expect(state.agents.get('agy')).toMatchObject({ status: 'done', runs: 1 })
  })
})
