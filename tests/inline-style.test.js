import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { FamilyTree } from '../src/ui/FamilyTree.jsx'
import OrchestratorChat from '../src/ui/OrchestratorChat.jsx'
import { classesOf, withDom } from './helpers/uiDom.js'

const CSS = readFileSync(fileURLToPath(new URL('../src/styles.css', import.meta.url)), 'utf8')

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

function makeFamilyClient(initialSubs = []) {
  const subs = initialSubs.map((sub) => ({
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
    const nodes = [
      {
        id: 'orchestrator',
        kind: 'orchestrator',
        label: 'Orchestrator',
        harness: 'claude',
        model: 'opus',
        effort: 'high',
        parent: null,
        children: [
          ...subs.map((sub) => sub.id),
          ...BASE_LANES.filter((lane) => !claimed.has(lane.key)).map((lane) => lane.key),
        ],
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

  return {
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
    orchestrators: async () => [
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
    ],
    setLadder: async () => ({ ok: true }),
    setAgentLabel: async () => ({ ok: true }),
  }
}

function styleKeys(element) {
  return Object.keys(element.style ?? {})
}

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = CSS.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  return match ? match[1] : ''
}

function declarations(selector) {
  return ruleBody(selector)
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
}

describe('the sub scope box', () => {
  it('renders the scope textarea with the mr-side-scope class and no inline style', async () => {
    const client = makeFamilyClient([
      {
        id: 'frontend',
        name: 'Frontend',
        harness: 'opencode',
        model: 'opencode-go/deepseek-v4.1-flash',
        lanes: ['opencode2'],
        scope: ['src/ui/**'],
      },
    ])
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(FamilyTree, { client }))
      })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      const row = container.querySelectorAll('.mr-family-node').find((item) => {
        const label = item.querySelector('.mr-family-label')
        return label !== null && label.textContent === 'Frontend'
      })
      await act(async () => {
        row.querySelector('.mr-family-open').click()
      })
      const scope = container.querySelector('textarea[aria-label="Scope for Frontend"]')
      expect(scope).not.toBeNull()
      expect(classesOf(scope)).toContain('mr-side-scope')
      expect(scope.hasAttribute('style')).toBe(false)
      expect(styleKeys(scope)).toEqual([])
    })
  })

  it('keeps the mr-side-scope rule in the stylesheet', () => {
    expect(declarations('.mr-side-scope')).toEqual([
      'height: auto',
      'min-height: 40px',
      'padding: 4px',
      'resize: vertical',
    ])
  })
})

describe('the chat worktree switch', () => {
  const LANES = [{ key: 'opencode', name: 'OpenCode', cli: { bin: 'opencode' } }]

  function chatClient() {
    return {
      orchestrator: async () => ({ state: 'idle', messages: [{ id: 'm1', from: 'owner', text: 'Hello.' }] }),
      orchestrators: async () => [],
      sendOrchestrator: async () => ({ id: 'm2' }),
      stopOrchestrator: async () => ({ ok: true }),
      subscribe: () => () => {},
    }
  }

  it('renders the worktree switch with no inline style', async () => {
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(OrchestratorChat, {
            client: chatClient(),
            inline: true,
            initialChat: { state: 'idle', messages: [{ id: 'm1', from: 'owner', text: 'Hello.' }] },
            lanes: LANES,
          })
        )
      })
      await act(async () => {})
      const toSelect = container.querySelector('select[aria-label="To"]')
      await act(async () => {
        toSelect.value = 'opencode'
        toSelect.dispatchEvent({ type: 'change', bubbles: true })
      })
      const worktree = container.querySelector('button[role="switch"][aria-label="Worktree"]')
      expect(classesOf(worktree)).toContain('ui-switch')
      expect(worktree.hasAttribute('style')).toBe(false)
      expect(styleKeys(worktree)).toEqual([])
    })
  })

  it('keeps the worktree switch layout in the shared stylesheet', () => {
    expect(declarations('button.ui-switch')).toContain('display: inline-flex')
  })
})
