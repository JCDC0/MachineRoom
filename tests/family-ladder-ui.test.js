import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import FamilyTeam from '../src/ui/FamilyTeam.jsx'
import FamilyTree from '../src/ui/FamilyTree.jsx'
import { buttonWithText, settle, withDom } from './helpers/uiDom.js'

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

describe('FamilyTree ladder changes', () => {
  it('names the other sub that loses its lanes on the add card', async () => {
    const orchestrators = [
      { id: 'orchestrator', name: 'Orchestrator' },
      { id: 'frontend', name: 'Frontend', harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash', lanes: ['opencode2'] },
    ]
    const { client } = makeClient(orchestrators)
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(FamilyTree, { client }))
      })
      await settle()
      await act(async () => {
        container.querySelector('.mr-family-more-head').click()
      })

      for (const label of ['OpenCode 2', 'OpenCode']) {
        const check = rowByLabel(container, label).querySelector('.mr-family-check')
        await act(async () => {
          check.checked = true
          check.click()
        })
      }
      await act(async () => {
        buttonWithText(container, 'Add sub orchestrator').click()
      })
      const form = container.querySelector('.mr-family-sub-form')
      await act(async () => {
        form.dispatchEvent({ type: 'submit', bubbles: true, cancelable: true })
      })

      const card = container.querySelector('.mr-side-confirm-card')
      expect(card.textContent).toContain('Frontend goes away.')
    })
  })

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
  it('stops the build when a sub was added while the card was open', async () => {
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

      orchestrators.push({ id: 'backend', name: 'Backend', harness: 'opencode', model: '', lanes: ['opencode'] })
      await act(async () => {
        buttonWithText(card, 'Build the team').click()
      })
      await settle()

      expect(calls.setLadder).toHaveLength(0)
      expect(calls.setAgentLabel).toHaveLength(0)
      expect(container.textContent).toContain('The team changed while the card was open. Open it again.')
    })
  })
})

describe('Sub form harnesses from orchestrators', () => {
  it('offers every active harness from orchestrators in FamilyTree and keeps codex on save', async () => {
    const activeHarnesses = [
      { key: 'claude', name: 'Claude Code', harness: 'claude', models: [{ id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' }] },
      { key: 'opencode', name: 'OpenCode', harness: 'opencode', models: [{ id: 'opencode/deepseek-v4.1-flash-free', name: 'DeepSeek' }] },
      { key: 'codex', name: 'Codex', harness: 'codex', models: [{ id: 'gpt-5-codex', name: 'GPT-5 Codex' }] },
      { key: 'agy', name: 'AGY', harness: 'agy', models: [{ id: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen' }] },
    ]
    const { client, calls } = makeClient({
      orchestrators: [
        { id: 'orchestrator', name: 'Orchestrator', main: true, harness: 'claude', model: 'claude-sonnet-5-5', harnesses: activeHarnesses, ladder: { subs: [] } },
      ],
    })
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(FamilyTree, { client }))
      })
      await settle()
      const check = rowByLabel(container, 'OpenCode').querySelector('.mr-family-check')
      await act(async () => {
        check.checked = true
        check.click()
      })
      await act(async () => {
        buttonWithText(container, 'Add sub orchestrator').click()
      })
      const form = container.querySelector('.mr-family-sub-form')
      const harnessSelect = form.querySelector('select[aria-label="Sub orchestrator harness"]')
      const keys = harnessSelect.querySelectorAll('option').map((option) => option.value ?? option.getAttribute('value'))
      expect(keys).toEqual(['claude', 'opencode', 'codex', 'agy'])

      await act(async () => {
        harnessSelect.value = 'codex'
        harnessSelect.dispatchEvent({ type: 'change', bubbles: true, cancelable: true })
      })
      const label = form.querySelector('input[aria-label="Sub orchestrator label"]')
      await act(async () => {
        label.focus()
        label.dispatchEvent({ type: 'focusin', bubbles: true, cancelable: true })
        label.value = 'Codex Lead'
        label.dispatchEvent({ type: 'keyup', bubbles: true, cancelable: true })
      })
      await act(async () => {
        form.dispatchEvent({ type: 'submit', bubbles: true, cancelable: true })
      })
      await settle()
      const card = container.querySelector('.mr-side-confirm-card')
      await act(async () => {
        buttonWithText(card, 'Create').click()
      })
      await settle()
      expect(calls.setLadder).toHaveLength(1)
      expect(calls.setLadder[0].subs[0]).toMatchObject({
        name: 'Codex Lead',
        harness: 'codex',
        model: 'gpt-5-codex',
      })
    })
  })

  it('offers every active harness from orchestrators in FamilyTeam and keeps codex on build', async () => {
    const activeHarnesses = [
      { key: 'claude', name: 'Claude Code', harness: 'claude', models: [{ id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' }] },
      { key: 'opencode', name: 'OpenCode', harness: 'opencode', models: [{ id: 'opencode/deepseek-v4.1-flash-free', name: 'DeepSeek' }] },
      { key: 'codex', name: 'Codex', harness: 'codex', models: [{ id: 'gpt-5-codex', name: 'GPT-5 Codex' }] },
      { key: 'agy', name: 'AGY', harness: 'agy', models: [{ id: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen' }] },
    ]
    const { client, calls } = makeClient({
      orchestrators: [
        { id: 'orchestrator', name: 'Orchestrator', main: true, harness: 'claude', model: 'claude-sonnet-5-5', harnesses: activeHarnesses, ladder: { subs: [] } },
      ],
    })
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(FamilyTeam, { client }))
      })
      await settle()
      await act(async () => {
        container.querySelector('.mr-side-head').click()
      })
      const harnessSelect = container.querySelector('select[aria-label="Harness for the new sub orchestrators"]')
      const keys = harnessSelect.querySelectorAll('option').map((option) => option.value ?? option.getAttribute('value'))
      expect(keys).toEqual(['opencode', 'claude', 'codex', 'agy'])

      await act(async () => {
        harnessSelect.value = 'codex'
        harnessSelect.dispatchEvent({ type: 'change', bubbles: true, cancelable: true })
      })
      const form = container.querySelector('form')
      await act(async () => {
        form.dispatchEvent({ type: 'submit', bubbles: true, cancelable: true })
      })
      await settle()
      const card = container.querySelector('.mr-side-confirm-card')
      await act(async () => {
        buttonWithText(card, 'Build the team').click()
      })
      await settle()
      expect(calls.setLadder).toHaveLength(1)
      expect(calls.setLadder[0].subs[0]).toMatchObject({
        harness: 'codex',
        model: 'gpt-5-codex',
      })
    })
  })
})
