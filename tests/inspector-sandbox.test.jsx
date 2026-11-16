import { act } from 'react'
import { rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { sandboxSummary } from '../src/control/modes.js'
import Inspector from '../src/ui/Inspector.jsx'
import { buildFamilyNodes } from '../server/family.js'
import { makeTempDir } from './helpers/tempRoot.js'
import { settle, withDom } from './helpers/uiDom.js'

const cleanups = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()()
})

function tempDir(prefix) {
  const dir = makeTempDir(prefix)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

async function mount(root, props) {
  await act(async () => {
    root.render(<Inspector {...props} />)
  })
  await settle(10)
}

function rowValue(container, label) {
  const row = container.querySelectorAll('.mr-inspector-row').find((item) => item.querySelector('dt')?.textContent === label)
  return row ? row.querySelector('dd')?.textContent ?? null : null
}

describe('sandboxSummary', () => {
  it('describes each Codex effective mode without overclaiming', () => {
    expect(sandboxSummary('codex', 'plan')).toBe('Read-only OS sandbox')
    expect(sandboxSummary('codex', 'edits')).toBe('OS sandbox, writes stay in the worktree')
    expect(sandboxSummary('codex', 'auto')).toBe('OS sandbox, writes stay in the worktree')
    expect(sandboxSummary('codex', 'bypass')).toBe('No sandbox')
    expect(sandboxSummary('codex')).toBe('OS sandbox, writes stay in the worktree')
    expect(sandboxSummary('codex', 'choice')).toBe('OS sandbox, writes stay in the worktree')
    expect(sandboxSummary('codex_local', 'plan')).toBe('Read-only OS sandbox')
  })

  it('describes Claude Code permission checks and Bypass', () => {
    expect(sandboxSummary('claude', 'bypass')).toBe('No permission checks')
    expect(sandboxSummary('claude')).toBe('No permission checks')
    expect(sandboxSummary('claude', 'plan')).toBe('Permission checks, file edits stay in the project; shell commands are not sandboxed')
    expect(sandboxSummary('claude', 'ask')).toBe('Permission checks, file edits stay in the project; shell commands are not sandboxed')
    expect(sandboxSummary('claude', 'edits')).toBe('Permission checks, file edits stay in the project; shell commands are not sandboxed')
    expect(sandboxSummary('claude', 'auto')).toBe('Permission checks, file edits stay in the project; shell commands are not sandboxed')
    expect(sandboxSummary('claude', 'choice')).toBe('Permission checks, file edits stay in the project; shell commands are not sandboxed')
  })

  it('describes OpenCode permission rules and Bypass', () => {
    expect(sandboxSummary('opencode', 'bypass')).toBe('No permission rules')
    expect(sandboxSummary('opencode', 'plan')).toBe('Permission rules, file edits stay in the project; no OS sandbox')
    expect(sandboxSummary('opencode', 'edits')).toBe('Permission rules, file edits stay in the project; no OS sandbox')
    expect(sandboxSummary('opencode', 'auto')).toBe('Permission rules, file edits stay in the project; no OS sandbox')
    expect(sandboxSummary('opencode')).toBe('Permission rules, file edits stay in the project; no OS sandbox')
    expect(sandboxSummary('opencode', 'choice')).toBe('Permission rules, file edits stay in the project; no OS sandbox')
  })

  it('describes native, AGY, ACP and unknown harnesses', () => {
    for (const mode of [undefined, 'plan', 'ask', 'edits', 'auto', 'bypass']) {
      expect(sandboxSummary('machineroom', mode)).toBe('File tools stay in the project; shell commands are not sandboxed')
      expect(sandboxSummary('agy', mode)).toBe('No permission checks')
      expect(sandboxSummary('acp', mode)).toBe('Approves every request the agent asks for')
    }
    expect(sandboxSummary('hermes')).toBe('Unknown')
    expect(sandboxSummary('copilot', 'auto')).toBe('Unknown')
    expect(sandboxSummary('other')).toBe('Unknown')
    expect(sandboxSummary('')).toBe('Unknown')
    expect(sandboxSummary(null)).toBe('Unknown')
  })
})

describe('Inspector Sandbox row', () => {
  it('shows the Sandbox row for a Codex Auto lane and an AGY lane', async () => {
    const codex = {
      key: 'codex',
      name: 'Codex',
      harness: 'codex',
      model: 'gpt-6.1-terra',
      mode: 'auto',
      status: 'idle',
      openCalls: 0,
    }
    const agy = {
      key: 'agy',
      name: 'agy',
      harness: 'agy',
      model: 'gemini-4-hydrogen-xhigh',
      mode: 'plan',
      status: 'idle',
      openCalls: 0,
    }

    await withDom(async ({ container, root }) => {
      await mount(root, {
        target: { kind: 'agent', id: 'codex' },
        live: true,
        bridge: false,
        lanes: [codex, agy],
        liveRuns: [],
        tasks: [],
        log: [],
      })
      const labels = container.querySelectorAll('.mr-inspector-row').map((node) => node.querySelector('dt')?.textContent)
      expect(labels.slice(0, 6)).toEqual(['State', 'Harness', 'Model', 'Effort', 'Sandbox', 'Task'])
      expect(rowValue(container, 'Sandbox')).toBe('OS sandbox, writes stay in the worktree')

      await mount(root, {
        target: { kind: 'agent', id: 'agy' },
        live: true,
        bridge: false,
        lanes: [codex, agy],
        liveRuns: [],
        tasks: [],
        log: [],
      })
      expect(rowValue(container, 'Sandbox')).toBe('No permission checks')
    })
  })

  it('shows the Sandbox row for Main and a sub orchestrator', async () => {
    const mainLane = {
      id: 'orchestrator',
      key: 'orchestrator',
      name: 'Orchestrator',
      harness: 'claude',
      model: 'claude-opus-5-5',
      status: 'idle',
      openCalls: 0,
    }
    const subLane = {
      id: 'sub-ui',
      key: 'sub-ui',
      name: 'UI',
      harness: 'opencode',
      model: 'deepseek',
      status: 'idle',
      openCalls: 0,
      subOrchestrator: true,
    }
    const orchestrators = [
      { id: 'orchestrator', name: 'Orchestrator', harness: 'claude', model: 'claude-opus-5-5', mode: 'auto', state: 'idle' },
      { id: 'ui', name: 'UI', harness: 'opencode', model: 'deepseek', mode: 'edits', state: 'idle' },
    ]
    const client = {
      orchestrator: async (id) => ({
        state: 'idle',
        mode: id === 'ui' ? 'edits' : 'auto',
        messages: [],
      }),
    }

    await withDom(async ({ container, root }) => {
      await mount(root, {
        target: { kind: 'agent', id: 'orchestrator' },
        live: true,
        bridge: true,
        client,
        lanes: [mainLane, subLane],
        orchestrator: orchestrators,
        liveRuns: [],
        tasks: [],
        log: [],
      })
      expect(rowValue(container, 'Sandbox')).toBe(
        'Permission checks, file edits stay in the project; shell commands are not sandboxed'
      )

      await mount(root, {
        target: { kind: 'agent', id: 'sub-ui' },
        live: true,
        bridge: true,
        client,
        lanes: [mainLane, subLane],
        orchestrator: orchestrators,
        liveRuns: [],
        tasks: [],
        log: [],
      })
      expect(rowValue(container, 'Sandbox')).toBe(
        'Permission rules, file edits stay in the project; no OS sandbox'
      )
    })
  })

  it('reads a lane mode from family and client.lanes() and updates on agents notices', async () => {
    const rootDir = tempDir('mr-fam-mode-')
    const runsDir = tempDir('mr-fam-runs-')
    const family = buildFamilyNodes({
      projectRoot: rootDir,
      runsFolder: runsDir,
      lanesConfig: {
        orchestrator: { name: 'Orchestrator', cli: { harness: 'claude', bin: 'claude', model: 'opus' } },
        codex: { name: 'Codex', cli: { harness: 'codex', bin: 'codex', model: 'gpt-6.1-terra', mode: 'plan' } },
      },
      orchestrators: {
        find: (id) => (id === 'orchestrator' ? { answer: () => ({ harness: 'claude', model: 'opus', mode: 'auto', state: 'idle' }) } : null),
        getLadder: () => ({ subs: [] }),
      },
    })
    expect(family.find((node) => node.id === 'orchestrator').mode).toBe('auto')
    expect(family.find((node) => node.id === 'codex').mode).toBe('plan')

    let savedMode = 'plan'
    const listeners = new Set()
    const client = {
      lanes: async () => ({ lanes: [{ key: 'codex', harness: 'codex', mode: savedMode }] }),
      subscribe(fn) {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
    }

    await withDom(async ({ container, root }) => {
      await mount(root, {
        target: { kind: 'agent', id: 'codex' },
        live: true,
        bridge: true,
        client,
        lanes: [{ key: 'codex', name: 'Codex', harness: 'codex', model: 'gpt-6.1-terra', status: 'idle', openCalls: 0 }],
        family,
        liveRuns: [],
        tasks: [],
        log: [],
      })
      expect(rowValue(container, 'Sandbox')).toBe('Read-only OS sandbox')

      savedMode = 'bypass'
      for (const listener of listeners) listener({ topic: 'agents' })
      await settle(80)
      expect(rowValue(container, 'Sandbox')).toBe('No sandbox')
    })
  })
})
