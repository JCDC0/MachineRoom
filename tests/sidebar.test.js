import { act, createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Hud from '../src/ui/Hud.jsx'
import Sidebar from '../src/ui/Sidebar.jsx'
import SidebarTabs from '../src/ui/SidebarTabs.jsx'
import { WIDE_LAYOUT_MIN } from '../src/ui/agentStrip.js'
import { click, settle, withDom } from './helpers/uiDom.js'
import {
  agentCountLine,
  conversationMarkdown,
  exportFileName,
  groupSessions,
  laneChoice,
  laneSummary,
  loadSessionSort,
  normalizeSessionSort,
  normalizeSidebarTab,
  previewLines,
  projectName,
  saveSessionSort,
  sessionAge,
  sessionMenuActionForKey,
  sessionMenuItemForKey,
  sessionMenuItems,
  sessionRowIdentity,
  sessionRows,
  sortSessionRows,
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

  it('puts the current one first, then pinned with starred counted, and recent', () => {
    const groups = groupSessions(answer)
    expect(groups.current.title).toBe('Live one')
    expect(groups.current.current).toBe(true)
    expect(groups.pinned.map((row) => row.title)).toEqual(['Pinned one', 'Starred one', 'Older pin'])
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

  const sortable = {
    sessions: [
      { id: 'p1', title: 'Pin B', endedAt: NOW - DAY, pinned: true },
      { id: 'r1', title: 'Alpha', endedAt: NOW - 5 * DAY },
      { id: 'p2', title: 'Pin A', endedAt: NOW - 3 * DAY, starred: true },
      { id: 'r2', title: 'Zulu', endedAt: NOW - 2 * DAY },
    ],
  }

  it('keeps pinned rows first and sorts each group by the chosen order', () => {
    expect(sessionRows(sortable, { sort: 'newest' }).rows.map((row) => row.title)).toEqual([
      'Pin B',
      'Pin A',
      'Zulu',
      'Alpha',
    ])
    expect(sessionRows(sortable, { sort: 'oldest' }).rows.map((row) => row.title)).toEqual([
      'Pin A',
      'Pin B',
      'Alpha',
      'Zulu',
    ])
    expect(sessionRows(sortable, { sort: 'name' }).rows.map((row) => row.title)).toEqual([
      'Pin A',
      'Pin B',
      'Alpha',
      'Zulu',
    ])
    expect(normalizeSessionSort('NAME')).toBe('name')
    expect(normalizeSessionSort('sideways')).toBe('newest')
    expect(sortSessionRows([{ title: 'B', at: 1, id: 'b' }, { title: 'A', at: 2, id: 'a' }], 'name')).toHaveLength(2)
  })

  it('filters by title and hides archived rows until they are shown', () => {
    const answer = {
      current: { id: 'live', title: 'Live one', startedAt: NOW },
      sessions: [
        { id: 'recent', title: 'Recent one', endedAt: NOW - DAY },
        { id: 'archived', title: 'Old pin', endedAt: NOW - 2 * DAY, archived: true },
      ],
    }
    const filtered = sessionRows(answer, { query: 'one' })
    expect(filtered.rows.map((row) => row.id)).toEqual(['live', 'recent'])
    expect(filtered.archivedTotal).toBe(0)

    const hidden = sessionRows(answer)
    expect(hidden.rows.map((row) => row.id)).toEqual(['live', 'recent'])
    expect(hidden.archivedTotal).toBe(1)

    const shown = sessionRows(answer, { showArchived: true })
    expect(shown.rows.map((row) => row.id)).toEqual(['live', 'recent', 'archived'])

    const matching = sessionRows(answer, { query: 'pin', showArchived: true })
    expect(matching.rows.map((row) => row.id)).toEqual(['archived'])
  })

  it('reads and writes the sort choice, and never throws without storage', () => {
    const storage = {
      value: null,
      getItem() {
        return this.value
      },
      setItem(key, value) {
        this.value = value
      },
    }
    saveSessionSort('name', storage)
    expect(loadSessionSort(storage)).toBe('name')
    saveSessionSort('sideways', storage)
    expect(loadSessionSort(storage)).toBe('newest')

    const broken = {
      getItem() {
        throw new Error('blocked')
      },
      setItem() {
        throw new Error('blocked')
      },
    }
    expect(loadSessionSort(broken)).toBe('newest')
    expect(() => saveSessionSort('oldest', broken)).not.toThrow()
  })
})

describe('the conversation menu', () => {
  it('lists every item with its key and marks archive and delete for the current row', () => {
    const items = sessionMenuItems({ id: 's1', title: 'Alpha', count: 3 })
    expect(items.map((item) => [item.label, item.key])).toEqual([
      ['Pin', 'P'],
      ['Rename', 'R'],
      ['Fork', 'F'],
      ['Export', 'E'],
      ['Mark as unread', 'U'],
      ['Archive', 'A'],
      ['Delete', 'D'],
    ])
    expect(items.find((item) => item.action === 'delete').danger).toBe(true)

    const current = sessionMenuItems({ id: 'current', title: 'Live', count: 2, current: true })
    expect(current.find((item) => item.action === 'archive')).toMatchObject({
      disabled: true,
      reason: 'The current conversation cannot be archived or deleted.',
    })
    expect(current.find((item) => item.action === 'delete').disabled).toBe(true)
    expect(current.find((item) => item.action === 'pin').disabled).toBe(false)
    expect(current.find((item) => item.action === 'rename').disabled).toBe(false)
    expect(current.find((item) => item.action === 'unread').disabled).toBe(false)
    expect(sessionMenuActionForKey(current, 'a')).toBeNull()
    expect(sessionMenuActionForKey(current, 'f').action).toBe('fork')
    expect(sessionMenuActionForKey(current, 'e').action).toBe('export')
    const empty = sessionMenuItems({ id: 's2', title: 'Empty', count: 0 })
    expect(sessionMenuActionForKey(empty, 'e')).toBeNull()
    expect(sessionMenuItemForKey(empty, 'e')).toMatchObject({
      disabled: true,
      reason: 'This conversation has no messages to export.',
    })
    for (const item of current) {
      expect(sessionMenuItemForKey(current, item.key.toLowerCase())).toBe(item)
    }
    expect(sessionMenuItemForKey(current, 'a')).toMatchObject({ action: 'archive', disabled: true })
    expect(sessionMenuItemForKey(current, 'x')).toBeNull()
  })

  it('unpins a starred row and unarchives an archived row', () => {
    const starred = sessionMenuItems({ id: 's1', title: 'Starred', starred: true, pinned: true, count: 1 })
    expect(starred.find((item) => item.action === 'pin').label).toBe('Unpin')
    const archived = sessionMenuItems({ id: 's2', title: 'Archived', archived: true, count: 1 })
    expect(archived.find((item) => item.action === 'archive').label).toBe('Unarchive')
    expect(sessionMenuActionForKey(starred, 'P').action).toBe('pin')
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

  it('names a lane message from the lane list and falls back to the key', () => {
    const lines = previewLines({
      lanes: [{ key: 'opencode', name: 'OpenCode' }],
      messages: [
        { id: '1', from: 'lane:opencode', text: 'Tests fixed.' },
        { id: '2', from: 'lane:ghost', text: 'Blocked.' },
      ],
    })
    expect(lines.map((line) => line.from)).toEqual(['OpenCode', 'ghost'])
  })
})

describe('conversation export', () => {
  it('writes the title, project, start, summary and two messages with roles and times', () => {
    const text = conversationMarkdown(
      {
        title: 'Alpha export',
        startedAt: '2026-10-25T12:00:00.000Z',
        summary: 'The bridge is green.',
        apiKey: 'secret',
        messages: [
          { id: 'm1', from: 'owner', text: 'Please export this.', at: '2026-10-25T12:01:00.000Z', key: 'secret' },
          { id: 'm2', from: 'orchestrator', text: 'Done.', at: '2026-10-25T12:02:00.000Z' },
        ],
      },
      { project: 'C:\\GitHub\\MachineRoom' }
    )
    expect(text).toBe(
      [
        '# Alpha export',
        '',
        'Project: MachineRoom',
        'Started: 2026-10-25 12:00 UTC',
        'Messages: 2 (the room keeps at most 200 per conversation).',
        '',
        '## Summary',
        '',
        'The bridge is green.',
        '',
        '### owner at 2026-10-25 12:01 UTC',
        '',
        'Please export this.',
        '',
        '### orchestrator at 2026-10-25 12:02 UTC',
        '',
        'Done.',
        '',
      ].join('\n')
    )
    expect(text).not.toContain('secret')
  })

  it('names the file after a title with slashes and its start date', () => {
    expect(exportFileName('Q4 / plan', '2026-10-25T12:00:00.000Z')).toBe('Q4 - plan 2026-10-25.md')
    expect(exportFileName('', null)).toBe('Untitled conversation undated.md')
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

describe('Sidebar tabs', () => {
  it('draws Chat, Projects and Agents with the open one marked', () => {
    const html = renderToString(createElement(SidebarTabs, { value: 'projects' }))
    expect(html).toContain('role="tablist"')
    expect(html).toContain('aria-label="Sidebar tabs"')
    expect(html).toContain('>Chat</span>')
    expect(html).toContain('>Projects</span>')
    expect(html).toContain('>Agents</span>')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('aria-selected="false"')
    const open = html.slice(html.indexOf('mr-side-tab is-open'), html.indexOf('</button>', html.indexOf('mr-side-tab is-open')))
    expect(open).toContain('Projects')
  })

  it('opens Chat when the saved tab is missing or unknown', () => {
    for (const value of [undefined, '', 'elsewhere', 42]) {
      const html = renderToString(createElement(SidebarTabs, { value }))
      const open = html.slice(html.indexOf('mr-side-tab is-open'), html.indexOf('</button>', html.indexOf('mr-side-tab is-open')))
      expect(open).toContain('Chat')
    }
    expect(normalizeSidebarTab('agents')).toBe('agents')
  })
})

function renderSidebar(tab, props) {
  const savedWindow = globalThis.window
  globalThis.window = {
    localStorage: {
      getItem: (key) =>
        key === 'machineroom.settings' ? JSON.stringify({ sidebarTab: tab }) : null,
      setItem: () => {},
    },
  }
  try {
    return renderToString(createElement(Sidebar, props))
  } finally {
    if (savedWindow === undefined) delete globalThis.window
    else globalThis.window = savedWindow
  }
}

describe('Sidebar without bridge methods', () => {
  it('shows the three tabs, New conversation, the project, the live note and no Settings footer in Chat', () => {
    const html = renderSidebar('chat', { client: null, live: false, project: '/MachineRoom' })
    expect(html).toContain('class="mr-side-tabs"')
    expect(html).toContain('class="hud-sessions-button mr-side-new is-rounded"')
    expect(html).toContain('New conversation')
    expect(html).toContain('MachineRoom')
    expect(html).toContain('Projects and conversations appear when the room runs live.')
    expect(html).not.toContain('class="hud-strip-settings"')
    expect(html).not.toContain('mr-side-foot')
    expect(html).not.toContain('aria-label="Sub orchestrators"')
    expect(html).not.toContain('>Attach</button>')
    expect(html).not.toContain('mr-family')
    expect(html).not.toContain('mr-side-projects')
  })

  it('keeps the projects in their own tab', () => {
    const html = renderSidebar('projects', { client: null, live: false, project: '/MachineRoom' })
    expect(html).toContain('class="mr-side-projects"')
    expect(html).not.toContain('Open folder')
    expect(html).toContain('MachineRoom')
    expect(html).toContain('Projects and conversations appear when the room runs live.')
    expect(html).not.toContain('New conversation')
    expect(html).not.toContain('class="hud-strip-settings"')
    expect(html).not.toContain('mr-side-foot')
  })
})

describe('The family tree in a live sidebar', () => {
  const client = {
    projects: async () => ({ current: { path: 'C:\\GitHub\\MachineRoom', name: 'MachineRoom' }, recent: [] }),
    orchestratorSessions: async () => ({ sessions: [] }),
    family: async () => ({ nodes: [], keys: [], proposals: [] }),
    lanes: async () => ({ max: 6, lanes: [] }),
    harnesses: async () => [],
    models: async () => ({ models: [] }),
    orchestrators: async () => [],
    setLadder: async () => ({ ladder: { subs: [] } }),
  }

  it('puts the open Agents tree in the Agents tab and no Attach form', () => {
    const html = renderSidebar('agents', { client, live: true, project: '/MachineRoom' })
    expect(html.indexOf('mr-family')).toBeGreaterThan(-1)
    expect(html).toContain('Loading agents...')
    expect(html).not.toContain('aria-label="Sub orchestrators"')
    expect(html).not.toContain('>Attach</button>')
    expect(html).not.toContain('No sub orchestrators yet.')
    expect(html).not.toContain('class="hud-strip-settings"')
    expect(html).not.toContain('mr-side-foot')
    expect(html).not.toContain('mr-side-projects')
    expect(html).not.toContain('New conversation')
  })

  it('leaves the tree out when the bridge cannot list the family', () => {
    const html = renderSidebar('agents', {
      client: {
        projects: async () => ({ current: null, recent: [] }),
        orchestratorSessions: async () => ({}),
      },
      live: true,
      project: '/MachineRoom',
    })
    expect(html).not.toContain('mr-family')
    expect(html).toContain('Agents appear when the room runs live.')
  })
})

describe('The folded menu entry', () => {
  it('adds Sessions to the menu below WIDE_LAYOUT_MIN pixels', () => {
    const savedWindow = globalThis.window
    globalThis.window = { innerWidth: WIDE_LAYOUT_MIN - 1 }
    try {
      const html = renderToString(
        createElement(Hud, {
          mode: 'replay',
          snapshot: { position: 0, duration: 60, playing: false, speed: 1, agents: [], log: [] },
          speeds: [1, 2, 4],
        })
      )
      expect(html).toContain('Sessions')
      expect(html).toContain('aria-controls="mr-side-overlay"')
    } finally {
      if (savedWindow === undefined) delete globalThis.window
      else globalThis.window = savedWindow
    }
  })
})

describe('current conversation identity in the sidebar', () => {
  it('uses sessionId for the current row and falls back when absent', () => {
    const first = groupSessions({
      current: { id: 'current', sessionId: 'conv-1', title: 'Live one', startedAt: NOW, count: 200 },
      sessions: [{ id: 'old-1', title: 'Archived', endedAt: NOW - DAY }],
    })
    expect(first.current.sessionId).toBe('conv-1')
    const shifted = groupSessions({
      current: { id: 'current', sessionId: 'conv-1', title: 'New title', startedAt: NOW + MINUTE, count: 200 },
      sessions: [],
    })
    expect(sessionRowIdentity(first.current)).toBe('current:session:conv-1')
    expect(sessionRowIdentity(shifted.current)).toBe('current:session:conv-1')

    const rotated = groupSessions({
      current: { id: 'current', sessionId: 'conv-2', title: 'New title', startedAt: NOW + MINUTE, count: 1 },
      sessions: [],
    })
    expect(sessionRowIdentity(rotated.current)).toBe('current:session:conv-2')
    expect(sessionRowIdentity(first.recent[0])).toBe('saved:old-1')

    expect(
      sessionRowIdentity({ id: 'current', title: 'Legacy', startedAt: NOW, current: true })
    ).not.toBe(
      sessionRowIdentity({ id: 'current', title: 'Legacy', startedAt: NOW + MINUTE, current: true })
    )
  })

  it('keeps the current menu open when startedAt shifts at the cap and closes it when sessionId changes', async () => {
    await withDom(async ({ container, dom, root }) => {
      const listeners = new Set()
      let updated = 0
      const state = {
        current: { id: 'current', sessionId: 'conv-1', title: 'Live one', startedAt: NOW, count: 200 },
        sessions: [],
      }
      const client = {
        projects: async () => ({ current: { path: 'C:\\project' }, recent: [] }),
        orchestratorSessions: async () => JSON.parse(JSON.stringify(state)),
        updateOrchestratorSession: async () => {
          updated += 1
          return { ok: true }
        },
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
      await act(async () => {
        root.render(createElement(Sidebar, { client, live: true, project: 'C:\\project' }))
      })
      await settle()

      const button = container.querySelector('button[aria-label="Actions for Live one"]')
      expect(button).not.toBeNull()
      await click(root, button)
      expect(container.querySelector('.mr-side-menu')).not.toBeNull()

      state.current = { id: 'current', sessionId: 'conv-1', title: 'Live one', startedAt: NOW + MINUTE, count: 200 }
      for (const listener of [...listeners]) listener({ topic: 'orchestrator' })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 260))
      })
      await settle()
      expect(container.querySelector('.mr-side-menu')).not.toBeNull()

      state.current = { id: 'current', sessionId: 'conv-2', title: 'Fresh one', startedAt: NOW + 2 * MINUTE, count: 0 }
      for (const listener of [...listeners]) listener({ topic: 'orchestrator' })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 260))
      })
      await settle()
      expect(container.querySelector('.mr-side-menu')).toBeNull()

      await act(async () => {
        dom.window.dispatchEvent({ type: 'keydown', key: 'p', bubbles: true, cancelable: true })
      })
      await settle()
      expect(updated).toBe(0)
    })
  })
})
