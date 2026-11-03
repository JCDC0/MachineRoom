import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Hud from '../src/ui/Hud.jsx'
import { agentForNumber, agentList } from '../src/ui/agentList.js'
import { ladderGroups } from '../src/ui/ladderGroups.js'

const orchestrator = { key: 'orchestrator', name: 'Orchestrator', status: 'idle' }
const claude = { key: 'claude', name: 'Claude Code', status: 'working' }
const hermes = { key: 'hermes', name: 'Hermes', status: 'queued' }
const opencode = { key: 'opencode', name: 'OpenCode Go', status: 'done' }
const claude2 = { key: 'claude2', name: 'Claude Two', status: 'idle' }
const opencode2 = { key: 'opencode2', name: 'OpenCode Two', status: 'idle' }
const agy = { key: 'agy', name: 'AGY', status: 'idle' }
const subFrontend = {
  key: 'sub-frontend',
  name: 'Frontend',
  status: 'working',
  subOrchestrator: true,
}
const subBackend = {
  key: 'sub-backend',
  name: 'Backend',
  status: 'error',
  subOrchestrator: true,
}
const subOld = { key: 'sub-old', name: 'Old Sub', status: 'idle', subOrchestrator: true }

const LADDER = {
  subs: [
    { id: 'frontend', name: 'Frontend', lanes: ['opencode', 'opencode2'] },
    { id: 'backend', name: 'Backend', lanes: ['claude', 'claude2'] },
  ],
}

const ROSTER = [
  orchestrator,
  claude,
  hermes,
  opencode,
  claude2,
  opencode2,
  agy,
  subFrontend,
  subBackend,
]

const keys = (rows) => rows.map((row) => row.agent.key)

function groupByKey(groups, key) {
  return groups.find((group) => group.key === key)
}

describe('ladderGroups', () => {
  it('leaves the list flat when there is no ladder or no sub', () => {
    const rows = agentList(ROSTER).rows
    expect(ladderGroups(rows, null)).toBeNull()
    expect(ladderGroups(rows, undefined)).toBeNull()
    expect(ladderGroups(rows, {})).toBeNull()
    expect(ladderGroups(rows, { subs: [] })).toBeNull()
    expect(ladderGroups(rows, { subs: [{ name: 'No id', lanes: ['claude'] }] })).toBeNull()
  })

  it('puts the main orchestrator first, the subs in ladder order and Main last', () => {
    const grouped = ladderGroups(agentList(ROSTER).rows, LADDER)
    expect(grouped.groups.map((group) => group.key)).toEqual([
      'orchestrator',
      'sub-frontend',
      'sub-backend',
      'main',
    ])
    expect(keys(grouped.groups[0].rows)).toEqual(['orchestrator'])
    expect(keys(grouped.groups[1].rows)).toEqual(['opencode'])
    expect(keys(grouped.groups[2].rows)).toEqual(['claude'])
    expect(keys(grouped.groups[3].rows)).toEqual(['hermes'])
  })

  it('gives each sub header its name, state word and lane count', () => {
    const grouped = ladderGroups(agentList(ROSTER).rows, LADDER)
    expect(grouped.groups[0].header).toBeNull()
    expect(grouped.groups[1].header).toEqual({
      name: 'Frontend',
      state: 'working',
      laneCount: 2,
    })
    expect(grouped.groups[2].header).toEqual({
      name: 'Backend',
      state: 'error',
      laneCount: 2,
    })
    expect(grouped.groups[3].header).toEqual({ name: 'Main', state: null, laneCount: 2 })
    expect(grouped.groups[1].indent).toBe(16)
    expect(grouped.groups[2].indent).toBe(16)
    expect(grouped.groups[3].indent).toBe(0)
  })

  it('hides the sub orchestrator rows and keeps their lanes in their group', () => {
    const grouped = ladderGroups(agentList(ROSTER).rows, LADDER)
    const keysShown = grouped.groups.flatMap((group) => [
      ...keys(group.rows),
      ...keys(group.idleRows),
    ])
    expect(keysShown).not.toContain('sub-frontend')
    expect(keysShown).not.toContain('sub-backend')
    expect(grouped.top.map((agent) => agent.key)).not.toContain('sub-frontend')
    expect(grouped.groups[1].idleCount).toBe(1)
    expect(grouped.groups[2].idleCount).toBe(1)
  })

  it('counts idle lanes inside each group and hides them while the idle row is closed', () => {
    const closed = ladderGroups(agentList(ROSTER).rows, LADDER)
    expect(closed.groups.map((group) => group.idleCount)).toEqual([0, 1, 1, 1])
    expect(closed.groups.map((group) => group.idleOpen)).toEqual([false, false, false, false])
    expect(closed.top.map((agent) => agent.key)).toEqual([
      'orchestrator',
      'opencode',
      'claude',
      'hermes',
    ])

    const open = ladderGroups(agentList(ROSTER, true).rows, LADDER)
    expect(open.groups.map((group) => group.idleCount)).toEqual([0, 1, 1, 1])
    expect(open.groups.map((group) => group.idleOpen)).toEqual([false, true, true, true])
    expect(keys(open.groups[1].idleRows)).toEqual(['opencode2'])
    expect(keys(open.groups[2].idleRows)).toEqual(['claude2'])
    expect(keys(open.groups[3].idleRows)).toEqual(['agy'])
    expect(open.top.map((agent) => agent.key)).toEqual([
      'orchestrator',
      'opencode',
      'opencode2',
      'claude',
      'claude2',
      'hermes',
      'agy',
    ])
  })

  it('numbers the rows in the order shown and gives the number keys that order', () => {
    const grouped = ladderGroups(agentList(ROSTER, true).rows, LADDER)
    expect(grouped.groups.map((group) => group.rows.map((row) => row.number))).toEqual([
      [1],
      [2],
      [4],
      [6],
    ])
    expect(grouped.groups[1].idleRows.map((row) => row.number)).toEqual([3])
    expect(grouped.groups[2].idleRows.map((row) => row.number)).toEqual([5])
    expect(grouped.groups[3].idleRows.map((row) => row.number)).toEqual([7])
    for (let number = 1; number <= grouped.top.length; number += 1) {
      expect(agentForNumber(grouped, String(number))).toBe(grouped.top[number - 1])
    }
    expect(agentForNumber(grouped, String(grouped.top.length + 1))).toBeNull()
  })

  it('keeps a lane under its sub even when it is a child of another lane', () => {
    const child = { key: 'opencode~1', name: 'Scout', status: 'done', parent: 'opencode', depth: 1 }
    const grouped = ladderGroups(agentList([...ROSTER, child]).rows, LADDER)
    const frontend = groupByKey(grouped.groups, 'sub-frontend')
    expect(keys(frontend.rows)).toEqual(['opencode', 'opencode~1'])
    expect(frontend.rows.map((row) => row.depth)).toEqual([0, 1])
    expect(frontend.rows.map((row) => row.number)).toEqual([2, null])
    expect(grouped.top.map((agent) => agent.key)).not.toContain('opencode~1')
  })

  it('leaves out Main when every lane belongs to a sub', () => {
    const roster = [orchestrator, claude, opencode, subFrontend, subBackend]
    const grouped = ladderGroups(agentList(roster).rows, LADDER)
    expect(grouped.groups.map((group) => group.key)).toEqual([
      'orchestrator',
      'sub-frontend',
      'sub-backend',
    ])
  })

  it('keeps a sub header when its lane is not in the roster yet', () => {
    const grouped = ladderGroups(agentList([orchestrator, claude]).rows, LADDER)
    expect(grouped.groups.map((group) => group.key)).toEqual([
      'orchestrator',
      'sub-frontend',
      'sub-backend',
    ])
    expect(keys(grouped.groups[1].rows)).toEqual([])
    expect(grouped.groups[1].header.laneCount).toBe(2)
    expect(keys(grouped.groups[2].rows)).toEqual(['claude'])
  })

  it('leaves out a sub agent that the ladder does not name', () => {
    const grouped = ladderGroups(agentList([...ROSTER, subOld]).rows, LADDER)
    const keysShown = grouped.groups.flatMap((group) => [
      ...keys(group.rows),
      ...keys(group.idleRows),
    ])
    expect(keysShown).not.toContain('sub-old')
    expect(grouped.top.map((agent) => agent.key)).not.toContain('sub-old')
  })

  it('absorbs a sub agent whose name reads like the main orchestrator', () => {
    const helper = { key: 'sub-helper', name: 'Orchestrator Helper', status: 'working' }
    const ladder = { subs: [{ id: 'helper', name: 'Helper', lanes: ['hermes'] }] }
    const grouped = ladderGroups(agentList([orchestrator, hermes, helper]).rows, ladder)
    expect(grouped.groups.map((group) => group.key)).toEqual(['orchestrator', 'sub-helper'])
    expect(grouped.groups[1].header).toEqual({
      name: 'Helper',
      state: 'working',
      laneCount: 1,
    })
    expect(keys(grouped.groups[1].rows)).toEqual(['hermes'])
    expect(grouped.top.map((agent) => agent.key)).toEqual(['orchestrator', 'hermes'])
  })

  it('groups the scenario-e lanes under the demo ladder', () => {
    const demo = {
      subs: [
        { id: 'frontend', name: 'Frontend', lanes: ['opencode'] },
        { id: 'backend', name: 'Backend', lanes: ['claude'] },
      ],
    }
    const agents = JSON.parse(
      readFileSync(new URL('../public/fixtures/scenario-e-agents.json', import.meta.url), 'utf8')
    ).agents
    const grouped = ladderGroups(agentList(agents).rows, demo)
    expect(grouped.groups.map((group) => group.header?.name ?? null)).toEqual([
      null,
      'Frontend',
      'Backend',
      'Main',
    ])
    expect(keys(grouped.groups[1].idleRows)).toEqual(['opencode'])
    expect(keys(grouped.groups[2].idleRows)).toEqual(['claude'])
    expect(keys(grouped.groups[3].idleRows)).toEqual(['hermes'])
  })

  it('does not change the rows it is given', () => {
    const rows = agentList(ROSTER, true).rows
    const numbers = rows.map((row) => row.number)
    const order = rows.map((row) => row.agent.key)
    ladderGroups(rows, LADDER)
    expect(rows.map((row) => row.number)).toEqual(numbers)
    expect(rows.map((row) => row.agent.key)).toEqual(order)
  })
})

describe('Hud agent groups', () => {
  const snapshot = {
    position: 0,
    duration: 60,
    playing: false,
    speed: 1,
    agents: ROSTER.map(({ key, name, status }) => ({ key, name, status })),
    log: [],
  }

  it('draws a header row per sub and indents its lanes by 16 pixels', () => {
    const html = renderToString(
      createElement(Hud, { mode: 'replay', snapshot, speeds: [1], ladder: LADDER })
    )
    expect(html).toContain('class="hud-agent-row hud-agent-group"')
    expect(html).toContain('<span class="agent-name">Frontend</span>')
    expect(html).toContain('<span class="agent-name">Backend</span>')
    expect(html).toContain('<span class="agent-name">Main</span>')
    expect(html).toContain('2 lanes')
    expect(html).toContain('padding-left:16px')
    expect(html).toContain('>failed</span>')
  })

  it('says one lane for a sub with one lane', () => {
    const ladder = {
      subs: [{ id: 'frontend', name: 'Frontend', lanes: ['opencode'] }],
    }
    const html = renderToString(
      createElement(Hud, { mode: 'replay', snapshot, speeds: [1], ladder })
    )
    expect(html).toContain('1 lane')
    expect(html).not.toContain('1 lanes')
  })

  it('draws the flat list when there is no ladder', () => {
    const html = renderToString(
      createElement(Hud, { mode: 'replay', snapshot, speeds: [1] })
    )
    expect(html).not.toContain('hud-agent-group')
    expect(html).not.toContain('padding-left:16px')
    expect(html).toContain('class="idle-toggle"')
  })

  it('styles the group header with a class the stylesheet holds', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    expect(css).toContain('.hud-agent-group {')
  })
})
