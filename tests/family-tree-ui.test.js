import { readFileSync } from 'node:fs'
import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import FamilyTeam from '../src/ui/FamilyTeam.jsx'
import { FamilyTeams, FamilyTree } from '../src/ui/FamilyTree.jsx'
import { DIRECT_KEY_PROBLEM, LANES_JSON_SAVE_PROBLEM } from '../src/ui/family.js'
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
      expect(tree[0].querySelector('.mr-family-kind').textContent).toBe('orchestrator')
      expect(tree[1].querySelector('.mr-family-kind').textContent).toBe('sub')
      expect(tree[2].querySelector('.mr-family-kind').textContent).toBe('lane')
      expect(container.querySelector('.mr-side-count').textContent).toBe('2 of 3 lanes in this project')
      expect(container.querySelectorAll('.mr-family-check')).toHaveLength(2)
      expect(container.querySelectorAll('.mr-family-check-space')).toHaveLength(2)
      expect(container.textContent).not.toContain('agy')

      const more = container.querySelector('.mr-family-more-head')
      expect(more.textContent).toContain('1 more lane')
      expect(more.getAttribute('aria-expanded')).toBe('false')
      await click(root, more)
      expect(container.querySelector('.mr-family-more-head').getAttribute('aria-expanded')).toBe('true')
      expect(rowByLabel(container, 'OpenCode 2')).not.toBeNull()
      expect(container.querySelectorAll('.mr-family-check')).toHaveLength(3)
    })
  })

  it('marks a working lane and keeps a turned-off lane with an off dot', async () => {
    const { client } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      const working = rowByLabel(container, 'OpenCode')
      expect(classesOf(working.querySelector('.mr-family-dot'))).toEqual(['mr-family-dot', 'is-working'])

      await click(root, container.querySelector('.mr-family-more-head'))
      const off = rowByLabel(container, 'OpenCode 2')
      expect(off.getAttribute('data-kind')).toBe('lane')
      expect(classesOf(off.querySelector('.mr-family-dot'))).toContain('is-off')
      const toggle = off.querySelector('.mr-side-switch')
      expect(toggle.getAttribute('aria-checked')).toBe('false')
      expect(toggle.getAttribute('aria-label')).toBe('Turn on OpenCode 2')

      const sub = rowByLabel(container, 'Frontend')
      expect(classesOf(sub.querySelector('.mr-family-dot'))).toContain('is-idle')
    })
  })

  it('gives the label the first line and the state, meta and controls the second', async () => {
    const { client } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client, {
        tasks: new Map([['opencode', 'JC-19']]),
      })
      const main = rowByLabel(container, 'Orchestrator')
      const top = main.querySelector('.mr-family-top')
      expect(top.children.map((child) => String(child.className))).toEqual([
        'mr-family-dot is-idle',
        'mr-family-label',
      ])
      const under = main.querySelector('.mr-family-under')
      expect(under).not.toBeNull()
      expect(under.querySelector('.mr-family-state').textContent).toBe('waiting')
      expect(under.querySelector('.mr-family-kind').textContent).toBe('orchestrator')
      expect(under.querySelector('.mr-family-meta').textContent).toBe('claude · opus · high')
      expect(under.querySelector('.mr-family-add').textContent).toBe('+')
      expect(under.querySelector('.mr-family-chat')).not.toBeNull()

      const lane = rowByLabel(container, 'OpenCode')
      const laneTop = lane.querySelector('.mr-family-top')
      expect(laneTop.children.map((child) => String(child.className))).toEqual([
        'mr-family-dot is-working',
        'mr-family-label',
      ])
      const laneUnder = lane.querySelector('.mr-family-under')
      expect(laneUnder.querySelector('.mr-family-state').textContent).toBe('JC-19')
      expect(laneUnder.querySelector('.mr-side-switch')).not.toBeNull()
      expect(laneUnder.querySelector('.mr-family-trash')).not.toBeNull()
      expect(laneUnder.querySelector('.mr-family-add')).not.toBeNull()
      expect(laneUnder.querySelector('.mr-family-chat')).toBeNull()
      expect(lane.querySelector('.mr-family-row').children.map((child) => String(child.className))).toEqual([
        'mr-family-indent',
        'mr-family-check',
        'mr-family-main',
      ])
    })
  })

  it('gives the lower half sidebar room for a full label', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    expect(css).toContain('grid-template-columns: clamp(280px, 22vw, 340px) minmax(0, 1fr) 280px')
    expect(css).toContain('.mr-family-under {')
    expect(css).toContain('.mr-family-actions {')
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
      expect(main.querySelector('.mr-family-state').textContent).toBe('paused')
      expect(classesOf(main.querySelector('.mr-family-dot'))).toContain('is-paused')
      const sub = rowByLabel(container, 'Frontend')
      expect(sub.querySelector('.mr-family-state').textContent).toBe('working')
      expect(classesOf(sub.querySelector('.mr-family-dot'))).toContain('is-working')
    })
  })

  it('shows the task of a working lane and none for an idle lane', async () => {
    const { client } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client, {
        tasks: new Map([
          ['opencode', 'JC-19'],
          ['claude', 'JC-20'],
        ]),
      })
      expect(rowByLabel(container, 'OpenCode').querySelector('.mr-family-state').textContent).toBe('JC-19')
      expect(rowByLabel(container, 'Claude').querySelector('.mr-family-state')).toBeNull()
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
      expect(rowByLabel(container, 'OpenCode').querySelector('.mr-family-state').textContent).toBe('JC-19')
    })
  })

  it('opens the main and sub chats from their chat buttons', async () => {
    const { client } = makeClient()
    await withDom(async ({ container, dom, root }) => {
      await mount(root, client)
      const seen = []
      function onOpen(event) {
        seen.push(event.detail)
      }
      dom.window.addEventListener('machineroom:open-chat', onOpen)
      try {
        expect(container.querySelectorAll('.mr-family-chat')).toHaveLength(2)
        await click(root, rowByLabel(container, 'Orchestrator').querySelector('.mr-family-chat'))
        await click(root, rowByLabel(container, 'Frontend').querySelector('.mr-family-chat'))
        expect(seen).toEqual([{ id: 'orchestrator' }, { id: 'frontend' }])
      } finally {
        dom.window.removeEventListener('machineroom:open-chat', onOpen)
      }
    })
  })

  it('offers Save on the lane editor only for a lane the owner made', async () => {
    const { client } = makeClient()
    client.updateLane = async () => ({ ok: true })
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      await click(root, rowByLabel(container, 'OpenCode').querySelector('.mr-family-open'))
      const editor = container.querySelector('.mr-family-editor')
      const save = buttonWithText(editor, 'Save')
      expect(save.getAttribute('disabled')).not.toBeNull()
      expect(editor.textContent).toContain(LANES_JSON_SAVE_PROBLEM)
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
      expect(editor.textContent).not.toContain(LANES_JSON_SAVE_PROBLEM)
    })
  })

  it('counts the checked lanes from their selection checkboxes and clears them', async () => {
    const { client } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      const opencode = rowByLabel(container, 'OpenCode').querySelector('.mr-family-check')
      const claude = rowByLabel(container, 'Claude').querySelector('.mr-family-check')
      expect(opencode.getAttribute('aria-label')).toBe('Select OpenCode')
      expect(claude.getAttribute('aria-label')).toBe('Select Claude')

      await act(async () => {
        opencode.checked = true
        opencode.click()
      })
      await act(async () => {
        claude.checked = true
        claude.click()
      })
      expect(container.textContent).toContain('2 selected')
      expect(buttonWithText(container, 'Add sub orchestrator')).not.toBeNull()

      await click(root, buttonWithText(container, 'Clear'))
      expect(container.textContent).not.toContain('2 selected')
      expect(container.querySelector('.mr-family-selection')).toBeNull()
    })
  })

  it('keeps every checked lane when the plus on a lane opens the form', async () => {
    const { client } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      await click(root, container.querySelector('.mr-family-more-head'))
      for (const label of ['OpenCode', 'OpenCode 2']) {
        const check = rowByLabel(container, label).querySelector('.mr-family-check')
        await act(async () => {
          check.checked = true
          check.click()
        })
      }
      expect(container.textContent).toContain('2 selected')
      await click(root, rowByLabel(container, 'Claude').querySelector('.mr-family-add'))
      expect(container.textContent).toContain('3 selected')
    })
  })

  it('names the sub that a new sub takes its last lane from', async () => {
    const { client } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      await click(root, container.querySelector('.mr-family-more-head'))
      const check = rowByLabel(container, 'OpenCode 2').querySelector('.mr-family-check')
      await act(async () => {
        check.checked = true
        check.click()
      })
      await click(root, buttonWithText(container, 'Add sub orchestrator'))
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

  it('removes a lanes.json lane from this project from its trash button behind a confirm', async () => {
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client, { project: '/work/machine-room' })
      expect(container.querySelectorAll('.mr-family-trash')).toHaveLength(3)
      expect(rowByLabel(container, 'Orchestrator').querySelector('.mr-family-trash')).toBeNull()

      const trash = rowByLabel(container, 'OpenCode').querySelector('.mr-family-trash')
      expect(trash.getAttribute('aria-label')).toBe('Remove OpenCode')
      await click(root, container.querySelector('.mr-family-more-head'))
      expect(rowByLabel(container, 'OpenCode 2').querySelector('.mr-family-trash')).not.toBeNull()

      await click(root, trash)
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
      const trash = rowByLabel(container, 'Writer').querySelector('.mr-family-trash')
      expect(trash.getAttribute('aria-label')).toBe('Hide Writer')

      await click(root, trash)
      const card = container.querySelector('.mr-side-confirm-card')
      expect(card.textContent).toContain(
        'Hide Writer in machine-room? It stays in your other projects.'
      )
      await click(root, buttonWithText(card, 'Hide'))
      expect(calls.hideLane).toEqual([{ key: 'lane-2', confirmed: true }])
      expect(calls.deleteLane).toEqual([])
    })
  })

  it('removes a sub orchestrator from its trash button and returns its lanes', async () => {
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      const trash = rowByLabel(container, 'Frontend').querySelector('.mr-family-trash')
      expect(trash.getAttribute('aria-label')).toBe('Delete Frontend')

      await click(root, trash)
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
      await click(root, rowByLabel(container, 'Orchestrator').querySelector('.mr-family-add'))

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
          model: 'opencode-go/deepseek-v4.1-flash',
          effort: 'max',
          confirmed: true,
        },
      ])
      expect(calls.createLane.some((payload) => payload.harness === 'agy')).toBe(false)
      const writer = rowByLabel(container, 'Writer')
      expect(writer).not.toBeNull()
      expect(writer.getAttribute('data-kind')).toBe('lane')
      expect(writer.querySelector('.mr-family-meta').textContent).toContain('opencode')
    })
  })

  it('lists the Direct API endpoint models and drops the key slot in Add child', async () => {
    const { client, directModels } = makeClient()
    directModels.push({ id: 'OpenRouter/flash', label: 'flash (OpenRouter)' })
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      await click(root, rowByLabel(container, 'Orchestrator').querySelector('.mr-family-add'))
      const form = container.querySelector('.mr-family-child')
      const direct = form
        .querySelectorAll('.mr-side-harness')
        .find((button) => button.textContent.trim() === 'Direct API')
      await click(root, direct)
      await settle()

      expect(form.textContent).not.toContain('Key slot')
      expect(buttonWithText(form, 'Add key')).toBeNull()
      const select = form.querySelector('select[aria-label="New agent model"]')
      expect(select).not.toBeNull()
      const option = select.querySelectorAll('option').find((row) => row.getAttribute('value') === 'OpenRouter/flash')
      expect(option.textContent).toContain('flash (OpenRouter)')
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
        await click(root, rowByLabel(container, 'Orchestrator').querySelector('.mr-family-add'))
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

  async function mountTeams(root, client) {
    await act(async () => {
      root.render(createElement(FamilyTeams, { client, project: '/work/machine-room' }))
    })
    await act(async () => {})
  }

  it('applies the chosen team behind its card and shows the dropped lanes and the ladder sentence', async () => {
    const { client, calls } = makeTeamClient()
    await withDom(async ({ container, root }) => {
      await mountTeams(root, client)
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
      await mountTeams(root, client)
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
      await mountTeams(root, client)
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
      await mountTeams(root, client)
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
      await mountTeams(root, makeTeamClient({ teams: undefined }).client)
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
          model: 'opencode-go/deepseek-v4.1-flash',
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
      expect(row.textContent).toContain('started opencode')
      const orchestrator = rowByLabel(container, 'Orchestrator')
      expect(orchestrator).not.toBe(null)
      const all = Array.from(rows(container))
      expect(all[all.indexOf(orchestrator) + 1]).toBe(row)
    })
  })
})
