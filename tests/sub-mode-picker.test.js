import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import FamilyTree from '../src/ui/FamilyTree.jsx'
import * as ladderForm from '../src/ui/ladderForm.js'
import { buttonWithText, click, settle, type, withDom } from './helpers/uiDom.js'

const BASE_LANES = [
  { key: 'opencode', name: 'OpenCode', harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash', effort: 'max', active: true },
  { key: 'claude', name: 'Claude', harness: 'claude', model: 'opus', effort: 'high', active: true },
]

const HARNESSES = {
  harnesses: [
    {
      key: 'claude',
      name: 'Claude Code',
      available: true,
      ready: true,
      models: [{ id: 'sonnet', label: 'Sonnet' }],
      efforts: ['low', 'high'],
    },
    {
      key: 'opencode',
      name: 'OpenCode',
      available: true,
      ready: true,
      models: [{ id: 'opencode-go/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' }],
      efforts: ['low', 'max'],
    },
    {
      key: 'hermes',
      name: 'Hermes',
      available: true,
      ready: true,
      models: [{ id: 'hermes-3', label: 'Hermes 3' }],
      efforts: [],
    },
  ],
}

function makeClient(initialSubs = [], { failMode = '' } = {}) {
  const calls = { setLadder: [], setOrchestratorMode: [], order: [] }
  let subs = initialSubs.map((sub) => ({
    ...sub,
    lanes: [...(sub.lanes ?? [])],
    scope: [...(sub.scope ?? ['**'])],
    restricted: Boolean(sub.restricted),
  }))

  function buildFamily() {
    const claimed = new Map()
    for (const sub of subs) {
      for (const lane of sub.lanes) claimed.set(lane, sub.id)
    }
    const mainChildren = [
      ...subs.map((sub) => sub.id),
      ...BASE_LANES.filter((lane) => !claimed.has(lane.key)).map((lane) => lane.key),
    ]
    const nodes = [
      {
        id: 'orchestrator',
        kind: 'orchestrator',
        label: 'Orchestrator',
        harness: 'claude',
        model: 'opus',
        effort: 'high',
        parent: null,
        children: mainChildren,
        active: true,
        working: false,
      },
      ...subs.map((sub) => ({
        id: sub.id,
        kind: 'sub',
        label: sub.name,
        harness: sub.harness,
        model: sub.model ?? '',
        effort: sub.effort ?? '',
        parent: 'orchestrator',
        children: [...sub.lanes],
        active: true,
        working: false,
      })),
      ...BASE_LANES.map((lane) => ({
        id: lane.key,
        kind: 'lane',
        label: lane.name,
        harness: lane.harness,
        model: lane.model,
        effort: lane.effort,
        parent: claimed.get(lane.key) ?? 'orchestrator',
        active: lane.active,
        working: false,
      })),
    ]
    return { nodes, keys: [], proposals: [] }
  }

  function buildOrchestrators() {
    return [
      { id: 'orchestrator', name: 'Orchestrator', harness: 'claude', model: 'opus', lanes: [], scope: [], restricted: false },
      ...subs.map((sub) => ({
        id: sub.id,
        name: sub.name,
        harness: sub.harness,
        model: sub.model ?? '',
        effort: sub.effort ?? null,
        mode: sub.mode ?? 'auto',
        lanes: [...sub.lanes],
        scope: [...sub.scope],
        restricted: sub.restricted === true,
        setBy: sub.setBy ?? 'owner',
      })),
    ]
  }

  const client = {
    family: async () => buildFamily(),
    lanes: async () => ({
      lanes: BASE_LANES.map(({ key, name, harness, active }) => ({ key, name, harness, active })),
      max: 4,
      chosen: true,
    }),
    harnesses: async () => HARNESSES,
    harnessModels: async (options = {}) => ({
      harness: typeof options === 'string' ? options : options.harness ?? '',
      models: [],
    }),
    models: async () => ({ models: [] }),
    keys: async () => ({ keys: [] }),
    laneBackups: async () => ({}),
    orchestrators: async () => buildOrchestrators(),
    orchestrator: async (id) => {
      const found = buildOrchestrators().find((entry) => entry.id === id)
      return found ? { ...found, messages: [] } : null
    },
    setLadder: async (payload) => {
      calls.order.push('setLadder')
      calls.setLadder.push(payload)
      subs = (payload?.subs ?? []).map((sub) => ({
        ...sub,
        lanes: [...(sub.lanes ?? [])],
        scope: [...(sub.scope ?? [])],
        restricted: sub.restricted === true,
      }))
      return { ok: true }
    },
    setOrchestratorMode: async (payload) => {
      calls.order.push('setOrchestratorMode')
      calls.setOrchestratorMode.push(payload)
      if (failMode) throw new Error(failMode)
      const target = subs.find((entry) => entry.id === payload?.id)
      if (target) target.mode = payload.mode
      return { ok: true, mode: payload?.mode }
    },
    setOrchestratorHarness: async () => ({ ok: true }),
    setOrchestratorEffort: async () => ({ ok: true }),
    setAgentLabel: async () => ({ ok: true }),
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

async function openSubForm(root, container, laneLabel = 'OpenCode') {
  const check = rowByLabel(container, laneLabel).querySelector('.mr-family-check')
  await act(async () => {
    check.checked = true
    check.click()
  })
  await click(root, buttonWithText(container, 'Add sub orchestrator'))
  return container.querySelector('.mr-family-sub-form')
}

async function openSubEditor(root, container, label) {
  await click(root, rowByLabel(container, label).querySelector('.mr-family-open'))
  return container.querySelector('.mr-family-editor')
}

function selectedValue(select) {
  const key = Object.keys(select).find((name) => name.startsWith('__reactProps'))
  return key ? select[key]?.value : select.value
}

describe('sub orchestrator mode picker', () => {
  it('shows Mode select with modesFor(harness) including Ask, defaulting to defaultMode, and none for hermes in Add sub', async () => {
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      const form = await openSubForm(root, container)
      const harnessSelect = form.querySelector('select[aria-label="Sub orchestrator harness"]')

      const openCodeMode = form.querySelector('select[aria-label="Sub orchestrator mode"]')
      expect(openCodeMode).not.toBeNull()
      expect(selectedValue(openCodeMode)).toBe('auto')
      expect(openCodeMode.options.map((option) => option.textContent)).toEqual(['Plan', 'Edits', 'Auto'])

      await type(root, harnessSelect, 'claude')
      await settle()
      const claudeMode = form.querySelector('select[aria-label="Sub orchestrator mode"]')
      expect(claudeMode).not.toBeNull()
      expect(selectedValue(claudeMode)).toBe('auto')
      expect(claudeMode.options.map((option) => option.textContent)).toEqual(['Plan', 'Ask', 'Edits', 'Auto', 'Bypass'])

      await type(root, harnessSelect, 'hermes')
      await settle()
      expect(form.querySelector('select[aria-label="Sub orchestrator mode"]')).toBeNull()

      await type(root, harnessSelect, 'opencode')
      await settle()
      await act(async () => {
        form.dispatchEvent({ type: 'submit', bubbles: true, cancelable: true })
      })
      await click(root, buttonWithText(container.querySelector('.mr-side-confirm-card'), 'Create'))
      await settle()
      expect(calls.setOrchestratorMode).toEqual([{ id: 'sub-orchestrator', mode: 'auto', confirmed: true }])
    })
  })

  it('shows Mode select in the sub editor with the harness modes and none when the harness has no modes', async () => {
    const { client } = makeClient([
      { id: 'lead', name: 'Lead', harness: 'claude', model: 'sonnet', effort: 'high', mode: 'ask', lanes: ['claude'], scope: ['src/**'], restricted: false },
      { id: 'silent', name: 'Silent', harness: 'hermes', model: 'hermes-3', lanes: ['opencode'], scope: ['**'], restricted: false },
    ])
    await withDom(async ({ container, root }) => {
      await mount(root, client)

      const leadEditor = await openSubEditor(root, container, 'Lead')
      const modeSelect = leadEditor.querySelector('select[aria-label="Mode for Lead"]')
      expect(modeSelect).not.toBeNull()
      expect(selectedValue(modeSelect)).toBe('ask')
      expect(modeSelect.options.map((option) => option.textContent)).toEqual(['Plan', 'Ask', 'Edits', 'Auto', 'Bypass'])

      const silentEditor = await openSubEditor(root, container, 'Silent')
      expect(silentEditor.querySelector('select[aria-label="Mode for Silent"]')).toBeNull()
    })
  })

  it('sends setOrchestratorMode with the chosen mode after setLadder on Add sub and shows errors when refused', async () => {
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      const form = await openSubForm(root, container)
      await type(root, form.querySelector('input[aria-label="Sub orchestrator label"]'), 'UI Lead')
      await type(root, form.querySelector('select[aria-label="Sub orchestrator harness"]'), 'claude')
      await settle()
      await type(root, form.querySelector('select[aria-label="Sub orchestrator mode"]'), 'ask')
      await act(async () => {
        form.dispatchEvent({ type: 'submit', bubbles: true, cancelable: true })
      })
      const card = container.querySelector('.mr-side-confirm-card')
      await click(root, buttonWithText(card, 'Create'))
      await settle()

      expect(calls.order).toEqual(['setLadder', 'setOrchestratorMode'])
      expect(calls.setLadder).toHaveLength(1)
      expect(calls.setOrchestratorMode).toEqual([{ id: 'ui-lead', mode: 'ask', confirmed: true }])
    })

    const refused = makeClient([], { failMode: 'A turn is already running.' })
    await withDom(async ({ container, root }) => {
      await mount(root, refused.client)
      const form = await openSubForm(root, container)
      await type(root, form.querySelector('input[aria-label="Sub orchestrator label"]'), 'API Lead')
      await type(root, form.querySelector('select[aria-label="Sub orchestrator harness"]'), 'claude')
      await settle()
      await type(root, form.querySelector('select[aria-label="Sub orchestrator mode"]'), 'ask')
      await act(async () => {
        form.dispatchEvent({ type: 'submit', bubbles: true, cancelable: true })
      })
      const card = container.querySelector('.mr-side-confirm-card')
      await click(root, buttonWithText(card, 'Create'))
      await settle()

      expect(refused.calls.order).toEqual(['setLadder', 'setOrchestratorMode'])
      const alert = container.querySelector('.mr-side-error[role="alert"]')
      expect(alert).not.toBeNull()
      expect(alert.textContent).toBe('A turn is already running.')
    })
  })

  it('saves chosen mode in the sub editor, shows errors on refusal, and keeps mode across later scope save', async () => {
    const { client, calls } = makeClient([
      { id: 'lead', name: 'Lead', harness: 'claude', model: 'sonnet', effort: 'high', mode: 'auto', lanes: ['claude'], scope: ['src/**'], restricted: false },
    ])
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      const editor = await openSubEditor(root, container, 'Lead')
      await type(root, editor.querySelector('select[aria-label="Mode for Lead"]'), 'ask')
      await click(root, buttonWithText(editor, 'Save'))
      const card = container.querySelector('.mr-side-confirm-card')
      await click(root, buttonWithText(card, 'Save'))
      await settle()

      expect(calls.setOrchestratorMode).toEqual([{ id: 'lead', mode: 'ask', confirmed: true }])

      await type(root, editor.querySelector('textarea[aria-label="Scope for Lead"]'), 'server/**')
      await click(root, buttonWithText(editor, 'Save scope'))
      const scopeCard = container.querySelector('.mr-side-confirm-card')
      await click(root, buttonWithText(scopeCard, 'Save'))
      await settle()

      expect(calls.setLadder).toHaveLength(1)
      expect(calls.setLadder[0].subs[0]).toMatchObject({ id: 'lead', mode: 'ask', scope: ['server/**'] })
    })

    const refused = makeClient(
      [{ id: 'lead', name: 'Lead', harness: 'claude', model: 'sonnet', effort: 'high', mode: 'auto', lanes: ['claude'], scope: ['src/**'], restricted: false }],
      { failMode: 'Choose a permission mode listed for this harness.' }
    )
    await withDom(async ({ container, root }) => {
      await mount(root, refused.client)
      const editor = await openSubEditor(root, container, 'Lead')
      await type(root, editor.querySelector('select[aria-label="Mode for Lead"]'), 'plan')
      await click(root, buttonWithText(editor, 'Save'))
      const card = container.querySelector('.mr-side-confirm-card')
      await click(root, buttonWithText(card, 'Save'))
      await settle()

      const alert = container.querySelector('.mr-side-error[role="alert"]')
      expect(alert).not.toBeNull()
      expect(alert.textContent).toBe('Choose a permission mode listed for this harness.')
    })
  })

  it('keeps mode in ladderForm.ladderFromOrchestrators when present', () => {
    const out = ladderForm.ladderFromOrchestrators([
      { id: 'orchestrator', name: 'Orchestrator', mode: 'auto' },
      { id: 'lead', name: 'Lead', harness: 'claude', model: 'sonnet', mode: 'ask', lanes: ['claude'], scope: ['**'], restricted: false, setBy: 'owner' },
    ])
    expect(out.subs[0].mode).toBe('ask')
  })
})
