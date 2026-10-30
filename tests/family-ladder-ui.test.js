import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import FamilyTeam from '../src/ui/FamilyTeam.jsx'
import FamilyTree from '../src/ui/FamilyTree.jsx'
import { buttonWithText, withDom } from './helpers/handDom.js'

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
  ],
}

function makeClient(orchestrators) {
  const calls = { setLadder: [], setAgentLabel: [] }
  const client = {
    family: async () => FAMILY,
    lanes: async () => LANES,
    harnesses: async () => HARNESSES,
    harnessModels: async (options = {}) => ({
      harness: typeof options === 'string' ? options : options.harness ?? '',
      models: [],
    }),
    models: async () => ({ models: [] }),
    keys: async () => ({ keys: [] }),
    orchestrators: async () => orchestrators,
    setLadder: async (payload) => {
      calls.setLadder.push(payload)
      return { ok: true }
    },
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

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('FamilyTree ladder changes', () => {
  it('keeps a sub that was added while the remove card was open', async () => {
    const orchestrators = [
      { id: 'orchestrator', name: 'Orchestrator' },
      { id: 'frontend', name: 'Frontend', harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash', lanes: ['opencode2'] },
    ]
    const { client, calls } = makeClient(orchestrators)
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(FamilyTree, { client }))
      })
      await settle()

      const trash = rowByLabel(container, 'Frontend').querySelector('.mr-family-trash')
      await act(async () => {
        trash.click()
      })
      const card = container.querySelector('.mr-side-confirm-card')
      expect(card.textContent).toContain('Remove "Frontend"?')

      orchestrators.push({ id: 'backend', name: 'Backend', harness: 'opencode', model: '', lanes: [] })
      await act(async () => {
        buttonWithText(card, 'Remove').click()
      })
      await settle()

      expect(calls.setLadder).toHaveLength(1)
      expect(calls.setLadder[0].subs.map((sub) => sub.id)).toEqual(['backend'])
    })
  })
})

describe('FamilyTeam ladder changes', () => {
  it('keeps a sub that was added while the build card was open', async () => {
    const orchestrators = [
      { id: 'orchestrator', name: 'Orchestrator' },
      { id: 'frontend', name: 'Frontend', harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash', lanes: ['opencode2'] },
    ]
    const { client, calls } = makeClient(orchestrators)
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(FamilyTeam, { client }))
      })
      await settle()

      const head = container.querySelector('.mr-team').querySelector('.mr-side-head')
      await act(async () => {
        head.click()
      })
      const form = container.querySelector('.mr-team-form')
      await act(async () => {
        form.dispatchEvent({ type: 'submit', bubbles: true, cancelable: true })
      })
      const card = container.querySelector('.mr-side-confirm-card')
      expect(card.textContent).toContain('Build 1 sub orchestrator?')

      orchestrators.push({ id: 'backend', name: 'Backend', harness: 'opencode', model: '', lanes: [] })
      await act(async () => {
        buttonWithText(card, 'Build the team').click()
      })
      await settle()

      expect(calls.setLadder).toHaveLength(1)
      expect(calls.setLadder[0].subs.map((sub) => sub.id)).toEqual(['frontend', 'backend', 'team-1'])
      expect(calls.setAgentLabel).toEqual([{ id: 'team-1', label: 'Team 1', confirmed: true }])
    })
  })
})
