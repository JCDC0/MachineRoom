import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import FamilyTree from '../src/ui/FamilyTree.jsx'
import { DIRECT_KEY_PROBLEM, teamPlan } from '../src/ui/family.js'
import { subFromForm } from '../src/ui/ladderForm.js'
import { buttonWithText, click, settle, type, withDom } from './helpers/uiDom.js'

const NODES = [
  {
    id: 'orchestrator',
    kind: 'orchestrator',
    label: 'Orchestrator',
    harness: 'claude',
    model: 'opus',
    effort: 'high',
    parent: null,
    children: ['frontend', 'opencode'],
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
    working: false,
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
]

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
    {
      key: 'codex',
      name: 'Codex',
      available: true,
      models: [{ id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' }],
      efforts: [],
    },
  ],
}

function makeClient({ nodes = NODES, harnessModels = null, laneBackups = {} } = {}) {
  const calls = { setLadder: [] }
  const client = {
    family: async () => ({ nodes, keys: [], proposals: [] }),
    lanes: async () => LANES,
    harnesses: async () => HARNESSES,
    harnessModels: async (options = {}) => {
      const harness = typeof options === 'string' ? options : options.harness ?? ''
      const answer = harnessModels ? harnessModels(harness) : null
      return answer ?? { harness, models: [] }
    },
    models: async () => ({ models: [] }),
    keys: async () => ({ keys: [] }),
    laneBackups: async () => laneBackups,
    orchestrators: async () => [{ id: 'orchestrator', name: 'Orchestrator' }],
    setLadder: async (payload) => {
      calls.setLadder.push(payload)
      return { ok: true }
    },
    setAgentLabel: async () => ({ ok: true }),
    hideLane: async () => ({ ok: true }),
  }
  return { client, calls }
}

function rowByLabel(container, label) {
  return (
    container.querySelectorAll('.mr-family-node').find((row) => {
      const found = row.querySelector('.mr-family-label')
      return found !== null && found.textContent === label
    }) ?? null
  )
}

async function mount(root, client) {
  await act(async () => {
    root.render(createElement(FamilyTree, { client }))
  })
  await settle()
}

describe('the sub form keeps its effort', () => {
  it('saves the effort chosen for a new sub', async () => {
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      const check = rowByLabel(container, 'OpenCode').querySelector('.mr-family-check')
      await act(async () => {
        check.checked = true
        check.click()
      })
      await click(root, buttonWithText(container, 'Add sub orchestrator'))

      const form = container.querySelector('.mr-family-sub-form')
      await type(root, form.querySelector('input[aria-label="Sub orchestrator label"]'), 'High Sub')
      await type(root, form.querySelector('select[aria-label="Sub orchestrator harness"]'), 'claude')
      await settle()
      await type(root, form.querySelector('select[aria-label="Sub orchestrator effort"]'), 'high')
      await act(async () => {
        form.dispatchEvent({ type: 'submit', bubbles: true, cancelable: true })
      })

      const card = container.querySelector('.mr-side-confirm-card')
      await click(root, buttonWithText(card, 'Create'))
      await settle()

      expect(calls.setLadder).toHaveLength(1)
      const sub = calls.setLadder[0].subs.find((entry) => entry.id === 'high-sub')
      expect(sub).toMatchObject({ effort: 'high' })
    })
  })

  it('keeps a chosen effort and leaves an empty one out', () => {
    expect(subFromForm({ name: 'High Lead', harness: 'claude', effort: ' high ' }).effort).toBe('high')
    expect(subFromForm({ name: 'Default Lead', harness: 'claude', effort: '' }).effort).toBeUndefined()
  })
})

describe('a lane from lanes.json', () => {
  it('shows its setup as plain text and keeps its label and remove action', async () => {
    const { client } = makeClient({ laneBackups: { opencode: 'claude' } })
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      await click(root, rowByLabel(container, 'OpenCode').querySelector('.mr-family-open'))
      const editor = container.querySelector('.mr-family-editor')

      expect(editor.querySelector('button[aria-label="Model for OpenCode"]')).toBeNull()
      expect(editor.querySelector('select[aria-label="Effort for OpenCode"]')).toBeNull()
      expect(editor.querySelector('select[aria-label="Backup lane for OpenCode"]')).toBeNull()
      expect(editor.textContent).toContain('Edit this agent in lanes.json.')
      expect(editor.textContent).toContain('opencode-go/deepseek-v4.1-flash')
      expect(editor.textContent).toContain('Backup lane claude')
      expect(editor.querySelector('input[aria-label="Label for OpenCode"]')).not.toBeNull()
      expect(buttonWithText(editor, 'Remove')).not.toBeNull()
      expect(buttonWithText(editor, 'Save')).toBeNull()
    })
  })
})

describe('a failed Direct API model read', () => {
  it('shows the read error and Retry in place of the key sentence', async () => {
    const { client } = makeClient({
      harnessModels: (harness) =>
        harness === 'machineroom' ? { harness, models: [], error: 'The model read failed.' } : null,
    })
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      await click(root, rowByLabel(container, 'Orchestrator').querySelector('.mr-family-add'))
      const form = container.querySelector('.mr-family-child')
      const direct = form
        .querySelectorAll('.mr-side-harness')
        .find((button) => button.textContent.trim() === 'Direct API')
      await click(root, direct)
      await settle()

      expect(form.textContent).toContain('The model read failed.')
      expect(form.textContent).not.toContain(DIRECT_KEY_PROBLEM)
      expect(buttonWithText(form, 'Retry')).not.toBeNull()
    })
  })
})

describe('a team that needs more agents', () => {
  it('asks for agents outside the existing teams', () => {
    const plan = teamPlan({
      lanes: { lanes: [{ key: 'opencode', name: 'OpenCode', active: true }] },
      ladder: { subs: [] },
      orchestrators: 1,
      coders: 3,
      harness: 'opencode',
      model: 'opencode-go/deepseek-v4.1-flash',
    })
    expect(plan.problem).toBe(
      'Need 2 more agents outside existing teams. Add agents or make the team smaller.'
    )
  })
})

describe('an orchestrator whose harness has no effort levels', () => {
  it('shows no Effort select', async () => {
    const nodes = NODES.map((node) =>
      node.id === 'orchestrator' ? { ...node, harness: 'codex', model: 'gpt-6.1-sol', effort: '' } : node
    )
    const { client } = makeClient({ nodes })
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      await click(root, rowByLabel(container, 'Orchestrator').querySelector('.mr-family-open'))
      const editor = container.querySelector('.mr-family-editor')
      expect(editor.querySelector('select[aria-label="Effort for Orchestrator"]')).toBeNull()
    })
  })
})
