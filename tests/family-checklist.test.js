import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import FamilyTree from '../src/ui/FamilyTree.jsx'
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
  ],
}

function makeClient() {
  const calls = { setAgentLabel: [] }
  const client = {
    family: async () => ({ nodes: NODES, keys: [], proposals: [] }),
    lanes: async () => LANES,
    harnesses: async () => HARNESSES,
    harnessModels: async (options = {}) => ({ harness: options.harness ?? '', models: [] }),
    models: async () => ({ models: [] }),
    keys: async () => ({ keys: [] }),
    laneBackups: async () => ({}),
    orchestrators: async () => [{ id: 'orchestrator', name: 'Orchestrator' }],
    setAgentLabel: async (payload) => {
      calls.setAgentLabel.push(payload)
      return { ok: true }
    },
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

function agentRow(group, label) {
  return (
    group.querySelectorAll('.mr-family-agent').find((row) => {
      const found = row.querySelector('.mr-family-agent-label')
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

async function openEditor(root, container, label) {
  await click(root, rowByLabel(container, label).querySelector('.mr-family-open'))
  return container.querySelector('.mr-family-editor')
}

describe('the sub editor Agents checklist', () => {
  it('shows the label of the sub that leads a lane', async () => {
    const { client } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      await openEditor(root, container, 'Frontend')
      const group = container.querySelector('[aria-label="Agents under Frontend"]')
      const row = agentRow(group, 'OpenCode 2')
      expect(row.querySelector('.mr-family-agent-id').textContent).toBe('Frontend')
      expect(row.querySelector('.mr-family-agent-id').textContent).not.toBe('opencode2')
    })
  })

  it('shows Orchestrator for a lane under the main', async () => {
    const { client } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      await openEditor(root, container, 'Frontend')
      const group = container.querySelector('[aria-label="Agents under Frontend"]')
      const row = agentRow(group, 'OpenCode')
      expect(row.querySelector('.mr-family-agent-id').textContent).toBe('Orchestrator')
    })
  })
})

describe('Save label', () => {
  it('saves a changed label in one click with no confirm card', async () => {
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      const editor = await openEditor(root, container, 'OpenCode')
      const input = editor.querySelector('input[aria-label="Label for OpenCode"]')
      await type(root, input, 'Writer')
      const save = buttonWithText(editor, 'Save label')
      expect(save.getAttribute('disabled')).toBeNull()

      await click(root, save)
      await settle()

      expect(calls.setAgentLabel).toEqual([{ id: 'opencode', label: 'Writer', confirmed: true }])
      expect(container.querySelector('.mr-side-confirm-card')).toBeNull()
      expect(container.querySelector('[role="dialog"]')).toBeNull()
    })
  })

  it('shows the error for an invalid label and saves nothing', async () => {
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      const editor = await openEditor(root, container, 'OpenCode')
      const input = editor.querySelector('input[aria-label="Label for OpenCode"]')
      await type(root, input, '   ')
      const save = buttonWithText(editor, 'Save label')
      expect(save.getAttribute('disabled')).toBeNull()

      await click(root, save)
      await settle()

      expect(container.textContent).toContain('Write a label for the agent.')
      expect(calls.setAgentLabel).toEqual([])
      expect(container.querySelector('.mr-side-confirm-card')).toBeNull()
    })
  })

  it('keeps Save off while the label is unchanged', async () => {
    const { client } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      const editor = await openEditor(root, container, 'OpenCode')
      const save = buttonWithText(editor, 'Save label')
      expect(save.getAttribute('disabled')).not.toBeNull()

      const input = editor.querySelector('input[aria-label="Label for OpenCode"]')
      await type(root, input, '  OpenCode  ')
      expect(buttonWithText(editor, 'Save label').getAttribute('disabled')).not.toBeNull()

      await type(root, input, 'Writer')
      expect(buttonWithText(editor, 'Save label').getAttribute('disabled')).toBeNull()
    })
  })
})
