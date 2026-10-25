import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Hud from '../src/ui/Hud.jsx'
import Sidebar from '../src/ui/Sidebar.jsx'
import {
  agentCountLine,
  agentDraft,
  agentFormProblem,
  agentFormSummary,
  autocompactLine,
  clampAutocompactPercent,
  groupSessions,
  harnessEfforts,
  harnessGroups,
  harnessModels,
  laneChoice,
  laneFormProblem,
  laneSummary,
  orchestratorRoster,
  previewLines,
  projectName,
  rosterLanes,
  rosterSummary,
  sessionAge,
  sessionRows,
  waitForBridge,
} from '../src/ui/sidebar.js'

const NOW = Date.parse('2026-10-25T12:00:00Z')
const MINUTE = 60000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('session ages', () => {
  it('uses short units from a minute to a year', () => {
    expect(sessionAge({ endedAt: NOW - 1000 }, NOW)).toBe('now')
    expect(sessionAge({ endedAt: NOW - 7 * MINUTE }, NOW)).toBe('7m')
    expect(sessionAge({ endedAt: NOW - 16 * HOUR }, NOW)).toBe('16h')
    expect(sessionAge({ endedAt: NOW - 3 * DAY }, NOW)).toBe('3d')
    expect(sessionAge({ endedAt: NOW - 45 * DAY }, NOW)).toBe('1mo')
    expect(sessionAge({ endedAt: NOW - 400 * DAY }, NOW)).toBe('1y')
  })

  it('falls back from the end to the start and stays blank without a time', () => {
    expect(sessionAge({ startedAt: NOW - 5 * HOUR }, NOW)).toBe('5h')
    expect(sessionAge({ endedAt: new Date(NOW - 2 * HOUR).toISOString() }, NOW)).toBe('2h')
    expect(sessionAge({}, NOW)).toBe('')
  })
})

describe('session groups', () => {
  const answer = {
    current: { title: 'Live one', startedAt: NOW - 5 * MINUTE, count: 4 },
    sessions: [
      { id: 'r1', title: 'Recent one', endedAt: NOW - 3 * DAY, count: 2 },
      { id: 'p1', title: 'Pinned one', endedAt: NOW - 1 * DAY, pinned: true },
      { id: 's1', title: 'Starred one', endedAt: NOW - 2 * DAY, starred: true },
      { id: 'p2', title: 'Older pin', endedAt: NOW - 9 * DAY, pinned: true },
      { id: 'r2', title: 'Old one', endedAt: NOW - 30 * DAY },
      { id: 'r3', title: 'Older', endedAt: NOW - 40 * DAY },
      { id: 'r4', title: 'Oldest', endedAt: NOW - 50 * DAY },
      { id: 'r5', title: 'Ancient', endedAt: NOW - 60 * DAY },
    ],
  }

  it('puts the current one first, then pinned, starred and recent, newest first', () => {
    const groups = groupSessions(answer)
    expect(groups.current.title).toBe('Live one')
    expect(groups.current.current).toBe(true)
    expect(groups.pinned.map((row) => row.title)).toEqual(['Pinned one', 'Older pin'])
    expect(groups.starred.map((row) => row.title)).toEqual(['Starred one'])
    expect(groups.recent.map((row) => row.title)).toEqual([
      'Recent one',
      'Old one',
      'Older',
      'Oldest',
      'Ancient',
    ])
  })

  it('shows six rows and keeps the rest behind a count', () => {
    const rows = sessionRows(answer)
    expect(rows.total).toBe(9)
    expect(rows.rows).toHaveLength(6)
    expect(rows.hidden).toBe(3)
    expect(rows.rows[0].title).toBe('Live one')
    const all = sessionRows(answer, { expanded: true })
    expect(all.rows).toHaveLength(9)
    expect(all.hidden).toBe(0)
  })

  it('drops an archived copy of the current session and fills blank titles', () => {
    const groups = groupSessions({
      current: { id: 'now', title: 'Now' },
      sessions: [
        { id: 'now', title: 'Again' },
        { id: 'empty', title: '  ' },
        { id: 'bad' },
        null,
      ],
    })
    expect(groups.current.title).toBe('Now')
    expect(groups.recent.map((row) => row.id)).toEqual(['empty', 'bad'])
    expect(groups.recent[0].title).toBe('Untitled conversation')
    expect(groups.recent[1].title).toBe('Untitled conversation')
  })
})

describe('agents and projects', () => {
  const lanes = {
    max: 4,
    chosen: false,
    lanes: [
      { key: 'a', name: 'A', active: true, working: true },
      { key: 'b', name: 'B', active: false },
      { key: 'c', name: 'C', active: true },
      { key: 'a', name: 'Again', active: true },
    ],
  }

  it('writes the count line and splits active from inactive', () => {
    const summary = laneSummary(lanes)
    expect(summary.line).toBe('2 of 4 active')
    expect(summary.active.map((lane) => lane.key)).toEqual(['a', 'c'])
    expect(summary.inactive.map((lane) => lane.key)).toEqual(['b'])
    expect(agentCountLine(0, 0)).toBe('0 of 0 active')
    expect(agentCountLine(2, 1)).toBe('2 of 2 active')
  })

  it('keeps the file order when a lane is added or removed', () => {
    expect(laneChoice(lanes.lanes, { remove: ['a'] })).toEqual(['c'])
    expect(laneChoice(lanes.lanes, { add: ['b'] })).toEqual(['a', 'b', 'c'])
    expect(laneChoice(lanes.lanes, { add: ['unknown'] })).toEqual(['a', 'c'])
  })

  it('names a project from its name or its last folder', () => {
    expect(projectName({ name: 'MachineRoom', path: 'C:\\GitHub\\MachineRoom' })).toBe('MachineRoom')
    expect(projectName({ path: 'C:\\GitHub\\MachineRoom' })).toBe('MachineRoom')
    expect(projectName({})).toBe('Project')
  })
})

describe('the roster', () => {
  const orchestrators = [
    { id: 'orchestrator', name: 'Orchestrator', harness: 'claude', model: 'opus', effort: 'high', autocompact: true, autocompactPercent: 82 },
    { id: 'frontend', name: 'Frontend', harness: 'opencode', model: 'opencode-go/x', effort: 'max', autocompact: false, autocompactPercent: 200 },
  ]

  it('puts Main first and keeps each orchestrator setting', () => {
    const rows = orchestratorRoster({ orchestrators: [...orchestrators].reverse() })
    expect(rows.map((row) => row.name)).toEqual(['Main', 'Frontend'])
    expect(rows[0]).toMatchObject({
      harness: 'claude',
      model: 'opus',
      effort: 'high',
      autocompact: true,
      percent: 82,
      sub: false,
    })
    expect(rows[1]).toMatchObject({ autocompact: false, percent: 95, sub: true })
  })

  it('writes the autocompact line and clamps the percent', () => {
    expect(autocompactLine({ autocompact: true, percent: 80 })).toBe('autocompact 80%')
    expect(autocompactLine({ autocompact: false, percent: 80 })).toBe('autocompact off')
    expect(clampAutocompactPercent(20)).toBe(50)
    expect(clampAutocompactPercent(120)).toBe(95)
    expect(clampAutocompactPercent('73.6')).toBe(74)
  })

  it('lists every lane with its harness, model, effort and switches', () => {
    const rows = rosterLanes({
      max: 6,
      lanes: [
        { key: 'claude', name: 'Claude Code', harness: 'claude', model: 'sonnet', effort: 'high', active: true, working: true },
        { key: 'mine', name: 'Mine', harness: 'opencode', model: 'qwen', effort: 'low', active: false, custom: true },
      ],
    })
    expect(rows[0]).toMatchObject({ key: 'claude', active: true, working: true, custom: false, effort: 'high' })
    expect(rows[1]).toMatchObject({ key: 'mine', active: false, custom: true, effort: 'low' })
  })

  it('counts the active lanes above the list', () => {
    const summary = rosterSummary(orchestrators, {
      max: 6,
      lanes: [
        { key: 'a', active: true },
        { key: 'b', active: false },
        { key: 'c' },
      ],
    })
    expect(summary.line).toBe('2 of 6 active')
    expect(summary.orchestrators).toHaveLength(2)
    expect(summary.lanes).toHaveLength(3)
  })
})

describe('the add form', () => {
  const harnesses = {
    harnesses: [
      { key: 'claude', name: 'Claude Code', available: true, models: [{ id: 'sonnet', label: 'Sonnet' }], efforts: ['low', 'high'] },
      { key: 'opencode', name: 'OpenCode', available: true, models: [{ id: 'qwen', label: 'Qwen' }], efforts: [] },
      { key: 'agy', name: 'Antigravity', available: false, models: [], efforts: [] },
    ],
  }

  it('splits the harnesses into the ones here and the ones missing', () => {
    const groups = harnessGroups(harnesses)
    expect(groups.available.map((harness) => harness.key)).toEqual(['claude', 'opencode'])
    expect(groups.unavailable.map((harness) => harness.key)).toEqual(['agy'])
    expect(harnessModels(groups.all[0], null).map((model) => model.id)).toEqual(['sonnet'])
    expect(harnessEfforts(groups.all[0])).toEqual(['low', 'high'])
    expect(harnessEfforts(groups.all[1])).toEqual([])
  })

  it('falls back to the bridge model list for a harness key', () => {
    const models = {
      models: [
        { id: 'claude-x', harness: 'claude', label: 'Claude X' },
        { id: 'opencode-y', harness: 'opencode', label: 'OpenCode Y' },
      ],
    }
    expect(harnessModels('claude', models).map((model) => model.id)).toEqual(['claude-x'])
    expect(harnessModels('unknown', models)).toEqual([])
  })

  it('starts on the first harness that is on this computer', () => {
    expect(agentDraft(harnesses)).toMatchObject({
      name: '',
      harness: 'claude',
      model: 'sonnet',
      effort: 'low',
    })
  })

  it('checks the name, the harness, the model and the effort', () => {
    const draft = { name: 'Writer', harness: 'claude', model: 'sonnet', effort: 'high' }
    expect(agentFormProblem(draft, harnesses)).toBe('')
    expect(agentFormProblem({ ...draft, name: ' ' }, harnesses)).toBe('Write a name for the agent.')
    expect(agentFormProblem({ ...draft, name: 'x'.repeat(41) }, harnesses)).toBe('Keep the name to 40 characters.')
    expect(agentFormProblem({ ...draft, harness: 'agy' }, harnesses)).toBe('That harness is not on this computer.')
    expect(agentFormProblem({ ...draft, harness: 'nope' }, harnesses)).toBe('Choose a harness.')
    expect(agentFormProblem({ ...draft, model: 'other' }, harnesses)).toBe('Choose a model for this harness.')
    expect(agentFormProblem({ ...draft, effort: 'max' }, harnesses)).toBe('Choose an effort for this harness.')
    const plain = { name: 'Writer', harness: 'opencode', model: 'qwen', effort: '' }
    expect(agentFormProblem(plain, harnesses)).toBe('')
    expect(agentFormProblem({ ...plain, effort: 'max' }, harnesses)).toBe('This harness has no effort levels.')
  })

  it('names the harness and model on the confirm card', () => {
    const draft = { name: 'Writer', harness: 'claude', model: 'sonnet' }
    expect(agentFormSummary(draft, harnesses)).toBe('Add "Writer" on Claude Code with sonnet?')
  })

  it('checks a lane edit before the confirm card', () => {
    const draft = { name: 'Mine', model: 'sonnet', effort: 'high' }
    const lists = { models: [{ id: 'sonnet' }, { id: 'opus' }], efforts: ['low', 'high'] }
    expect(laneFormProblem(draft, lists)).toBe('')
    expect(laneFormProblem({ ...draft, name: '' }, lists)).toBe('Write a name for the agent.')
    expect(laneFormProblem({ ...draft, name: 'x'.repeat(41) }, lists)).toBe('Keep the name to 40 characters.')
    expect(laneFormProblem({ ...draft, model: 'other' }, lists)).toBe('Choose a model for this harness.')
    expect(laneFormProblem({ ...draft, effort: 'max' }, lists)).toBe('Choose an effort for this harness.')
    expect(laneFormProblem(draft, { models: [], efforts: [] })).toBe('')
    expect(laneFormProblem({ ...draft, model: 'other', effort: 'max' }, { models: [], efforts: [] })).toBe('')
  })
})

describe('preview lines', () => {
  it('keeps the speaker and removes control characters', () => {
    const lines = previewLines({
      messages: [
        { id: '1', from: 'owner', text: 'Hi\u0007 there' },
        { from: 'sub:frontend', text: 'Done' },
        { from: 'room', text: 'Lane finished' },
        { from: 'orchestrator', text: 'Plain' },
        { from: 'owner', text: '   ' },
      ],
    })
    expect(lines).toHaveLength(4)
    expect(lines[0]).toMatchObject({ from: 'owner', text: 'Hi there' })
    expect(lines[1]).toMatchObject({ from: 'sub frontend', text: 'Done' })
    expect(lines[2]).toMatchObject({ from: 'room' })
    expect(lines[3]).toMatchObject({ from: 'orchestrator' })
  })
})

describe('waitForBridge', () => {
  it('waits for the bridge and the new project path', async () => {
    let health = 0
    let projects = 0
    const client = {
      health: async () => {
        health += 1
        if (health < 3) throw new Error('down')
        return { ok: true }
      },
      projects: async () => {
        projects += 1
        return { current: { path: projects < 2 ? 'C:\\old' : 'C:\\new' } }
      },
    }
    expect(await waitForBridge(client, { path: 'C:\\new', intervalMs: 1, timeoutMs: 1000 })).toBe(true)
    expect(health).toBeGreaterThanOrEqual(3)
  })

  it('gives up when the bridge stays down', async () => {
    const client = { health: async () => { throw new Error('down') } }
    expect(await waitForBridge(client, { intervalMs: 1, timeoutMs: 10 })).toBe(false)
  })
})

describe('Sidebar without bridge methods', () => {
  it('shows the project, the live note, New conversation and Settings', () => {
    const html = renderToString(
      createElement(Sidebar, { client: null, live: false, project: '/MachineRoom' })
    )
    expect(html).toContain('class="hud-sessions-button mr-side-new"')
    expect(html).toContain('New conversation')
    expect(html).toContain('Projects')
    expect(html).toContain('Open folder')
    expect(html).toContain('MachineRoom')
    expect(html).toContain('Projects and conversations appear when the room runs live.')
    expect(html).toContain('class="hud-strip-settings"')
    expect(html).not.toContain('mr-side-lane')
  })
})

describe('The roster in a live sidebar', () => {
  const client = {
    projects: async () => ({ current: { path: 'C:\\GitHub\\MachineRoom', name: 'MachineRoom' }, recent: [] }),
    orchestratorSessions: async () => ({ sessions: [] }),
    lanes: async () => ({ max: 6, lanes: [] }),
    orchestrators: async () => [],
    harnesses: async () => [],
    models: async () => ({ models: [] }),
  }

  it('puts the open Agents list above the projects', () => {
    const html = renderToString(createElement(Sidebar, { client, live: true, project: '/MachineRoom' }))
    const roster = html.indexOf('mr-side-agents')
    const projects = html.indexOf('mr-side-projects')
    expect(roster).toBeGreaterThan(-1)
    expect(projects).toBeGreaterThan(roster)
    expect(html).toContain('Loading agents...')
    expect(html).toContain('Orchestrators')
    expect(html).toContain('Lanes')
    expect(html).toContain('Add agent')
    expect(html).toContain('aria-expanded="true"')
  })

  it('leaves the roster out when the bridge cannot list agents', () => {
    const html = renderToString(
      createElement(Sidebar, {
        client: {
          projects: async () => ({ current: null, recent: [] }),
          orchestratorSessions: async () => ({}),
        },
        live: true,
        project: '/MachineRoom',
      })
    )
    expect(html).not.toContain('mr-side-agents')
    expect(html).toContain('mr-side-projects')
  })
})

describe('The folded menu entry', () => {
  it('adds Sessions to the menu below 900 pixels', () => {
    const html = renderToString(
      createElement(Hud, {
        mode: 'replay',
        snapshot: { position: 0, duration: 60, playing: false, speed: 1, agents: [], log: [] },
        speeds: [1, 2, 4],
      })
    )
    expect(html).toContain('Sessions')
    expect(html).toContain('aria-controls="mr-side-overlay"')
  })
})
