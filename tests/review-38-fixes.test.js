import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import FamilyTree from '../src/ui/FamilyTree.jsx'
import HarnessesSettings from '../src/ui/HarnessesSettings.jsx'
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
    children: ['opencode', 'claude'],
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
      models: [{ id: 'opus', label: 'Opus' }],
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

function rowByLabel(container, label) {
  return (
    container.querySelectorAll('.mr-family-node').find((row) => {
      const found = row.querySelector('.mr-family-label')
      return found !== null && found.textContent === label
    }) ?? null
  )
}

async function openEditor(root, container, label) {
  await click(root, rowByLabel(container, label).querySelector('.mr-family-open'))
  return container.querySelector('.mr-family-editor')
}

describe('R38-1: a delayed rename stays with its agent', () => {
  it('does not write one agent label into another agent draft', async () => {
    const calls = []
    let release = null
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const client = {
      family: async () => ({ nodes: NODES, keys: [], proposals: [] }),
      lanes: async () => LANES,
      harnesses: async () => HARNESSES,
      harnessModels: async (options = {}) => ({ harness: options.harness ?? '', models: [] }),
      models: async () => ({ models: [] }),
      keys: async () => ({ keys: [] }),
      laneBackups: async () => ({}),
      orchestrators: async () => [{ id: 'orchestrator', name: 'Orchestrator' }],
      setAgentLabel: (payload) => {
        calls.push(payload)
        return payload.id === 'opencode' ? gate : Promise.resolve({ ok: true })
      },
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(FamilyTree, { client }))
      })
      await settle()

      const first = await openEditor(root, container, 'OpenCode')
      const firstInput = first.querySelector('input[aria-label="Label for OpenCode"]')
      await type(root, firstInput, 'Writer')
      await click(root, buttonWithText(first, 'Save label'))

      const second = await openEditor(root, container, 'Claude')
      const secondInput = second.querySelector('input[aria-label="Label for Claude"]')
      await type(root, secondInput, 'Reviewer')

      await act(async () => {
        release({ ok: true })
      })
      await settle()

      const stillOpen = container.querySelector('input[aria-label="Label for Claude"]')
      expect(stillOpen.value).toBe('Reviewer')

      await click(root, buttonWithText(container.querySelector('.mr-family-editor'), 'Save label'))
      await settle()

      expect(calls).toEqual([
        { id: 'opencode', label: 'Writer', confirmed: true },
        { id: 'claude', label: 'Reviewer', confirmed: true },
      ])
    })
  })
})

function directApiClient() {
  return {
    harnesses: async () => [
      {
        key: 'machineroom',
        name: 'MachineRoom',
        available: false,
        ready: false,
        enabled: true,
        program: '',
        version: '',
        reason: 'No key or endpoint is saved.',
        models: [],
        efforts: [],
      },
    ],
    keys: async () => ({ keys: [] }),
    endpoints: async () => ({ endpoints: [] }),
    subscribe: () => () => {},
  }
}

describe('R38-4: a not-ready Direct API row shows its reason', () => {
  it('renders the reason outside the program details', async () => {
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(HarnessesSettings, { client: directApiClient() }))
      })
      await settle()

      const row = container.querySelector('[data-harness="machineroom"]')
      expect(row).not.toBeNull()
      expect(row.querySelector('[data-harness-state]').textContent.trim()).toBe('Not ready')
      const reason = row.querySelector('[data-harness-reason="true"]')
      expect(reason).not.toBeNull()
      expect(reason.textContent.trim()).toBe('No key or endpoint is saved.')
    })
  })
})
