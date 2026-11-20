import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import FamilyTeam from '../src/ui/FamilyTeam.jsx'
import { FamilyTree } from '../src/ui/FamilyTree.jsx'
import {
  DIRECT_HARNESS,
  childDraft,
  childFormProblem,
  familyMeta,
  teamDraft,
} from '../src/ui/family.js'
import { buttonWithText, click, settle, type, withDom } from './helpers/uiDom.js'

const HARNESSES = {
  harnesses: [
    {
      key: 'claude',
      name: 'Claude Code',
      available: true,
      ready: true,
      models: [
        { id: 'sonnet', label: 'Claude Sonnet 4.6' },
        { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
      ],
      efforts: ['low', 'high'],
    },
    {
      key: 'opencode',
      name: 'OpenCode',
      available: true,
      ready: true,
      models: [
        { id: 'other', label: 'Other' },
        { id: 'opencode-go/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' },
      ],
      efforts: ['low', 'max'],
    },
    {
      key: DIRECT_HARNESS,
      name: 'Direct API',
      available: true,
      ready: true,
      models: [],
      efforts: [],
    },
  ],
}

const MODELS = {
  models: [
    { id: 'sonnet', harness: 'claude', label: 'Claude Sonnet 4.6' },
    { id: 'claude-opus-5-5', harness: 'claude', label: 'Claude Opus 5.5' },
    { id: 'other', harness: 'opencode', label: 'Other' },
    { id: 'opencode-go/deepseek-v4.1-flash', harness: 'opencode', label: 'DeepSeek V4.1 Flash' },
  ],
}

function makeClient({
  nodes = null,
  harnesses = HARNESSES,
  models = MODELS,
  orchestrators = null,
  directModels = [{ id: 'openrouter/flash', label: 'Flash' }],
} = {}) {
  const defaultNodes = [
    {
      id: 'orchestrator',
      kind: 'orchestrator',
      label: 'Orchestrator',
      harness: 'claude',
      model: 'claude-opus-5-5',
      effort: 'high',
      parent: null,
      children: ['coder', 'helper'],
      active: true,
      working: false,
    },
    {
      id: 'coder',
      kind: 'lane',
      label: 'Coder',
      harness: 'opencode',
      model: 'opencode-go/deepseek-v4.1-flash',
      effort: 'max',
      parent: 'orchestrator',
      active: true,
      working: false,
    },
    {
      id: 'helper',
      kind: 'lane',
      label: 'Helper',
      harness: 'claude',
      model: 'openrouter/claude-opus-5-5',
      effort: '',
      parent: 'orchestrator',
      active: true,
      working: false,
    },
  ]
  const lanes = {
    lanes: [
      { key: 'coder', name: 'Coder', harness: 'opencode', active: true },
      { key: 'helper', name: 'Helper', harness: 'claude', active: true },
    ],
    max: 4,
    chosen: true,
  }
  const calls = { createLane: [], setLadder: [] }
  const client = {
    family: async () => ({ nodes: nodes ?? defaultNodes, keys: [], proposals: [] }),
    lanes: async () => lanes,
    harnesses: async () => harnesses,
    models: async () => models,
    harnessModels: async (options = {}) => {
      const harness = typeof options === 'string' ? options : options.harness ?? ''
      if (harness === DIRECT_HARNESS) return { harness, models: [...directModels] }
      const entry = (harnesses?.harnesses ?? []).find((row) => row.key === harness)
      return { harness, models: entry?.models ? [...entry.models] : [] }
    },
    orchestrators: async () => orchestrators ?? [{ id: 'orchestrator', name: 'Orchestrator' }],
    keys: async () => ({ keys: [] }),
    endpoints: async () => ({ endpoints: [] }),
    modelPins: async () => [],
    saveModelPins: async (payload) => ({ ok: true, pins: payload.pins }),
    createLane: async (payload) => {
      calls.createLane.push(payload)
      return { key: 'writer' }
    },
    setLadder: async (payload) => {
      calls.setLadder.push(payload)
      return { ok: true }
    },
    setAgentLabel: async () => ({ ok: true }),
    teams: async () => ({ teams: [] }),
    projects: async () => ({ current: null, recent: [] }),
    setActiveLanes: async () => ({ ok: true }),
  }
  return { client, calls }
}

async function chooseAction(root, row, label) {
  await click(root, row.querySelector('[aria-haspopup="menu"]'))
  await click(root, buttonWithText(row.ownerDocument.body.querySelector('[role="menu"]'), label))
}

function rowByLabel(container, label) {
  return (
    container
      .querySelectorAll('.mr-family-node')
      .find((row) => row.querySelector('.mr-family-label')?.textContent === label) ?? null
  )
}

async function mountTree(root, client) {
  await act(async () => {
    root.render(createElement(FamilyTree, { client }))
  })
  await settle()
}

describe('form defaults and row model names', () => {
  it('starts new child, sub and team drafts with an empty model, Harness default text and no problem', async () => {
    const child = childDraft(HARNESSES, MODELS)
    expect(child.model).toBe('')
    expect(childFormProblem({ ...child, label: 'Writer' }, { harnesses: HARNESSES, models: MODELS })).toBe('')

    const team = teamDraft(HARNESSES, MODELS)
    expect(team.model).toBe('')

    const { client: childClient, calls: childCalls } = makeClient()
    await withDom(async ({ container, root }) => {
      await mountTree(root, childClient)
      await chooseAction(root, rowByLabel(container, 'Orchestrator'), 'Add a lane under this…')
      const form = container.querySelector('.mr-family-child')
      const trigger = form.querySelector('.mr-picker-trigger[aria-label="New agent model"]')
      expect(trigger.textContent).toContain('Harness default')

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
      await click(root, buttonWithText(container.querySelector('.mr-side-confirm-card'), 'Create'))
      expect(childCalls.createLane[0]).toMatchObject({ name: 'Writer', harness: 'opencode', model: '' })
    })

    const { client: subClient, calls: subCalls } = makeClient()
    await withDom(async ({ container, root }) => {
      await mountTree(root, subClient)
      await chooseAction(root, rowByLabel(container, 'Coder'), 'Make sub from this lane…')
      const form = container.querySelector('.mr-family-sub-form')
      const trigger = form.querySelector('.mr-picker-trigger[aria-label="Sub orchestrator model"]')
      expect(trigger.textContent).toContain('Harness default')

      await act(async () => {
        form.dispatchEvent({ type: 'submit', bubbles: true, cancelable: true })
      })
      await click(root, buttonWithText(container.querySelector('.mr-side-confirm-card'), 'Create'))
      expect(subCalls.setLadder[0].subs[0]).toMatchObject({ harness: 'opencode', model: '' })
    })

    const { client: teamClient, calls: teamCalls } = makeClient({
      orchestrators: [
        {
          id: 'orchestrator',
          name: 'Orchestrator',
          harnesses: HARNESSES.harnesses,
        },
      ],
    })
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(FamilyTeam, { client: teamClient }))
      })
      await settle()
      await click(root, container.querySelector('.mr-side-head'))
      await settle()

      const form = container.querySelector('.mr-team-form')
      const trigger = form.querySelector('.mr-picker-trigger[aria-label="Model for the new sub orchestrators"]')
      expect(trigger.textContent).toContain('Harness default')
      expect(buttonWithText(form, 'Save')).not.toBeNull()

      await act(async () => {
        form.dispatchEvent({ type: 'submit', bubbles: true, cancelable: true })
      })
      await click(root, buttonWithText(container.querySelector('.mr-side-confirm-card'), 'Build the team'))
      expect(teamCalls.setLadder[0].subs[0]).toMatchObject({ harness: 'opencode', model: '' })
    })
  })

  it('allows empty model for regular harnesses while Direct API still requires a model', async () => {
    expect(
      childFormProblem(
        { label: 'Writer', harness: 'opencode', model: '', effort: '' },
        { harnesses: HARNESSES, models: MODELS }
      )
    ).toBe('')
    expect(
      childFormProblem(
        { label: 'Writer', harness: DIRECT_HARNESS, model: '', effort: '' },
        { harnesses: HARNESSES, models: MODELS, directModels: [{ id: 'openrouter/flash', label: 'Flash' }] }
      )
    ).toBe('Choose a model for this harness.')

    const { client } = makeClient({
      harnesses: {
        harnesses: [
          { key: DIRECT_HARNESS, name: 'Direct API', available: true, ready: true, models: [], efforts: [] },
        ],
      },
      orchestrators: [
        {
          id: 'orchestrator',
          name: 'Orchestrator',
          harnesses: [{ key: DIRECT_HARNESS, name: 'Direct API' }],
        },
      ],
    })
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(FamilyTeam, { client }))
      })
      await settle()
      await click(root, container.querySelector('.mr-side-head'))
      await settle()

      const form = container.querySelector('.mr-team-form')
      expect(form.textContent).toContain('Choose a model for this harness.')
      expect(buttonWithText(form, 'Save')).toBeNull()

      const trigger = form.querySelector('.mr-picker-trigger[aria-label="Model for the new sub orchestrators"]')
      expect(trigger.textContent).toContain('Choose a model')
      expect(buttonWithText(form, 'Save')).toBeNull()

      await click(root, trigger)
      const firstRow = form.querySelectorAll('.mr-picker-row')[0]
      expect(firstRow.textContent).not.toContain('Harness default')
    })
  })

  it('lists Harness default first and empties a picked model when chosen again', async () => {
    const { client: childClient } = makeClient()
    await withDom(async ({ container, root }) => {
      await mountTree(root, childClient)
      await chooseAction(root, rowByLabel(container, 'Orchestrator'), 'Add a lane under this…')
      const form = container.querySelector('.mr-family-child')
      const trigger = form.querySelector('.mr-picker-trigger[aria-label="New agent model"]')

      await click(root, trigger)
      await settle()
      expect(form.querySelectorAll('.mr-picker-row')[0].textContent).toContain('Harness default')

      const flash = form
        .querySelectorAll('.mr-picker-pick')
        .find((button) => button.getAttribute('title') === 'opencode-go/deepseek-v4.1-flash')
      await click(root, flash)
      expect(trigger.textContent).toContain('DeepSeek V4.1 Flash')

      await click(root, trigger)
      await settle()
      const firstRow = form.querySelectorAll('.mr-picker-row')[0]
      expect(firstRow.textContent).toContain('Harness default')
      await click(root, firstRow.querySelector('.mr-picker-pick'))
      expect(trigger.textContent).toContain('Harness default')

      await click(root, trigger)
      await settle()
      await type(root, form.querySelector('.mr-picker-search'), 'other')
      expect(form.querySelectorAll('.mr-picker-row')[0]?.textContent ?? '').not.toContain('Harness default')
    })

    const { client: subClient, calls: subCalls } = makeClient()
    await withDom(async ({ container, root }) => {
      await mountTree(root, subClient)
      await chooseAction(root, rowByLabel(container, 'Coder'), 'Make sub from this lane…')
      const form = container.querySelector('.mr-family-sub-form')
      const trigger = form.querySelector('.mr-picker-trigger[aria-label="Sub orchestrator model"]')

      await click(root, trigger)
      await settle()
      const other = form.querySelectorAll('.mr-picker-pick').find((button) => button.getAttribute('title') === 'other')
      await click(root, other)
      expect(trigger.textContent).toContain('Other')

      await click(root, trigger)
      await settle()
      const firstRow = form.querySelectorAll('.mr-picker-row')[0]
      expect(firstRow.textContent).toContain('Harness default')
      await click(root, firstRow.querySelector('.mr-picker-pick'))
      expect(trigger.textContent).toContain('Harness default')

      await act(async () => {
        form.dispatchEvent({ type: 'submit', bubbles: true, cancelable: true })
      })
      await click(root, buttonWithText(container.querySelector('.mr-side-confirm-card'), 'Create'))
      expect(subCalls.setLadder[0].subs[0].model).toBe('')
    })

    const { client: teamClient, calls: teamCalls } = makeClient()
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(FamilyTeam, { client: teamClient }))
      })
      await settle()
      await click(root, container.querySelector('.mr-side-head'))
      await settle()

      const form = container.querySelector('.mr-team-form')
      const trigger = form.querySelector('.mr-picker-trigger[aria-label="Model for the new sub orchestrators"]')
      await click(root, trigger)
      await settle()
      const flash = form
        .querySelectorAll('.mr-picker-pick')
        .find((button) => button.getAttribute('title') === 'opencode-go/deepseek-v4.1-flash')
      await click(root, flash)
      expect(trigger.textContent).toContain('DeepSeek V4.1 Flash')

      await click(root, trigger)
      await settle()
      const firstRow = form.querySelectorAll('.mr-picker-row')[0]
      expect(firstRow.textContent).toContain('Harness default')
      await click(root, firstRow.querySelector('.mr-picker-pick'))
      expect(trigger.textContent).toContain('Harness default')

      await act(async () => {
        form.dispatchEvent({ type: 'submit', bubbles: true, cancelable: true })
      })
      await click(root, buttonWithText(container.querySelector('.mr-side-confirm-card'), 'Build the team'))
      expect(teamCalls.setLadder[0].subs[0].model).toBe('')
    })
  })

  it('names a family row model with modelName and the harness list, or last segment when absent', async () => {
    expect(
      familyMeta(
        { harness: 'claude', model: 'claude-opus-5-5', effort: 'high' },
        [{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5' }]
      )
    ).toBe('claude · Claude Opus 5.5 · high')
    expect(familyMeta({ harness: 'claude', model: 'openrouter/claude-opus-5-5', effort: 'high' }, [])).toBe(
      'claude · claude-opus-5-5 · high'
    )
    expect(familyMeta({ harness: 'claude', model: 'openrouter/claude-opus-5-5', effort: 'high' })).toBe(
      'claude · claude-opus-5-5 · high'
    )

    const { client: modelsClient } = makeClient({
      harnesses: {
        harnesses: [
          { key: 'claude', name: 'Claude Code', available: true, ready: true, models: [], efforts: ['high'] },
          { key: 'opencode', name: 'OpenCode', available: true, ready: true, models: [], efforts: ['max'] },
        ],
      },
    })
    await withDom(async ({ container, root }) => {
      await mountTree(root, modelsClient)
      expect(rowByLabel(container, 'Orchestrator').querySelector('.ui-row-detail').textContent).toBe(
        'waiting · claude · Claude Opus 5.5'
      )
      expect(rowByLabel(container, 'Helper').querySelector('.ui-row-detail').textContent).toBe(
        'claude · claude-opus-5-5'
      )
    })

    const { client: harnessesClient } = makeClient({ models: { models: [] } })
    await withDom(async ({ container, root }) => {
      await mountTree(root, harnessesClient)
      expect(rowByLabel(container, 'Orchestrator').querySelector('.ui-row-detail').textContent).toBe(
        'waiting · claude · Claude Opus 5.5'
      )
      expect(rowByLabel(container, 'Coder').querySelector('.ui-row-detail').textContent).toBe(
        'opencode · DeepSeek V4.1 Flash'
      )
      expect(rowByLabel(container, 'Helper').querySelector('.ui-row-detail').textContent).toBe(
        'claude · claude-opus-5-5'
      )
    })
  })
})
