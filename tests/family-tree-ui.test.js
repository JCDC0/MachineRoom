import { readFileSync } from 'node:fs'
import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import FamilyTeam from '../src/ui/FamilyTeam.jsx'
import Sidebar from '../src/ui/Sidebar.jsx'
import { FamilyTeams, FamilyTree } from '../src/ui/FamilyTree.jsx'
import { DIRECT_KEY_PROBLEM } from '../src/ui/family.js'
import { buttonWithText, classesOf, click, settle, type, withDom } from './helpers/uiDom.js'

const NODES = [
  {
    id: 'orchestrator',
    kind: 'orchestrator',
    label: 'Orchestrator',
    harness: 'claude',
    model: 'opus',
    effort: 'high',
    parent: null,
    children: ['frontend', 'opencode', 'claude'],
    active: true,
    working: false,
  },
  {
    id: 'frontend',
    kind: 'sub',
    label: 'Frontend',
    harness: 'opencode',
    model: 'opencode-go/deepseek-v4.1-flash',
    effort: 'max',
    parent: 'orchestrator',
    children: ['opencode2'],
    active: true,
    working: false,
  },
  {
    id: 'opencode',
    kind: 'lane',
    label: 'OpenCode',
    harness: 'opencode',
    model: 'opencode-go/deepseek-v4.1-flash',
    effort: 'max',
    parent: 'orchestrator',
    active: true,
    working: true,
  },
  {
    id: 'opencode2',
    kind: 'lane',
    label: 'OpenCode 2',
    harness: 'opencode',
    model: 'opencode-go/deepseek-v4.1-flash',
    effort: 'max',
    parent: 'frontend',
    active: false,
    working: false,
  },
  {
    id: 'claude',
    kind: 'lane',
    label: 'Claude',
    harness: 'claude',
    model: 'opus',
    effort: 'high',
    parent: 'orchestrator',
    active: true,
    working: false,
  },
]

const FAMILY = { nodes: NODES, keys: [], proposals: [] }

const LANES = {
  lanes: [
    { key: 'opencode', name: 'OpenCode', harness: 'opencode', active: true },
    { key: 'opencode2', name: 'OpenCode 2', harness: 'opencode', active: false },
    { key: 'claude', name: 'Claude', harness: 'claude', active: true },
  ],
  max: 4,
  chosen: true,
}

const HARNESSES = {
  harnesses: [
    {
      key: 'claude',
      name: 'Claude Code',
      available: true,
      models: [{ id: 'sonnet', label: 'Sonnet' }],
      efforts: ['low', 'high'],
    },
    {
      key: 'opencode',
      name: 'OpenCode',
      available: true,
      models: [{ id: 'opencode-go/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' }],
      efforts: ['low', 'max'],
    },
    { key: 'agy', name: 'Antigravity', available: false, models: [], efforts: [] },
  ],
}

const ORCHESTRATORS = [
  { id: 'orchestrator', name: 'Orchestrator' },
  {
    id: 'frontend',
    name: 'Frontend',
    harness: 'opencode',
    model: 'opencode-go/deepseek-v4.1-flash',
    lanes: ['opencode2'],
  },
]

function makeClient() {
  const calls = { createLane: [], deleteLane: [], hideLane: [], setLadder: [], setActiveLanes: [] }
  const added = []
  const directModels = []
  const client = {
    family: async () => ({ ...FAMILY, nodes: [...FAMILY.nodes, ...added] }),
    lanes: async () => LANES,
    harnesses: async () => HARNESSES,
    harnessModels: async (options = {}) => {
      const harness = typeof options === 'string' ? options : options.harness ?? ''
      return { harness, models: harness === 'machineroom' ? [...directModels] : [] }
    },
    models: async () => ({ models: [] }),
    keys: async () => ({ keys: [] }),
    orchestrators: async () => ORCHESTRATORS,
    setLadder: async (payload) => {
      calls.setLadder.push(payload)
      return { ok: true }
    },
    createLane: async (payload) => {
      calls.createLane.push(payload)
      const id = `lane-${added.length + 2}`
      added.push({
        id,
        kind: 'lane',
        label: payload.name,
        harness: payload.harness,
        model: payload.model,
        effort: payload.effort,
        parent: 'orchestrator',
        active: true,
        working: false,
        custom: true,
      })
      return { key: id }
    },
    deleteLane: async (payload) => {
      calls.deleteLane.push(payload)
      return { ok: true }
    },
    hideLane: async (payload) => {
      calls.hideLane.push(payload)
      return { ok: true, hidden: payload?.key }
    },
    teams: async () => ({ teams: [] }),
    saveTeam: async () => ({ ok: true }),
    applyTeam: async () => ({ ok: true, applied: { lanes: [] }, dropped: { lanes: [] } }),
    deleteTeam: async () => ({ ok: true }),
    copyProjectTeam: async () => ({ ok: true, applied: { lanes: [] }, dropped: { lanes: [] } }),
    projects: async () => ({ current: null, recent: [] }),
    setActiveLanes: async (payload) => {
      calls.setActiveLanes.push(payload)
      return { ok: true }
    },
  }
  return { client, calls, added, directModels }
}

async function mount(root, client, props = {}) {
  await act(async () => {
    root.render(createElement(FamilyTree, { client, ...props }))
  })
  await act(async () => {})
}

function rows(container) {
  return container.querySelectorAll('.mr-family-node')
}

function rowByLabel(container, label) {
  return (
    rows(container).find((row) => {
      const found = row.querySelector('.mr-family-label')
      return found !== null && found.textContent === label
    }) ?? null
  )
}

async function chooseAction(root, region, label) {
  const trigger = region.querySelector('[aria-haspopup="menu"]')
  await click(root, trigger)
  await click(root, buttonWithText(trigger.ownerDocument.body.querySelector('[role="menu"]'), label))
}

async function cardFor(row) {
  const anchor = row.querySelector('.ui-hover-anchor')
  await act(async () => {
    anchor.focus()
    anchor.dispatchEvent({ type: 'focusin', bubbles: true })
  })
  const card = row.ownerDocument.body.querySelector(`[id="${anchor.getAttribute('aria-describedby')}"]`)
  expect(card.hasAttribute('hidden')).toBe(false)
  return card
}

function laneSwitch(container, label) {
  return rowByLabel(container, label).querySelector('[role="switch"]')
}

describe('FamilyTree rows', () => {
  it('shows the bridge sentence when the family read fails', async () => {
    const { client } = makeClient()
    client.family = async () => {
      throw new Error('The lane file is missing.')
    }
    client.lanes = async () => {
      throw new Error('The lane file is missing.')
    }
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      expect(container.textContent).toContain('The lane file is missing.')
      expect(container.querySelector('.mr-side-count').textContent).toBe('Lanes failed to load.')
    })
  })

  it('draws the orchestrator, the sub and the active lanes, with the rest under a more row', async () => {
    const { client } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      const tree = rows(container)
      expect(tree.map((row) => row.getAttribute('data-kind'))).toEqual([
        'orchestrator',
        'sub',
        'lane',
        'lane',
      ])
      expect(tree.map((row) => row.querySelector('.mr-family-label').textContent)).toEqual([
        'Orchestrator',
        'Frontend',
        'OpenCode',
        'Claude',
      ])
      expect(tree.map((row) => Number(row.getAttribute('data-depth')))).toEqual([0, 1, 1, 1])
      expect(container.querySelectorAll('.mr-family-kind')).toHaveLength(0)
      expect(container.querySelector('.mr-side-count').textContent).toBe('1 of 3 working')
      expect(container.querySelectorAll('[role="switch"], input[type="checkbox"]')).toHaveLength(0)
      expect(container.textContent).not.toContain('agy')

      const more = container.querySelector('.mr-family-more-head')
      expect(more.textContent).toBe('Show 1 more lane')
      expect(more.getAttribute('aria-expanded')).toBe('false')
      await click(root, more)
      expect(container.querySelector('.mr-family-more-head').getAttribute('aria-expanded')).toBe('true')
      expect(rowByLabel(container, 'OpenCode 2').getAttribute('data-depth')).toBe('2')
    })
  })

  it('marks a working lane and lets an off lane be turned on from its menu', async () => {
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      const working = rowByLabel(container, 'OpenCode')
      expect(classesOf(working.querySelector('.mr-family-dot'))).toEqual(['mr-family-dot', 'is-working'])

      await click(root, container.querySelector('.mr-family-more-head'))
      const off = rowByLabel(container, 'OpenCode 2')
      expect(off.getAttribute('data-kind')).toBe('lane')
      expect(classesOf(off.querySelector('.mr-family-dot'))).toContain('is-off')
      expect(off.querySelector('.mr-family-state').textContent).toBe('off')
      expect(classesOf(off.querySelector('.mr-family-row'))).toContain('is-off')
      await chooseAction(root, off, 'Turn on')
      expect(calls.setActiveLanes).toEqual([{ lanes: ['opencode', 'opencode2', 'claude'], confirmed: true }])
      await chooseAction(root, rowByLabel(container, 'Claude'), 'Turn off')
      expect(calls.setActiveLanes[1]).toEqual({ lanes: ['opencode'], confirmed: true })

      const sub = rowByLabel(container, 'Frontend')
      expect(classesOf(sub.querySelector('.mr-family-dot'))).toContain('is-idle')
    })
  })

  it('puts the name and status over harness and model, with shared trailing actions', async () => {
    const { client } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      const main = rowByLabel(container, 'Orchestrator')
      expect(main.querySelector('.mr-family-top').children.map((child) => String(child.className))).toEqual([
        'mr-family-dot is-idle',
        'mr-family-label mr-family-open',
        'mr-family-state mono',
      ])
      expect(main.querySelector('.mr-family-state').textContent).toBe('waiting')
      expect(main.querySelector('.ui-row-detail').textContent).toBe('claude · opus')
      expect(container.querySelector('.mr-family-header').querySelector('.mr-family-add').getAttribute('aria-label')).toBe('Add a lane')

      const lane = rowByLabel(container, 'OpenCode')
      const detail = lane.querySelector('.ui-row-detail')
      expect(detail.textContent).toBe('opencode · DeepSeek V4.1 Flash')
      expect(detail.getAttribute('title')).toBe(detail.textContent)
      expect(lane.querySelector('.mr-family-state').textContent).toBe('working')
      const trailing = lane.querySelector('.ui-row-trailing')
      expect(trailing.querySelector('.mr-family-chat').getAttribute('title')).toBe('Open conversation with OpenCode')
      expect(trailing.querySelector('[aria-haspopup="menu"]')).not.toBeNull()
    })
  })

  it('gives the lower half sidebar room for a full label', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    expect(css).toContain('grid-template-columns: clamp(280px, 22vw, 340px) minmax(0, 1fr) 280px')
    expect(css).toContain('.mr-family-row:is(:hover, :focus-within,')
    expect(css).toMatch(/\.mr-family-row\.is-off \.mr-family-label \{\s*opacity: 0\.55;/)
  })

  it('shows each orchestrator state word beside its dot', async () => {
    const { client } = makeClient()
    client.orchestrators = async () => [
      { id: 'orchestrator', state: 'paused' },
      { id: 'frontend', state: 'working' },
    ]
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      const main = rowByLabel(container, 'Orchestrator')
      expect(main.querySelector('.mr-family-state').textContent).toBe('waiting')
      expect((await cardFor(main)).textContent).toContain('Status paused')
      expect(classesOf(main.querySelector('.mr-family-dot'))).toContain('is-paused')
      const sub = rowByLabel(container, 'Frontend')
      expect(sub.querySelector('.mr-family-state').textContent).toBe('working')
      expect(classesOf(sub.querySelector('.mr-family-dot'))).toContain('is-working')
    })
  })

  it('shows the working task and latest completed run in the hover card', async () => {
    const { client } = makeClient()
    client.family = async () => ({
      ...FAMILY,
      nodes: FAMILY.nodes.map((node) => node.id === 'opencode' ? { ...node, mode: 'build' } : node),
    })
    client.runs = async () => ({
      last: [{ lane: 'opencode', startedAt: '2026-11-18T11:20:16Z', exitCode: 0 }],
      recent: [{ lane: 'opencode', startedAt: '2026-11-17T10:00:00Z', exitCode: 1 }],
    })
    await withDom(async ({ container, root }) => {
      await mount(root, client, {
        tasks: new Map([
          ['opencode', 'JC-19'],
          ['claude', 'JC-20'],
        ]),
      })
      const card = await cardFor(rowByLabel(container, 'OpenCode'))
      expect(card.querySelector('.ui-hovercard-title').textContent).toBe('OpenCode')
      expect(card.textContent).toContain('Effort max · Mode build')
      expect(card.textContent).toContain('Status working · JC-19')
      expect(card.textContent).toContain('Last run 11:20:16 · finished')
      expect(card.textContent).not.toContain('10:00:00')
      const idle = await cardFor(rowByLabel(container, 'Claude'))
      expect(idle.textContent).toContain('Status idle')
      expect(idle.textContent).not.toContain('JC-20')
    })
  })

  it('reads lane tasks from the bridge when no task map is passed', async () => {
    const { client } = makeClient()
    client.agents = async () => [
      { id: 'agent-opencode', key: 'opencode', name: 'OpenCode', adapterType: 'opencode' },
    ]
    client.issues = async () => [{ id: 'issue-1', identifier: 'JC-19' }]
    client.liveRuns = async () => [
      {
        id: 'run-1',
        status: 'running',
        agentId: 'agent-opencode',
        issueId: 'issue-1',
        startedAt: 1,
      },
    ]
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      expect((await cardFor(rowByLabel(container, 'OpenCode'))).textContent).toContain('Status working · JC-19')
    })
  })

  it('opens the main, sub and lane conversations from their chat buttons', async () => {
    const { client } = makeClient()
    await withDom(async ({ container, dom, root }) => {
      await mount(root, client)
      const seen = []
      function onOpen(event) {
        seen.push(event.detail)
      }
      dom.window.addEventListener('machineroom:open-chat', onOpen)
      try {
        expect(container.querySelectorAll('.mr-family-chat')).toHaveLength(4)
        await click(root, rowByLabel(container, 'Orchestrator').querySelector('.mr-family-chat'))
        await click(root, rowByLabel(container, 'Frontend').querySelector('.mr-family-chat'))
        await click(root, rowByLabel(container, 'OpenCode').querySelector('.mr-family-chat'))
        await click(root, rowByLabel(container, 'Claude').querySelector('.mr-family-chat'))
        expect(seen).toEqual([
          { id: 'orchestrator' },
          { id: 'frontend' },
          { lane: 'opencode' },
          { lane: 'claude' },
        ])
      } finally {
        dom.window.removeEventListener('machineroom:open-chat', onOpen)
      }
    })
  })

  it('keeps Save off a lane from lanes.json and points at the file', async () => {
    const { client } = makeClient()
    client.updateLane = async () => ({ ok: true })
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      await click(root, rowByLabel(container, 'OpenCode').querySelector('.mr-family-open'))
      const editor = container.querySelector('.mr-family-editor')
      expect(buttonWithText(editor, 'Save')).toBeNull()
      expect(editor.textContent).toContain('Edit this agent in lanes.json.')
    })
  })

  it('offers Save on a lane the owner made', async () => {
    const { client } = makeClient()
    client.updateLane = async () => ({ ok: true })
    const nodes = FAMILY.nodes.map((node) => (node.id === 'opencode' ? { ...node, custom: true } : node))
    client.family = async () => ({ ...FAMILY, nodes })
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      await click(root, rowByLabel(container, 'OpenCode').querySelector('.mr-family-open'))
      const editor = container.querySelector('.mr-family-editor')
      const save = buttonWithText(editor, 'Save')
      expect(save.getAttribute('disabled')).toBeNull()
    })
  })

  it('lists the other active lanes as backup lanes and saves the chosen one', async () => {
    const { client } = makeClient()
    const calls = []
    client.updateLane = async (payload) => {
      calls.push(payload)
      return { ok: true }
    }
    client.laneBackups = async () => ({})
    const nodes = FAMILY.nodes.map((node) => (node.id === 'opencode' ? { ...node, custom: true } : node))
    client.family = async () => ({ ...FAMILY, nodes })
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      await click(root, rowByLabel(container, 'OpenCode').querySelector('.mr-family-open'))
      const editor = container.querySelector('.mr-family-editor')
      const picker = editor.querySelector('select[aria-label="Backup lane for OpenCode"]')
      expect([...picker.querySelectorAll('option')].map((option) => option.textContent)).toEqual(['None', 'Claude'])

      await type(root, picker, 'claude')
      await click(root, buttonWithText(editor, 'Save'))
      const dialog = container.querySelector('[role="dialog"]')
      expect(dialog.textContent).toContain('Backup lane claude')
      await click(root, buttonWithText(dialog, 'Save'))
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({ key: 'opencode', fallback: 'claude', confirmed: true })
    })
  })

  it('selects lanes by switch and row, and supports Clear, Escape and Done', async () => {
    const { client } = makeClient()
    await withDom(async ({ container, root, dom }) => {
      await mount(root, client)
      const header = container.querySelector('.mr-family-header')
      expect(laneSwitch(container, 'OpenCode')).toBeNull()
      await chooseAction(root, header, 'Select lanes')
      const opencode = laneSwitch(container, 'OpenCode')
      const claude = laneSwitch(container, 'Claude')
      expect(opencode.getAttribute('aria-label')).toBe('Select OpenCode')
      expect(claude.getAttribute('aria-label')).toBe('Select Claude')
      expect(opencode.getAttribute('aria-checked')).toBe('false')
      await click(root, opencode)
      await click(root, rowByLabel(container, 'Claude').querySelector('.mr-family-label'))
      expect(opencode.getAttribute('aria-checked')).toBe('true')
      expect(claude.getAttribute('aria-checked')).toBe('true')
      expect(container.textContent).toContain('2 selected')
      expect(buttonWithText(container, 'Make sub orchestrator').hasAttribute('disabled')).toBe(false)

      await click(root, buttonWithText(container, 'Clear'))
      expect(container.textContent).toContain('0 selected')
      expect(opencode.getAttribute('aria-checked')).toBe('false')
      expect(buttonWithText(container, 'Make sub orchestrator').hasAttribute('disabled')).toBe(true)
      await act(async () => {
        dom.window.dispatchEvent({ type: 'keydown', key: 'Escape' })
      })
      expect(container.querySelector('.mr-family-selection')).toBeNull()
      expect(dom.document.activeElement).toBe(header.querySelector('[aria-haspopup="menu"]'))

      await chooseAction(root, header, 'Add sub orchestrator…')
      await click(root, laneSwitch(container, 'Claude'))
      await click(root, buttonWithText(container, 'Done'))
      expect(container.querySelector('.mr-family-selection')).toBeNull()
      expect(laneSwitch(container, 'Claude')).toBeNull()
    })
  })

  it('keeps the current selection when a lane menu adds a lane to the sub form', async () => {
    const { client } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      await click(root, container.querySelector('.mr-family-more-head'))
      await chooseAction(root, container.querySelector('.mr-family-header'), 'Select lanes')
      for (const label of ['OpenCode', 'OpenCode 2']) {
        await click(root, laneSwitch(container, label))
      }
      expect(container.textContent).toContain('2 selected')
      await chooseAction(root, rowByLabel(container, 'Claude'), 'Add sub orchestrator…')
      expect(container.textContent).toContain('3 selected')
      expect(container.querySelector('.mr-family-sub-form')).not.toBeNull()
    })
  })

  it('names the sub that a new sub takes its last lane from', async () => {
    const { client } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      await click(root, container.querySelector('.mr-family-more-head'))
      await chooseAction(root, container.querySelector('.mr-family-header'), 'Select lanes')
      await click(root, laneSwitch(container, 'OpenCode 2'))
      await click(root, buttonWithText(container, 'Make sub orchestrator'))
      const form = container.querySelector('.mr-family-sub-form')
      const label = form.querySelector('input[aria-label="Sub orchestrator label"]')
      await act(async () => {
        label.focus()
        label.dispatchEvent({ type: 'focusin', bubbles: true, cancelable: true })
        label.value = 'Platform'
        label.dispatchEvent({ type: 'keyup', bubbles: true, cancelable: true })
      })
      await act(async () => {
        form.dispatchEvent({ type: 'submit', bubbles: true, cancelable: true })
      })
      await settle()

      const card = container.querySelector('.mr-side-confirm-card')
      expect(card.textContent).toContain('Add "Platform" to lead 1 agent?')
      expect(card.textContent).toContain('Frontend goes away.')
    })
  })

  it('removes a lanes.json lane from this project from its action menu behind a confirm', async () => {
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client, { project: '/work/machine-room' })
      await click(root, container.querySelector('.mr-family-more-head'))
      expect(rowByLabel(container, 'OpenCode 2').querySelector('[aria-haspopup="menu"]')).not.toBeNull()
      await chooseAction(root, rowByLabel(container, 'OpenCode'), 'Delete…')
      const card = container.querySelector('.mr-side-confirm-card')
      expect(card.textContent).toContain(
        'Remove OpenCode from machine-room? It stays in your other projects.'
      )
      await click(root, buttonWithText(card, 'Remove'))
      expect(calls.hideLane).toEqual([{ key: 'opencode', confirmed: true }])
      expect(calls.deleteLane).toEqual([])
    })
  })

  it('keeps the hide card for an owner-made lane', async () => {
    const { client, calls } = makeClient()
    await client.createLane({ name: 'Writer', harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash', confirmed: true })
    await withDom(async ({ container, root }) => {
      await mount(root, client, { project: '/work/machine-room' })
      await chooseAction(root, rowByLabel(container, 'Writer'), 'Delete…')
      const card = container.querySelector('.mr-side-confirm-card')
      expect(card.textContent).toContain(
        'Hide Writer in machine-room? It stays in your other projects.'
      )
      await click(root, buttonWithText(card, 'Hide'))
      expect(calls.hideLane).toEqual([{ key: 'lane-2', confirmed: true }])
      expect(calls.deleteLane).toEqual([])
    })
  })

  it('opens the add lane form under a sub from its action menu', async () => {
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      const sub = rowByLabel(container, 'Frontend')
      await chooseAction(root, sub, 'Add a lane under this…')
      const form = sub.querySelector('.mr-family-child')
      await type(root, form.querySelector('[aria-label="New agent label"]'), 'Writer')
      await act(async () => {
        form.dispatchEvent({ type: 'submit', bubbles: true, cancelable: true })
      })
      expect(container.querySelector('.mr-side-confirm-card').textContent).toContain('Create "Writer" under Frontend?')
      expect(calls.createLane).toHaveLength(0)
    })
  })

  it('removes a sub orchestrator from its action menu and returns its lanes', async () => {
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      await chooseAction(root, rowByLabel(container, 'Frontend'), 'Delete…')
      const card = container.querySelector('.mr-side-confirm-card')
      expect(card.textContent).toContain('Remove "Frontend"? Its agents return to the orchestrator.')
      await click(root, buttonWithText(card, 'Remove'))
      expect(calls.setLadder).toEqual([{ subs: [] }])
    })
  })

  it('starts the add child form on OpenCode and creates an opencode lane, never an agy lane', async () => {
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      await click(root, container.querySelector('.mr-family-add'))

      const form = container.querySelector('.mr-family-child')
      expect(form).not.toBeNull()
      const harnessButtons = form.querySelectorAll('.mr-side-harness')
      expect(harnessButtons.map((button) => button.textContent.trim())).toEqual([
        'Claude Code',
        'OpenCode',
        'Direct API',
      ])
      const opencode = harnessButtons.find((button) => button.textContent.trim() === 'OpenCode')
      expect(classesOf(opencode)).toContain('is-on')
      expect(opencode.getAttribute('aria-pressed')).toBe('true')

      const label = form.querySelector('input[aria-label="New agent label"]')
      await act(async () => {
        label.focus()
        label.dispatchEvent({ type: 'focusin', bubbles: true, cancelable: true })
        label.value = 'Writer'
        label.dispatchEvent({ type: 'keyup', bubbles: true, cancelable: true })
      })
      await act(async () => {
        form.dispatchEvent({ type: 'submit', bubbles: true, cancelable: true })
      })

      const card = container.querySelector('.mr-side-confirm-card')
      expect(card.textContent).toContain('Create "Writer" under Orchestrator?')
      await click(root, buttonWithText(card, 'Create'))

      expect(calls.createLane).toEqual([
        {
          name: 'Writer',
          harness: 'opencode',
          model: '',
          effort: 'max',
          mode: 'auto',
          confirmed: true,
        },
      ])
      expect(calls.createLane.some((payload) => payload.harness === 'agy')).toBe(false)
      const writer = rowByLabel(container, 'Writer')
      expect(writer).not.toBeNull()
      expect(writer.getAttribute('data-kind')).toBe('lane')
      expect(writer.querySelector('.ui-row-detail').textContent).toContain('opencode')
    })
  })

  it('lists the Direct API endpoint models and drops the key slot in Add child', async () => {
    const { client, directModels } = makeClient()
    directModels.push({ id: 'OpenRouter/flash' })
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      await click(root, container.querySelector('.mr-family-add'))
      const form = container.querySelector('.mr-family-child')
      const direct = form
        .querySelectorAll('.mr-side-harness')
        .find((button) => button.textContent.trim() === 'Direct API')
      await click(root, direct)
      await settle()

      expect(form.textContent).not.toContain('Key slot')
      expect(buttonWithText(form, 'Add key')).toBeNull()
      const trigger = form.querySelector('button[aria-label="New agent model"]')
      expect(trigger).not.toBeNull()
      expect(trigger.textContent).toContain('flash')
      expect(trigger.textContent).not.toContain('OpenRouter')
      await click(root, trigger)
      const option = container.querySelectorAll('.mr-picker-row').find((row) => row.querySelector('.mr-picker-pick')?.getAttribute('title') === 'OpenRouter/flash')
      expect(option).not.toBeNull()
      expect(buttonWithText(form, 'Create').getAttribute('disabled')).toBeNull()
    })
  })

  it('says to add a Direct API key and opens Settings when there is no endpoint', async () => {
    const { client } = makeClient()
    await withDom(async ({ container, dom, root }) => {
      const seen = []
      function onOpen() {
        seen.push('settings')
      }
      dom.window.addEventListener('machineroom:open-settings', onOpen)
      try {
        await mount(root, client)
        await click(root, container.querySelector('.mr-family-add'))
        const form = container.querySelector('.mr-family-child')
        const direct = form
          .querySelectorAll('.mr-side-harness')
          .find((button) => button.textContent.trim() === 'Direct API')
        await click(root, direct)
        await settle()

        expect(form.textContent).toContain(DIRECT_KEY_PROBLEM)
        expect(buttonWithText(form, 'Refresh models')).not.toBeNull()
        expect(buttonWithText(form, 'Create').getAttribute('disabled')).not.toBeNull()
        await click(root, buttonWithText(form, 'Open Settings'))
        expect(seen).toEqual(['settings'])
      } finally {
        dom.window.removeEventListener('machineroom:open-settings', onOpen)
      }
    })
  })
})

describe('FamilyTeams', () => {
  function makeTeamClient(overrides = {}) {
    const calls = { applyTeam: [], saveTeam: [], deleteTeam: [], copyProjectTeam: [], subscribe: [] }
    const client = {
      teams: async () => ({ teams: [{ name: 'Weekend', lanes: ['opencode'] }] }),
      projects: async () => ({ current: null, recent: [{ path: '/work/other', name: 'other' }] }),
      subscribe: (listener) => {
        calls.subscribe.push(listener)
        return () => {}
      },
      applyTeam: async (payload) => {
        calls.applyTeam.push(payload)
        return { ok: true, dropped: { lanes: ['gone', 'old'] }, ladderError: 'Two sub orchestrators cannot lead a lane.' }
      },
      saveTeam: async (payload) => {
        calls.saveTeam.push(payload)
        return { ok: true }
      },
      deleteTeam: async (payload) => {
        calls.deleteTeam.push(payload)
        return { ok: true }
      },
      copyProjectTeam: async (payload) => {
        calls.copyProjectTeam.push(payload)
        return { ok: true, dropped: { lanes: [] } }
      },
      ...overrides,
    }
    return { client, calls }
  }

  async function mountTeams(root, client, container, open = true) {
    await act(async () => {
      root.render(createElement(FamilyTeams, { client, project: '/work/machine-room' }))
    })
    await act(async () => {})
    if (open && container.querySelector('button[aria-expanded="false"]')) {
      await click(root, container.querySelector('button[aria-expanded="false"]'))
    }
  }

  it('shows a failed read while Teams stays closed', async () => {
    const { client } = makeTeamClient({ teams: async () => { throw new Error('Teams could not load.') } })
    await withDom(async ({ container, root }) => {
      await mountTeams(root, client, container, false)
      expect(container.querySelector('button[aria-expanded="false"]')).not.toBeNull()
      expect(container.querySelector('[role="alert"]').textContent).toBe('Teams could not load.')
      expect(container.querySelector('input[aria-label="Team name"]')).toBeNull()
    })
  })

  it('starts closed, shows the count and remembers the choice', async () => {
    const { client } = makeTeamClient({ teams: async () => ({ teams: [{ name: 'One' }, { name: 'Two' }] }) })
    await withDom(async ({ container, root, dom }) => {
      await mountTeams(root, client, container, false)
      let head = container.querySelector('button[aria-expanded="false"]')
      expect(head.querySelector('.mr-side-head-title').textContent).toBe('Teams')
      expect(head.querySelector('.mr-side-count').textContent).toBe('2')
      expect(container.querySelector('input[aria-label="Team name"]')).toBeNull()
      await click(root, head)
      expect(container.querySelector('input[aria-label="Team name"]')).not.toBeNull()
      expect(dom.window.localStorage.getItem('machineroom:teams-open')).toBe('true')
      await act(async () => root.render(null))
      await mountTeams(root, client, container, false)
      head = container.querySelector('button[aria-expanded="true"]')
      expect(head).not.toBeNull()
      await click(root, head)
      expect(dom.window.localStorage.getItem('machineroom:teams-open')).toBe('false')
    })
  })

  it('puts the agents before Teams and Build a team in the sidebar', async () => {
    const { client } = makeClient()
    client.teams = async () => ({ teams: [] })
    client.setAgentLabel = async () => ({ ok: true })
    await withDom(async ({ container, root, dom }) => {
      dom.window.localStorage.setItem('machineroom.settings', JSON.stringify({ sidebarTab: 'agents' }))
      await act(async () => root.render(createElement(Sidebar, { client, live: true })))
      await settle()
      const parts = container.querySelector('.mr-side-agents').children
      expect([...parts].map((part) => part.className)).toEqual(['mr-family', 'mr-teams', 'mr-team'])
      await chooseAction(root, container.querySelector('.mr-family-header'), 'Build a team…')
      expect(container.querySelector('.mr-team-form')).not.toBeNull()
    })
  })

  it('applies the chosen team behind its card and shows the dropped lanes and the ladder sentence', async () => {
    const { client, calls } = makeTeamClient()
    await withDom(async ({ container, root }) => {
      await mountTeams(root, client, container)
      expect(container.querySelector('.mr-teams')).not.toBeNull()
      expect(container.querySelector('select[aria-label="Saved team"]').querySelectorAll('option')).toHaveLength(1)

      await click(root, buttonWithText(container, 'Apply'))
      const card = container.querySelector('.mr-side-confirm-card')
      expect(card.textContent).toContain(
        "Apply Weekend to machine-room? Its lanes, labels and sub orchestrators replace this project's."
      )
      await click(root, buttonWithText(card, 'Apply'))

      expect(calls.applyTeam).toEqual([{ name: 'Weekend', confirmed: true }])
      expect(container.textContent).toContain('Applied Weekend.')
      expect(container.textContent).toContain('Dropped gone, old.')
      expect(container.textContent).toContain('Two sub orchestrators cannot lead a lane.')
    })
  })

  it('saves and deletes a team from their cards', async () => {
    const { client, calls } = makeTeamClient()
    await withDom(async ({ container, root }) => {
      await mountTeams(root, client, container)
      const input = container.querySelector('input[aria-label="Team name"]')
      await type(root, input, 'Night')
      await act(async () => {
        container.querySelector('.mr-teams-form').dispatchEvent({
          type: 'submit',
          bubbles: true,
          cancelable: true,
        })
      })
      let card = container.querySelector('.mr-side-confirm-card')
      expect(card.textContent).toContain('Save "Night" as a team?')
      await click(root, buttonWithText(card, 'Save team'))
      expect(calls.saveTeam).toEqual([{ name: 'Night', confirmed: true }])

      await click(root, buttonWithText(container, 'Delete'))
      card = container.querySelector('.mr-side-confirm-card')
      expect(card.textContent).toContain('Delete "Weekend"? This cannot be undone.')
      await click(root, buttonWithText(card, 'Delete'))
      expect(calls.deleteTeam).toEqual([{ name: 'Weekend', confirmed: true }])
    })
  })

  it('copies another project team from its card', async () => {
    const { client, calls } = makeTeamClient()
    await withDom(async ({ container, root }) => {
      await mountTeams(root, client, container)
      const select = container.querySelector('select[aria-label="Copy from project"]')
      await act(async () => {
        select.value = '/work/other'
        select.dispatchEvent({ type: 'change', bubbles: true, cancelable: true })
      })
      await click(root, buttonWithText(container, 'Copy'))
      const card = container.querySelector('.mr-side-confirm-card')
      expect(card.textContent).toContain('Copy the team of other into machine-room?')
      await click(root, buttonWithText(card, 'Copy'))
      expect(calls.copyProjectTeam).toEqual([{ path: '/work/other', confirmed: true }])
      expect(container.textContent).toContain('Applied other.')
    })
  })

  it('reads the teams again on a family notice', async () => {
    let rows = [{ name: 'Weekend', lanes: ['opencode'] }]
    let listener = null
    const client = {
      teams: async () => ({ teams: rows }),
      projects: async () => ({ current: null, recent: [] }),
      subscribe: (next) => {
        listener = next
        return () => {}
      },
    }
    await withDom(async ({ container, root }) => {
      await mountTeams(root, client, container)
      const select = container.querySelector('select[aria-label="Saved team"]')
      expect(select.querySelectorAll('option')).toHaveLength(1)
      rows = [{ name: 'Weekend', lanes: ['opencode'] }, { name: 'Night', lanes: ['opencode'] }]
      await act(async () => {
        listener({ topic: 'family' })
        await Promise.resolve()
      })
      await act(async () => {})
      const options = container.querySelector('select[aria-label="Saved team"]').querySelectorAll('option')
      expect(options).toHaveLength(2)
      expect(options[1].textContent).toBe('Night')
    })
  })

  it('shows nothing without the teams method', async () => {
    await withDom(async ({ container, root }) => {
      await mountTeams(root, makeTeamClient({ teams: undefined }).client, container, false)
      expect(container.querySelector('.mr-teams')).toBeNull()
    })
  })
})

describe('FamilyTeam', () => {
  it('previews Team 1 with the first free lane and saves the ladder and its label', async () => {
    const { client, calls } = makeClient()
    const labels = []
    client.setAgentLabel = async (payload) => {
      labels.push(payload)
      return { ok: true }
    }
    await withDom(async ({ container, root, dom }) => {
      await act(async () => {
        root.render(createElement(FamilyTeam, { client }))
      })
      await act(async () => {})

      const head = container.querySelector('.mr-team').querySelector('.mr-side-head')
      expect(head.textContent).toContain('Build a team')
      await click(root, head)

      const form = container.querySelector('.mr-team-form')
      expect(form).not.toBeNull()
      expect(container.querySelector('.mr-team-preview-name').textContent).toBe('Team 1')
      expect(container.querySelector('.mr-team-preview-lanes').textContent).toBe('OpenCode')
      expect(buttonWithText(form, 'Save')).not.toBeNull()

      await act(async () => {
        form.dispatchEvent({ type: 'submit', bubbles: true, cancelable: true })
      })
      const card = container.querySelector('.mr-side-confirm-card')
      expect(card.textContent).toContain('Build 1 sub orchestrator?')
      expect(card.textContent).toContain('Team 1')
      expect(card.textContent).toContain('OpenCode')
      const primary = buttonWithText(card, 'Build the team')
      expect(dom.document.activeElement).toBe(primary)
      const cancel = buttonWithText(card, 'Cancel')
      cancel.focus()
      const tab = { type: 'keydown', key: 'Tab', bubbles: true, cancelable: true }
      await act(async () => {
        dom.window.dispatchEvent(tab)
      })
      expect(dom.document.activeElement).toBe(primary)
      expect(tab.defaultPrevented).toBe(true)
      await click(root, primary)

      expect(calls.setLadder).toHaveLength(1)
      expect(calls.setLadder[0].subs).toEqual([
        expect.objectContaining({ id: 'frontend', lanes: ['opencode2'] }),
        expect.objectContaining({
          id: 'team-1',
          name: 'Team 1',
          harness: 'opencode',
          model: '',
          lanes: ['opencode'],
          scope: ['**'],
          restricted: false,
          setBy: 'owner',
        }),
      ])
      expect(labels).toEqual([{ id: 'team-1', label: 'Team 1', confirmed: true }])
      expect(container.querySelector('.mr-team-form')).toBeNull()
    })
  })
})

describe('FamilyTree session rows', () => {
  it('lists the session that started a lane under the orchestrator', async () => {
    const { client } = makeClient()
    client.agents = async () => [
      { id: 'agent-claude-session', key: 'claude-session', name: 'Claude Code session', harness: 'claude', sessionReader: true },
    ]
    client.liveRuns = async () => [
      {
        runId: 'run-opencode-P85-20261112-220000',
        lane: 'opencode',
        status: 'running',
        startedAt: new Date().toISOString(),
        startedBy: { harness: 'claude', session: 'session-a' },
      },
    ]
    client.runs = async () => ({ recent: [] })
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      await act(async () => {})
      const row = rowByLabel(container, 'Claude Code session')
      expect(row).not.toBe(null)
      expect(row.getAttribute('data-kind')).toBe('session')
      expect(row.textContent).toContain('working')
      expect((await cardFor(row)).textContent).toContain('started opencode')
      const orchestrator = rowByLabel(container, 'Orchestrator')
      expect(orchestrator).not.toBe(null)
      const all = Array.from(rows(container))
      expect(all[all.indexOf(orchestrator) + 1]).toBe(row)
    })
  })
})
