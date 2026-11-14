import os from 'node:os'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { buildActivities } from '../src/model/pipeline.js'
import { createPlayer } from '../src/model/player.js'
import { apply, createState } from '../src/model/state.js'
import Inspector from '../src/ui/Inspector.jsx'

const AGENT = { id: 'agent-1', key: 'claude', name: 'Claude', harness: 'claude', parser: 'claude', adapterType: 'claude_local' }
const TREE = {
  rootName: 'MachineRoom',
  rootPath: 'C:\\GitHub\\MachineRoom',
  files: ['src/app.js'],
  dirs: ['src'],
  created: [],
}

function makeFrames(calls) {
  const frames = [
    {
      id: 'run-start',
      createdAt: '2026-11-15T01:00:00.000Z',
      type: 'heartbeat.run.status',
      payload: { agentId: AGENT.id, runId: 'run-1', status: 'running' },
    },
  ]
  calls.forEach((call, index) => {
    const ts = new Date(Date.UTC(2026, 10, 15, 1, 0, index + 1)).toISOString()
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: `tu-${index + 1}`,
            name: call.name,
            input: { file_path: call.path },
          },
        ],
      },
    })
    frames.push({
      id: `log-${index + 1}`,
      createdAt: ts,
      type: 'heartbeat.run.log',
      payload: {
        agentId: AGENT.id,
        runId: 'run-1',
        stream: 'stdout',
        seq: index + 1,
        ts,
        chunk: `${line}\n`,
      },
    })
  })
  frames.push({
    id: 'run-end',
    createdAt: '2026-11-15T01:05:00.000Z',
    type: 'heartbeat.run.status',
    payload: { agentId: AGENT.id, runId: 'run-1', status: 'succeeded' },
  })
  return frames
}

describe('outside-project path tracking', () => {
  test('marks C:\\Windows\\x.txt and /etc/hosts while ignoring project and lane worktree paths', () => {
    const frames = makeFrames([
      { name: 'Write', path: 'C:\\Windows\\x.txt' },
      { name: 'Write', path: '/etc/hosts' },
      { name: 'Write', path: 'C:\\GitHub\\MachineRoom\\src\\app.js' },
      { name: 'Write', path: 'C:\\GitHub\\MachineRoom\\.worktrees\\agy\\src\\lane.js' },
    ])
    const activities = buildActivities(frames, { agents: [AGENT], tree: TREE })
    const starts = activities.filter((item) => item.type === 'tool.start')
    expect(starts).toHaveLength(4)

    const [winOut, posixOut, inProject, inWorktree] = starts
    expect(winOut.outside).toBe(true)
    expect(winOut.outsidePath).toBe('C:\\Windows\\x.txt')
    expect(winOut.touches).toEqual([])

    expect(posixOut.outside).toBe(true)
    expect(posixOut.outsidePath).toBe('/etc/hosts')
    expect(posixOut.touches).toEqual([])

    expect('outside' in inProject).toBe(false)
    expect('outsidePath' in inProject).toBe(false)
    expect(inProject.touches.length).toBeGreaterThan(0)

    expect('outside' in inWorktree).toBe(false)
    expect('outsidePath' in inWorktree).toBe(false)
    expect(inWorktree.touches.length).toBeGreaterThan(0)

    const state = createState(TREE, [AGENT])
    for (const activity of activities) apply(state, activity)
    const agent = state.agents.get(AGENT.key)

    expect(agent.outsideCount).toBe(2)
    expect(agent.outsidePaths).toEqual([
      { path: '/etc/hosts', kind: 'write' },
      { path: 'C:\\Windows\\x.txt', kind: 'write' },
    ])

    const html = renderToStaticMarkup(
      React.createElement(Inspector, {
        target: { kind: 'agent', id: AGENT.key },
        lanes: [agent],
        tree: TREE,
      }),
    )
    expect(html).toContain('Outside the project')
    expect(html).toContain('C:\\Windows\\x.txt')
    expect(html).toContain('/etc/hosts')
    expect(html.indexOf('/etc/hosts')).toBeLessThan(html.indexOf('C:\\Windows\\x.txt'))
  })

  test('masks the home folder in outsidePath for Windows and POSIX paths', () => {
    const user = os.userInfo().username
    const winHomeFile = `C:\\Users\\${user}\\.gitconfig`
    const posixHomeFile = `/home/${user}/.ssh/config`
    const frames = makeFrames([
      { name: 'Read', path: winHomeFile },
      { name: 'Edit', path: posixHomeFile },
      { name: 'Read', path: 'C:\\GitHub\\MachineRoom\\src\\app.js' },
    ])

    const activities = buildActivities(frames, { agents: [AGENT], tree: TREE })
    const starts = activities.filter((item) => item.type === 'tool.start')
    expect(starts).toHaveLength(3)

    expect(starts[0].outside).toBe(true)
    expect(starts[0].outsidePath).toBe('%USERPROFILE%\\.gitconfig')
    expect(starts[0].outsidePath).not.toContain(user)

    expect(starts[1].outside).toBe(true)
    expect(starts[1].outsidePath).toBe('~/.ssh/config')
    expect(starts[1].outsidePath).not.toContain(user)

    expect('outside' in starts[2]).toBe(false)
    expect('outsidePath' in starts[2]).toBe(false)
  })

  test('seek back drops outside paths recorded after that time', () => {
    const frames = makeFrames([
      { name: 'Read', path: '/etc/first.conf' },
      { name: 'Write', path: '/etc/second.conf' },
      { name: 'Edit', path: '/etc/third.conf' },
    ])
    const activities = buildActivities(frames, { agents: [AGENT], tree: TREE })
    const player = createPlayer({ activities, tree: TREE, agents: [AGENT] })

    const firstIndex = activities.findIndex((item) => item.outsidePath === '/etc/first.conf')
    expect(firstIndex).toBeGreaterThanOrEqual(0)

    player.seek(player.duration)
    let agent = player.state.agents.get(AGENT.key)
    expect(agent.outsideCount).toBe(3)
    expect(agent.outsidePaths).toEqual([
      { path: '/etc/third.conf', kind: 'edit' },
      { path: '/etc/second.conf', kind: 'write' },
      { path: '/etc/first.conf', kind: 'read' },
    ])

    player.seek(player.stamps[firstIndex])
    agent = player.state.agents.get(AGENT.key)
    expect(agent.outsideCount).toBe(1)
    expect(agent.outsidePaths).toEqual([{ path: '/etc/first.conf', kind: 'read' }])

    player.seek(0)
    agent = player.state.agents.get(AGENT.key)
    expect(agent.outsideCount).toBe(0)
    expect(agent.outsidePaths).toEqual([])
  })

  test('stops at 20 distinct outside paths and updates kind to newest touch', () => {
    const calls = []
    for (let i = 1; i <= 25; i += 1) {
      calls.push({ name: 'Write', path: `/opt/outside/file-${String(i).padStart(2, '0')}.txt` })
    }
    calls.push({ name: 'Edit', path: '/opt/outside/file-10.txt' })

    const frames = makeFrames(calls)
    const activities = buildActivities(frames, { agents: [AGENT], tree: TREE })
    const state = createState(TREE, [AGENT])
    for (const activity of activities) apply(state, activity)

    const agent = state.agents.get(AGENT.key)
    expect(agent.outsideCount).toBe(26)
    expect(agent.outsidePaths).toHaveLength(20)
    expect(agent.outsidePaths[0]).toEqual({ path: '/opt/outside/file-10.txt', kind: 'edit' })
    expect(agent.outsidePaths.some((entry) => entry.path === '/opt/outside/file-05.txt')).toBe(false)
    expect(agent.outsidePaths[1]).toEqual({ path: '/opt/outside/file-25.txt', kind: 'write' })
    expect(agent.outsidePaths[19]).toEqual({ path: '/opt/outside/file-06.txt', kind: 'write' })
  })

  test('Inspector renders Outside the project with existing classes and changes nothing when empty', () => {
    const plainLane = { key: AGENT.key, name: AGENT.name, harness: AGENT.harness, status: 'idle', runs: 1 }
    const emptyLane = { ...plainLane, outsidePaths: [], outsideCount: 0 }

    const plainHtml = renderToStaticMarkup(
      React.createElement(Inspector, { target: { kind: 'agent', id: AGENT.key }, lanes: [plainLane], tree: TREE }),
    )
    const emptyHtml = renderToStaticMarkup(
      React.createElement(Inspector, { target: { kind: 'agent', id: AGENT.key }, lanes: [emptyLane], tree: TREE }),
    )
    expect(plainHtml).not.toContain('Outside the project')
    expect(emptyHtml).toBe(plainHtml)

    const populatedLane = {
      ...plainLane,
      outsideCount: 3,
      outsidePaths: [
        { path: '/etc/hosts', kind: 'edit' },
        { path: 'C:\\Windows\\x.txt', kind: 'read' },
      ],
    }
    const html = renderToStaticMarkup(
      React.createElement(Inspector, { target: { kind: 'agent', id: AGENT.key }, lanes: [populatedLane], tree: TREE }),
    )
    expect(html).toContain('Outside the project 3')
    expect(html).toContain('mr-inspector-touches')
    expect(html).toContain('mr-inspector-touch ')
    expect(html).toContain('is-read')
    expect(html).toContain('is-write')
    expect(html).toContain('/etc/hosts')
    expect(html).toContain('C:\\Windows\\x.txt')
    expect(html).toContain('edit')
    expect(html).toContain('read')
    expect(html.indexOf('/etc/hosts')).toBeLessThan(html.indexOf('C:\\Windows\\x.txt'))
  })
})
