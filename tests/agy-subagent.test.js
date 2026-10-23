import { afterEach, describe, expect, it } from 'vitest'
import { apply, createState } from '../src/model/state.js'
import { playFrames, postJson, readFrames, roomInputs, runEnded, startLoop, waitForPaperclip } from './helpers/loop.js'
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

const loops = []

async function loop() {
  const started = await startLoop()
  loops.push(started)
  return started
}

afterEach(async () => {
  while (loops.length > 0) await loops.pop().stop()
})

describe('an agy task through the fake Paperclip', () => {
  it('shows the parent and the child working together, the child ending first', async () => {
    const { url } = await loop()
    await waitForPaperclip(url)
    const { agents, tree } = await roomInputs(url)
    const agy = agents.find((agent) => agent.key === 'agy')
    expect(agy).toMatchObject({ adapterType: 'process' })

    const created = await postJson(`${url}/api/control/issues`, {
      title: 'Check the notes beside the fix',
      assigneeAgentId: agy.id,
      confirmed: true,
    })
    expect(created.status).toBe(201)

    const frames = await readFrames(url, runEnded(agy.id))
    let together = null
    const { state, activities } = playFrames(frames, agents, tree, (activity, current) => {
      if (together) return
      const parent = current.agents.get('agy')
      const child = current.agents.get('agy~1')
      if (parent?.status === 'working' && child?.status === 'working' && child.focus.length > 0) {
        together = { type: activity.type, parentFocus: [...parent.focus], childFocus: [...child.focus] }
      }
    })

    expect(together).not.toBeNull()
    expect(together.childFocus).toEqual(['docs/notes.md'])
    expect(together.parentFocus).toEqual(['src/math.js'])
    const childEnd = activities.find((activity) => activity.type === 'agent.end' && activity.agent === 'agy~1')
    const runEnd = activities.find((activity) => activity.type === 'run.end' && activity.agent === 'agy')
    expect(childEnd.time).toBeLessThan(runEnd.time)
    expect(state.agents.get('agy~1')).toMatchObject({ status: 'done', parent: 'agy', depth: 1 })
    expect(state.agents.get('agy')).toMatchObject({ status: 'done', runs: 1 })
  })
})
