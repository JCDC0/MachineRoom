import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { FamilyTree } from '../src/ui/FamilyTree.jsx'
import * as ladderForm from '../src/ui/ladderForm.js'
import { buttonWithText, click, settle, type, withDom } from './helpers/uiDom.js'

const SCOPE_NOTE =
  "A restricted sub's lanes cannot merge files outside its scope without the orchestrator above."

const BASE_LANES = [
  { key: 'opencode', name: 'OpenCode', harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash', effort: 'max', active: true },
  { key: 'opencode2', name: 'OpenCode 2', harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash', effort: 'max', active: true },
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
  ],
}

function makeClient(initialSubs = []) {
  const calls = { setLadder: [] }
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
    setLadder: async (payload) => {
      calls.setLadder.push(payload)
      subs = (payload?.subs ?? []).map((sub) => ({
        ...sub,
        lanes: [...(sub.lanes ?? [])],
        scope: [...(sub.scope ?? [])],
        restricted: sub.restricted === true,
      }))
      return { ok: true }
    },
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

async function toggleCheckbox(root, box, checked) {
  await act(async () => {
    box.checked = checked
    box.click()
  })
}

async function openSubForm(root, container, laneLabel = 'OpenCode') {
  const row = rowByLabel(container, laneLabel)
  await click(root, row.querySelector('[aria-haspopup="menu"]'))
  await click(root, buttonWithText(row.ownerDocument.body.querySelector('[role="menu"]'), 'Make sub from this lane…'))
  return container.querySelector('.mr-family-sub-form')
}

async function openSubEditor(root, container, label) {
  await click(root, rowByLabel(container, label).querySelector('.mr-family-open'))
  return container.querySelector('.mr-family-editor')
}

describe('ladderForm scope helpers', () => {
  it('defaults an empty scope to ["**"] and trims non-empty lines', () => {
    expect(ladderForm.subScope('')).toEqual(['**'])
    expect(ladderForm.subScope('  \n \r\n ')).toEqual(['**'])
    expect(ladderForm.subScope('  src/ui/**  \n\n server/** \nsrc/ui/**')).toEqual(['src/ui/**', 'server/**'])
    expect(ladderForm.scopeText([])).toBe('**')
    expect(ladderForm.scopeText(['src/ui/**', 'server/**'])).toBe('src/ui/**\nserver/**')
  })

  it('updates a sub scope and restriction in the ladder', () => {
    const ladder = {
      subs: [
        {
          id: 'frontend',
          name: 'Frontend',
          harness: 'opencode',
          model: '',
          lanes: ['opencode2'],
          scope: ['**'],
          restricted: false,
          setBy: 'orchestrator',
        },
      ],
    }
    const result = ladderForm.setSubScope(ladder, 'frontend', {
      scope: '  server/** \n\n tests/** ',
      restricted: true,
    })
    expect(result.problem).toBe('')
    expect(result.subs[0]).toMatchObject({
      id: 'frontend',
      scope: ['server/**', 'tests/**'],
      restricted: true,
      setBy: 'owner',
    })
  })
})

describe('sub orchestrator form scope and restriction', () => {
  it('shows ** and Restricted off by default with the plain warning line', async () => {
    const { client } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      const form = await openSubForm(root, container)
      const scope = form.querySelector('textarea[aria-label="Sub orchestrator scope"]')
      const restricted = form.querySelector('input[aria-label="Sub orchestrator restricted"]')
      expect(scope).not.toBeNull()
      expect(scope.value).toBe('**')
      expect(restricted).not.toBeNull()
      expect(restricted.checked).toBe(false)
      expect(form.textContent).toContain(SCOPE_NOTE)
    })
  })

  it('creating a sub with scope src/ui/** and Restricted on saves both and shows them in its editor', async () => {
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      const form = await openSubForm(root, container)
      await type(root, form.querySelector('input[aria-label="Sub orchestrator label"]'), 'UI Lead')
      await type(root, form.querySelector('textarea[aria-label="Sub orchestrator scope"]'), '  src/ui/**  \n\n ')
      await toggleCheckbox(root, form.querySelector('input[aria-label="Sub orchestrator restricted"]'), true)
      await act(async () => {
        form.dispatchEvent({ type: 'submit', bubbles: true, cancelable: true })
      })
      const card = container.querySelector('.mr-side-confirm-card')
      await click(root, buttonWithText(card, 'Create'))
      await settle()

      expect(calls.setLadder).toHaveLength(1)
      expect(calls.setLadder[0].subs).toHaveLength(1)
      expect(calls.setLadder[0].subs[0]).toMatchObject({
        id: 'ui-lead',
        scope: ['src/ui/**'],
        restricted: true,
      })

      const editor = await openSubEditor(root, container, 'UI Lead')
      expect(editor.querySelector('textarea[aria-label="Scope for UI Lead"]').value).toBe('src/ui/**')
      expect(editor.querySelector('input[aria-label="Restricted for UI Lead"]').checked).toBe(true)
    })
  })

  it('creating a sub with an empty scope saves ["**"]', async () => {
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      const form = await openSubForm(root, container)
      await type(root, form.querySelector('input[aria-label="Sub orchestrator label"]'), 'Open Lead')
      await type(root, form.querySelector('textarea[aria-label="Sub orchestrator scope"]'), '  \n  ')
      await act(async () => {
        form.dispatchEvent({ type: 'submit', bubbles: true, cancelable: true })
      })
      const card = container.querySelector('.mr-side-confirm-card')
      await click(root, buttonWithText(card, 'Create'))
      await settle()

      expect(calls.setLadder).toHaveLength(1)
      expect(calls.setLadder[0].subs[0]).toMatchObject({
        id: 'open-lead',
        scope: ['**'],
        restricted: false,
      })
    })
  })
})

describe('sub orchestrator editor scope and restriction', () => {
  it('editing a sub to server/** saves it and reopens with it', async () => {
    const { client, calls } = makeClient([
      {
        id: 'frontend',
        name: 'Frontend',
        harness: 'opencode',
        model: 'opencode-go/deepseek-v4.1-flash',
        lanes: ['opencode2'],
        scope: ['src/ui/**'],
        restricted: false,
      },
    ])
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      let editor = await openSubEditor(root, container, 'Frontend')
      const scope = editor.querySelector('textarea[aria-label="Scope for Frontend"]')
      const restricted = editor.querySelector('input[aria-label="Restricted for Frontend"]')
      expect(scope.value).toBe('src/ui/**')
      expect(restricted.checked).toBe(false)
      expect(editor.textContent).toContain(SCOPE_NOTE)

      await type(root, scope, '  server/** \n ')
      await toggleCheckbox(root, restricted, true)
      await click(root, buttonWithText(editor, 'Save scope'))
      const card = container.querySelector('.mr-side-confirm-card')
      await click(root, buttonWithText(card, 'Save'))
      await settle()

      expect(calls.setLadder).toHaveLength(1)
      expect(calls.setLadder[0].subs[0]).toMatchObject({
        id: 'frontend',
        scope: ['server/**'],
        restricted: true,
      })

      await click(root, buttonWithText(editor, 'Close'))
      expect(container.querySelector('.mr-family-editor')).toBeNull()

      editor = await openSubEditor(root, container, 'Frontend')
      expect(editor.querySelector('textarea[aria-label="Scope for Frontend"]').value).toBe('server/**')
      expect(editor.querySelector('input[aria-label="Restricted for Frontend"]').checked).toBe(true)
    })
  })

  it('editing a sub to an empty scope saves ["**"] and reopens with **', async () => {
    const { client, calls } = makeClient([
      {
        id: 'frontend',
        name: 'Frontend',
        harness: 'opencode',
        model: 'opencode-go/deepseek-v4.1-flash',
        lanes: ['opencode2'],
        scope: ['src/ui/**'],
        restricted: true,
      },
    ])
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      let editor = await openSubEditor(root, container, 'Frontend')
      await type(root, editor.querySelector('textarea[aria-label="Scope for Frontend"]'), '\n   \n')
      await toggleCheckbox(root, editor.querySelector('input[aria-label="Restricted for Frontend"]'), false)
      await click(root, buttonWithText(editor, 'Save scope'))
      const card = container.querySelector('.mr-side-confirm-card')
      await click(root, buttonWithText(card, 'Save'))
      await settle()

      expect(calls.setLadder).toHaveLength(1)
      expect(calls.setLadder[0].subs[0]).toMatchObject({
        id: 'frontend',
        scope: ['**'],
        restricted: false,
      })

      await click(root, buttonWithText(editor, 'Close'))
      editor = await openSubEditor(root, container, 'Frontend')
      expect(editor.querySelector('textarea[aria-label="Scope for Frontend"]').value).toBe('**')
      expect(editor.querySelector('input[aria-label="Restricted for Frontend"]').checked).toBe(false)
    })
  })
})
