import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import FamilyTeam from '../src/ui/FamilyTeam.jsx'
import { FamilyTree } from '../src/ui/FamilyTree.jsx'
import {
  NO_READY_HARNESS,
  childHarnesses,
  directHarness,
  harnessGroups,
  harnessReady,
} from '../src/ui/family.js'
import { buttonWithText, click, settle, withDom } from './helpers/uiDom.js'

const NODES = [
  {
    id: 'orchestrator',
    kind: 'orchestrator',
    label: 'Orchestrator',
    harness: 'claude',
    model: 'sonnet',
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
    model: 'qwen',
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
      ready: true,
      enabled: true,
      models: [{ id: 'sonnet', label: 'Sonnet' }],
      efforts: ['low', 'high'],
    },
    {
      key: 'opencode',
      name: 'OpenCode',
      available: true,
      ready: true,
      enabled: true,
      models: [{ id: 'qwen', label: 'Qwen' }],
      efforts: ['low', 'high'],
    },
    { key: 'copilot', name: 'GitHub Copilot', available: true, ready: false, enabled: true, models: [], efforts: [] },
    {
      key: 'codex',
      name: 'Codex',
      available: true,
      ready: true,
      enabled: false,
      models: [{ id: 'gpt-5-codex', label: 'GPT-5 Codex' }],
      efforts: [],
    },
    { key: 'machineroom', name: 'MachineRoom', available: false, ready: false, enabled: true, models: [], efforts: [] },
  ],
}

const ORCH_HARNESSES = [
  { key: 'claude', name: 'Claude Code', models: [{ id: 'sonnet', name: 'Sonnet' }] },
  { key: 'opencode', name: 'OpenCode', models: [{ id: 'qwen', name: 'Qwen' }] },
  { key: 'copilot', name: 'GitHub Copilot', models: [] },
  { key: 'codex', name: 'Codex', models: [{ id: 'gpt-5-codex', name: 'GPT-5 Codex' }] },
  { key: 'machineroom', name: 'MachineRoom', models: [] },
]

const ORCHESTRATORS = [
  {
    id: 'orchestrator',
    name: 'Orchestrator',
    harness: 'claude',
    model: 'sonnet',
    harnesses: ORCH_HARNESSES,
  },
]

const NONE_READY = {
  harnesses: [
    { key: 'claude', name: 'Claude Code', available: true, ready: false, enabled: true },
    { key: 'opencode', name: 'OpenCode', available: true, ready: false, enabled: true },
    { key: 'machineroom', name: 'MachineRoom', available: false, ready: false, enabled: true },
  ],
}

function makeClient({ harnesses = HARNESSES, nodes = NODES, orchestrators = ORCHESTRATORS } = {}) {
  return {
    family: async () => ({ nodes, keys: [], proposals: [] }),
    lanes: async () => LANES,
    harnesses: async () => harnesses,
    harnessModels: async (options = {}) => ({
      harness: typeof options === 'string' ? options : options.harness ?? '',
      models: [],
    }),
    models: async () => ({ models: [] }),
    keys: async () => ({ keys: [] }),
    orchestrators: async () => orchestrators,
    setLadder: async () => ({ ok: true }),
    setAgentLabel: async () => ({ ok: true }),
  }
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

function optionValues(select) {
  return select.querySelectorAll('option').map((option) => option.getAttribute('value'))
}

function pillLabels(container) {
  const form = container.querySelector('.mr-family-child')
  if (!form) return []
  return form.querySelectorAll('.mr-side-harness').map((pill) => pill.textContent.trim())
}

function isOff(button) {
  return button.disabled === true || button.getAttribute('disabled') !== null
}

describe('the ready harness rule', () => {
  it('drops a harness that is not ready, one that is off and Direct API with no key', () => {
    expect(childHarnesses(HARNESSES).map((row) => row.key)).toEqual(['claude', 'opencode'])
    const groups = harnessGroups(HARNESSES)
    expect(groups.ready.map((row) => row.key)).toEqual(['claude', 'opencode'])
    expect(groups.notReady.map((row) => row.key)).toEqual(['copilot', 'codex', 'machineroom'])
  })

  it('uses available when an older bridge sends no ready field', () => {
    const older = {
      harnesses: [
        { key: 'claude', name: 'Claude Code', available: true },
        { key: 'agy', name: 'Antigravity', available: false },
        { key: 'machineroom', name: 'MachineRoom', available: true },
      ],
    }
    expect(childHarnesses(older).map((row) => row.key)).toEqual(['claude', 'machineroom'])
    expect(harnessReady({ key: 'claude', available: true })).toBe(true)
    expect(harnessReady({ key: 'agy', available: false })).toBe(false)
  })

  it('offers Direct API only when a key or an endpoint is saved', () => {
    expect(directHarness(HARNESSES).ready).toBe(false)
    expect(childHarnesses(HARNESSES).map((row) => row.key)).not.toContain('machineroom')
    const saved = {
      harnesses: [
        { key: 'claude', available: true, ready: true, enabled: true },
        { key: 'machineroom', available: false, ready: true, enabled: true },
      ],
    }
    expect(childHarnesses(saved).map((row) => row.key)).toEqual(['claude', 'machineroom'])
  })

  it('never offers a harness turned off in Settings', () => {
    expect(harnessReady({ key: 'codex', ready: true, enabled: false, available: true })).toBe(false)
  })
})

describe('the add-agent pills', () => {
  it('offer only the ready harnesses', async () => {
    const client = makeClient()
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(FamilyTree, { client }))
      })
      await settle()
      await chooseAction(root, rowByLabel(container, 'Orchestrator'), 'Add a lane under this…')
      expect(pillLabels(container)).toEqual(['Claude Code', 'OpenCode'])
    })
  })

  it('still offer an older bridge harness that available names', async () => {
    const older = {
      harnesses: [
        { key: 'claude', name: 'Claude Code', available: true, models: [{ id: 'sonnet' }] },
        { key: 'machineroom', name: 'MachineRoom', available: false },
      ],
    }
    const client = makeClient({ harnesses: older, orchestrators: [{ id: 'orchestrator', name: 'Orchestrator' }] })
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(FamilyTree, { client }))
      })
      await settle()
      await chooseAction(root, rowByLabel(container, 'Orchestrator'), 'Add a lane under this…')
      expect(pillLabels(container)).toEqual(['Claude Code'])
    })
  })
})

describe('the sub form and the team form', () => {
  it('offer only the ready harnesses in the sub form', async () => {
    const client = makeClient()
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(FamilyTree, { client }))
      })
      await settle()
      await chooseAction(root, rowByLabel(container, 'OpenCode'), 'Add sub orchestrator…')
      const select = container.querySelector('select[aria-label="Sub orchestrator harness"]')
      expect(optionValues(select)).toEqual(['claude', 'opencode'])
    })
  })

  it('offer only the ready harnesses in the team form', async () => {
    const client = makeClient()
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(FamilyTeam, { client }))
      })
      await settle()
      await act(async () => {
        container.querySelector('.mr-side-head').click()
      })
      const select = container.querySelector('select[aria-label="Harness for the new sub orchestrators"]')
      expect(optionValues(select)).toEqual(['opencode', 'claude'])
    })
  })
})

describe("an orchestrator's harness select", () => {
  it('offers only the ready harnesses', async () => {
    const client = makeClient()
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(FamilyTree, { client }))
      })
      await settle()
      await act(async () => {
        rowByLabel(container, 'Orchestrator').querySelector('.mr-family-open').click()
      })
      const select = container.querySelector('select[aria-label="Harness for Orchestrator"]')
      expect(optionValues(select)).toEqual(['claude', 'opencode'])
    })
  })

  it('keeps its own harness when that one is not ready and marks it', async () => {
    const nodes = NODES.map((node) =>
      node.id === 'orchestrator' ? { ...node, harness: 'copilot', model: '' } : node
    )
    const client = makeClient({ nodes })
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(FamilyTree, { client }))
      })
      await settle()
      await act(async () => {
        rowByLabel(container, 'Orchestrator').querySelector('.mr-family-open').click()
      })
      const select = container.querySelector('select[aria-label="Harness for Orchestrator"]')
      expect(optionValues(select)).toEqual(['claude', 'opencode', 'copilot'])
      const copilot = select.querySelectorAll('option').find((option) => option.getAttribute('value') === 'copilot')
      expect(copilot.textContent).toBe('GitHub Copilot (not ready)')
      const claude = select.querySelectorAll('option').find((option) => option.getAttribute('value') === 'claude')
      expect(claude.textContent).toBe('Claude Code')
    })
  })
})

describe('a picker with nothing to offer', () => {
  it('says so in the add-agent form and keeps Create off', async () => {
    const client = makeClient({ harnesses: NONE_READY, orchestrators: [{ id: 'orchestrator', name: 'Orchestrator' }] })
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(FamilyTree, { client }))
      })
      await settle()
      await chooseAction(root, rowByLabel(container, 'Orchestrator'), 'Add a lane under this…')
      const form = container.querySelector('.mr-family-child')
      expect(form.textContent).toContain(NO_READY_HARNESS)
      expect(isOff(buttonWithText(form, 'Create'))).toBe(true)
    })
  })

  it('says so in the sub form and keeps Create off', async () => {
    const client = makeClient({ harnesses: NONE_READY, orchestrators: [{ id: 'orchestrator', name: 'Orchestrator' }] })
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(FamilyTree, { client }))
      })
      await settle()
      await chooseAction(root, rowByLabel(container, 'OpenCode'), 'Add sub orchestrator…')
      const form = container.querySelector('.mr-family-sub-form')
      expect(form.textContent).toContain(NO_READY_HARNESS)
      expect(isOff(buttonWithText(form, 'Create'))).toBe(true)
    })
  })

  it('says so in the team form and keeps Save off', async () => {
    const client = makeClient({ harnesses: NONE_READY, orchestrators: [{ id: 'orchestrator', name: 'Orchestrator' }] })
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(FamilyTeam, { client }))
      })
      await settle()
      await act(async () => {
        container.querySelector('.mr-side-head').click()
      })
      expect(container.querySelector('.mr-team-form').textContent).toContain(NO_READY_HARNESS)
      expect(buttonWithText(container, 'Save')).toBe(null)
    })
  })

  it('says so in an orchestrator editor with no harness', async () => {
    const nodes = [
      { id: 'orchestrator', kind: 'orchestrator', label: 'Orchestrator', harness: '', parent: null, children: ['frontend'] },
      { id: 'frontend', kind: 'sub', label: 'Frontend', harness: '', parent: 'orchestrator' },
    ]
    const client = makeClient({ harnesses: NONE_READY, nodes, orchestrators: [{ id: 'orchestrator', name: 'Orchestrator' }] })
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(FamilyTree, { client }))
      })
      await settle()
      await act(async () => {
        rowByLabel(container, 'Frontend').querySelector('.mr-family-open').click()
      })
      const editor = container.querySelector('.mr-family-editor')
      expect(editor.textContent).toContain(NO_READY_HARNESS)
      expect(container.querySelector('select[aria-label="Harness for Frontend"]')).toBe(null)
      expect(isOff(buttonWithText(editor, 'Save'))).toBe(true)
    })
  })
})
