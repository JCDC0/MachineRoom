import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { FamilyTree } from '../src/ui/FamilyTree.jsx'
import { DIRECT_HARNESS, DIRECT_KEY_PROBLEM, childFormProblem } from '../src/ui/family.js'
import { buttonWithText, click, settle, type, withDom } from './helpers/uiDom.js'

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
      models: [
        { id: 'beam-free', label: 'Beam Free' },
        { id: 'opencode-go/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' },
      ],
      efforts: ['low', 'max'],
    },
    { key: 'acp', name: 'ACP', available: true, models: [], efforts: [] },
  ],
}

const NODES = [
  {
    id: 'orchestrator',
    kind: 'orchestrator',
    label: 'Orchestrator',
    harness: 'claude',
    model: 'opus',
    effort: 'high',
    parent: null,
    children: ['opencode'],
    active: true,
    working: false,
  },
  {
    id: 'opencode',
    kind: 'lane',
    label: 'OpenCode',
    harness: 'opencode',
    model: 'beam-free',
    effort: 'max',
    parent: 'orchestrator',
    active: true,
    working: false,
  },
]

const FAMILY = { nodes: NODES, keys: [], proposals: [] }

const LANES = {
  lanes: [{ key: 'opencode', name: 'OpenCode', harness: 'opencode', active: true }],
  max: 4,
  chosen: true,
}

function makeClient(directModels = []) {
  const calls = { createLane: [] }
  const client = {
    family: async () => FAMILY,
    lanes: async () => LANES,
    harnesses: async () => HARNESSES,
    harnessModels: async (options = {}) => {
      const harness = typeof options === 'string' ? options : options.harness ?? ''
      return { harness, models: harness === DIRECT_HARNESS ? [...directModels] : [] }
    },
    models: async () => ({ models: [] }),
    keys: async () => ({ keys: [] }),
    orchestrators: async () => [
      {
        id: 'orchestrator',
        name: 'Orchestrator',
        harness: 'claude',
        model: 'opus',
        effort: 'high',
      },
    ],
    createLane: async (payload) => {
      calls.createLane.push(payload)
      return { key: 'writer' }
    },
    setOrchestratorHarness: async () => ({ ok: true }),
    setOrchestratorEffort: async () => ({ ok: true }),
  }
  return { client, calls }
}

async function mount(root, client) {
  await act(async () => {
    root.render(createElement(FamilyTree, { client }))
  })
  await act(async () => {})
}

async function chooseAction(root, row, label) {
  await click(root, row.querySelector('[aria-haspopup="menu"]'))
  await click(root, buttonWithText(row.ownerDocument.body.querySelector('[role="menu"]'), label))
}

function rowByLabel(container, label) {
  return (
    container.querySelectorAll('.mr-family-node').find((row) => {
      const found = row.querySelector('.mr-family-label')
      return found !== null && found.textContent === label
    }) ?? null
  )
}

function harnessPill(form, name) {
  return form.querySelectorAll('.mr-side-harness').find((button) => button.textContent.trim() === name) ?? null
}

describe('a harness pick keeps Harness default', () => {
  it('leaves the Add child model empty after choosing OpenCode', async () => {
    const { client } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      await chooseAction(root, rowByLabel(container, 'Orchestrator'), 'Add a lane under this…')
      const form = container.querySelector('.mr-family-child')

      await click(root, harnessPill(form, 'Claude Code'))
      await click(root, harnessPill(form, 'OpenCode'))

      const trigger = form.querySelector('button[aria-label="New agent model"]')
      expect(trigger.textContent.trim()).toBe('Harness default')
    })
  })

  it('leaves the sub orchestrator model empty after choosing OpenCode', async () => {
    const { client } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      await chooseAction(root, rowByLabel(container, 'OpenCode'), 'Make sub from this lane…')
      const form = container.querySelector('.mr-family-sub-form')
      const picker = form.querySelector('select[aria-label="Sub orchestrator harness"]')

      await type(root, picker, 'claude')
      await type(root, picker, 'opencode')

      const trigger = form.querySelector('button[aria-label="Sub orchestrator model"]')
      expect(trigger.textContent.trim()).toBe('Harness default')
    })
  })

  it('keeps the first Direct API model', async () => {
    const { client, calls } = makeClient([
      { id: 'OpenRouter/flash', label: 'flash (OpenRouter)' },
      { id: 'OpenRouter/other', label: 'other (OpenRouter)' },
    ])
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      await chooseAction(root, rowByLabel(container, 'Orchestrator'), 'Add a lane under this…')
      const form = container.querySelector('.mr-family-child')

      await click(root, harnessPill(form, 'Direct API'))
      await settle()

      const trigger = form.querySelector('button[aria-label="New agent model"]')
      expect(trigger.textContent.trim()).toContain('flash')

      await type(root, form.querySelector('input[aria-label="New agent label"]'), 'Writer')
      await act(async () => {
        form.dispatchEvent({ type: 'submit', bubbles: true, cancelable: true })
      })
      const card = container.querySelector('.mr-side-confirm-card')
      await click(root, buttonWithText(card, 'Create'))
      expect(calls.createLane[0]).toMatchObject({ harness: DIRECT_HARNESS, model: 'OpenRouter/flash' })
    })
  })

  it('shows Harness default in the orchestrator editor for OpenCode', async () => {
    const { client } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      await click(root, rowByLabel(container, 'Orchestrator').querySelector('.mr-family-open'))
      const editor = container.querySelector('.mr-family-editor')
      const picker = editor.querySelector('select[aria-label="Harness for Orchestrator"]')

      await type(root, picker, 'opencode')

      const trigger = editor.querySelector('button[aria-label="Model for Orchestrator"]')
      expect(trigger.textContent.trim()).toBe('Harness default')
      await click(root, trigger)
      const rows = editor.querySelectorAll('.mr-picker-row')
      expect(rows[0].textContent.trim()).toBe('Harness default')
    })
  })

  it('lists no default row in the orchestrator editor for Direct API', async () => {
    const { client } = makeClient([{ id: 'OpenRouter/flash', label: 'flash (OpenRouter)' }])
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      await click(root, rowByLabel(container, 'Orchestrator').querySelector('.mr-family-open'))
      const editor = container.querySelector('.mr-family-editor')
      const picker = editor.querySelector('select[aria-label="Harness for Orchestrator"]')

      await type(root, picker, DIRECT_HARNESS)
      await settle()

      const trigger = editor.querySelector('button[aria-label="Model for Orchestrator"]')
      expect(trigger.textContent.trim()).toContain('flash')
      await click(root, trigger)
      const rows = editor.querySelectorAll('.mr-picker-row')
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.some((row) => row.textContent.trim() === 'Harness default')).toBe(false)
    })
  })

  it('saves an empty model for OpenCode in the orchestrator editor', async () => {
    const { client } = makeClient()
    const calls = []
    client.setOrchestratorHarness = async (payload) => {
      calls.push(payload)
      return { ok: true }
    }
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      await click(root, rowByLabel(container, 'Orchestrator').querySelector('.mr-family-open'))
      const editor = container.querySelector('.mr-family-editor')
      const picker = editor.querySelector('select[aria-label="Harness for Orchestrator"]')

      await type(root, picker, 'opencode')
      await click(root, buttonWithText(editor, 'Save'))

      const card = container.querySelector('.mr-side-confirm-card')
      expect(card.textContent).toContain('with Harness default')
      await click(root, buttonWithText(card, 'Save'))
      expect(calls).toEqual([{ id: 'orchestrator', harness: 'opencode', model: '', confirmed: true }])
    })
  })
})

describe('a form accepts Harness default', () => {
  it('raises no problem for a CLI harness with no models and an empty model', () => {
    const draft = { label: 'Writer', harness: 'acp', model: '', effort: '' }
    expect(childFormProblem(draft, { harnesses: HARNESSES })).toBe('')
  })

  it('still raises the model problem for Direct API with no models', () => {
    const draft = { label: 'Writer', harness: DIRECT_HARNESS, model: '', effort: '' }
    expect(childFormProblem(draft, { harnesses: HARNESSES })).toBe(DIRECT_KEY_PROBLEM)
  })
})
