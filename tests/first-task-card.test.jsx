import { readFileSync } from 'node:fs'
import { act, createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import Connect from '../src/ui/Connect.jsx'
import DispatchPanel from '../src/ui/panels/DispatchPanel.jsx'
import { clearProjectDraft } from '../src/ui/panels/runs.js'
import { buttonWithText, click, settle, type, withDom } from './helpers/uiDom.js'

const FIRST_TASK =
  'Read this repository and say what it does, how to run it and how to test it. Change nothing.'
const RECORDS_SENTENCE =
  'MachineRoom keeps its records, logs and costs on this computer; the agents still send your code to their model providers.'

const trackedProjects = []

afterEach(() => {
  while (trackedProjects.length > 0) {
    clearProjectDraft(trackedProjects.pop())
  }
})

function makeClient({
  project = 'first-task-demo',
  agents = [],
  harnesses = [],
  running = [],
  recent = [],
  routeLane = false,
  onStart,
} = {}) {
  trackedProjects.push(project)
  const startCalls = []
  let currentRunning = [...running]
  let currentRecent = [...recent]
  const client = {
    health: async () => ({ lanes: true }),
    agents: async () => agents,
    harnesses: async () => harnesses,
    runs: async () => ({ running: currentRunning, recent: currentRecent, project }),
    startRun: async (lane, body) => {
      startCalls.push({ lane, body })
      if (onStart) {
        const next = await onStart(lane, body)
        if (next && Array.isArray(next.running)) currentRunning = next.running
        if (next && Array.isArray(next.recent)) currentRecent = next.recent
      } else {
        currentRecent = [{ lane, task: body?.tasks?.[0] ?? body?.task ?? '', exitCode: 0 }]
      }
      return { lane, queue: true, tasks: 1 }
    },
  }
  if (routeLane) {
    client.routeLane = async () => ({
      lane: agents[0]?.key ?? '',
      tier: 'small',
      reason: 'Routed for test.',
      skipped: [],
    })
  }
  return { client, startCalls }
}

async function mountDispatch(root, client, agents) {
  await act(async () => {
    root.render(createElement(DispatchPanel, { client, initialAgents: agents }))
  })
  await settle(20)
}

function selectedValue(select) {
  const key = select ? Object.keys(select).find((name) => name.startsWith('__reactProps')) : ''
  if (key) return select[key]?.value ?? ''
  return select?.value ?? ''
}

describe('First task card in DispatchPanel', () => {
  it('shows for a project with no runs, picks the first ready Plan-capable lane, sets Plan and never auto-starts', async () => {
    const agents = [
      { id: 'agent-hermes', key: 'hermes', name: 'Hermes', adapterType: 'hermes_local', harness: 'hermes', role: null },
      { id: 'agent-codex', key: 'codex', name: 'Codex', adapterType: 'codex_local', harness: 'codex', role: null },
      { id: 'agent-acp', key: 'acp', name: 'ACP', adapterType: 'acp_local', harness: 'acp', role: null },
      { id: 'agent-opencode', key: 'opencode', name: 'OpenCode', adapterType: 'opencode_local', harness: 'opencode', mode: 'auto', role: null },
      { id: 'agent-claude', key: 'claude', name: 'Claude Code', adapterType: 'claude_local', harness: 'claude', mode: 'bypass', role: null },
    ]
    const harnesses = [
      { key: 'hermes', name: 'Hermes', ready: true, enabled: true },
      { key: 'codex', name: 'Codex', ready: false, enabled: true },
      { key: 'acp', name: 'ACP', ready: true, enabled: true },
      { key: 'opencode', name: 'OpenCode', ready: true, enabled: true },
      { key: 'claude', name: 'Claude Code', ready: true, enabled: true },
    ]
    const { client, startCalls } = makeClient({
      project: 'fresh-project-1',
      agents,
      harnesses,
      routeLane: true,
    })

    await withDom(async ({ container, root }) => {
      await mountDispatch(root, client, agents)
      const card = container.querySelector('[aria-label="First task"]')
      expect(card).not.toBeNull()
      expect(card.textContent).toContain('First task')
      expect(selectedValue(container.querySelector('#project-run-lane'))).toBe('acp')
      expect(selectedValue(container.querySelector('#project-run-mode'))).toBe('plan')
      expect(container.querySelector('#project-run-task').value).toBe(FIRST_TASK)
      expect(startCalls).toEqual([])
    })
  })

  it('is absent when the project has runs or no ready Plan-capable lane, and never substitutes Bypass or Auto', async () => {
    const planAgents = [
      { id: 'agent-claude', key: 'claude', name: 'Claude Code', adapterType: 'claude_local', harness: 'claude', mode: 'bypass', role: null },
    ]
    const readyClaude = [{ key: 'claude', name: 'Claude Code', ready: true, enabled: true }]

    const fresh = makeClient({ project: 'fresh-check', agents: planAgents, harnesses: readyClaude })
    await withDom(async ({ container, root }) => {
      await mountDispatch(root, fresh.client, planAgents)
      expect(container.querySelector('[aria-label="First task"]')).not.toBeNull()
    })

    const withRecent = makeClient({
      project: 'has-recent-runs',
      agents: planAgents,
      harnesses: readyClaude,
      recent: [{ lane: 'claude', task: 'Prior run', exitCode: 0, startedAt: '2026-11-16T10:00:00.000Z' }],
    })
    await withDom(async ({ container, root }) => {
      await mountDispatch(root, withRecent.client, planAgents)
      expect(container.querySelector('[aria-label="First task"]')).toBeNull()
      expect(container.querySelector('#project-run-task').value).toBe('')
    })

    const withRunning = makeClient({
      project: 'has-running-run',
      agents: planAgents,
      harnesses: readyClaude,
      running: [{ lane: 'claude', task: 'Active run', startedAt: '2026-11-16T10:00:00.000Z', lastLines: [] }],
    })
    await withDom(async ({ container, root }) => {
      await mountDispatch(root, withRunning.client, planAgents)
      expect(container.querySelector('[aria-label="First task"]')).toBeNull()
      expect(container.querySelector('#project-run-task').value).toBe('')
    })

    const noPlanAgents = [
      { id: 'agent-hermes', key: 'hermes', name: 'Hermes', adapterType: 'hermes_local', harness: 'hermes', role: null },
    ]
    const noPlanHarnesses = [
      { key: 'hermes', name: 'Hermes', ready: true, enabled: true },
    ]
    const withoutPlan = makeClient({ project: 'no-plan-harness', agents: noPlanAgents, harnesses: noPlanHarnesses })
    await withDom(async ({ container, root }) => {
      await mountDispatch(root, withoutPlan.client, noPlanAgents)
      expect(container.querySelector('[aria-label="First task"]')).toBeNull()
      expect(container.querySelector('#project-run-task').value).toBe('')
      expect(selectedValue(container.querySelector('#project-run-lane'))).toBe('')
    })

    const notReadyPlan = makeClient({
      project: 'plan-not-ready',
      agents: planAgents,
      harnesses: [{ key: 'claude', name: 'Claude Code', ready: false, enabled: true }],
    })
    await withDom(async ({ container, root }) => {
      await mountDispatch(root, notReadyPlan.client, planAgents)
      expect(container.querySelector('[aria-label="First task"]')).toBeNull()
      expect(container.querySelector('#project-run-task').value).toBe('')
    })
  })

  it('lets the owner edit or dismiss it and sets Plan only for that first run', async () => {
    const agents = [
      { id: 'agent-claude', key: 'claude', name: 'Claude Code', adapterType: 'claude_local', harness: 'claude', mode: 'bypass', role: null },
    ]
    const harnesses = [{ key: 'claude', name: 'Claude Code', ready: true, enabled: true }]

    const dismissSetup = makeClient({ project: 'dismiss-proj', agents, harnesses, routeLane: true })
    await withDom(async ({ container, root }) => {
      await mountDispatch(root, dismissSetup.client, agents)
      const card = container.querySelector('[aria-label="First task"]')
      expect(card).not.toBeNull()
      expect(container.querySelector('#project-run-task').value).toBe(FIRST_TASK)

      await click(root, buttonWithText(card, 'Dismiss'))
      await settle(10)
      expect(container.querySelector('[aria-label="First task"]')).toBeNull()
      expect(container.querySelector('#project-run-task').value).toBe('')
      expect(selectedValue(container.querySelector('#project-run-lane'))).toBe('auto')
      expect(dismissSetup.startCalls).toEqual([])
    })

    const runSetup = makeClient({ project: 'edit-and-run-proj', agents, harnesses })
    await withDom(async ({ container, root }) => {
      await mountDispatch(root, runSetup.client, agents)
      expect(container.querySelector('[aria-label="First task"]')).not.toBeNull()
      expect(selectedValue(container.querySelector('#project-run-mode'))).toBe('plan')

      await type(root, container.querySelector('#project-run-task'), 'Read package.json only.')
      await click(root, buttonWithText(container, 'Run'))
      await settle(10)
      await click(root, buttonWithText(container, 'Confirm'))
      await settle(20)

      expect(runSetup.startCalls).toHaveLength(1)
      expect(runSetup.startCalls[0]).toEqual({
        lane: 'claude',
        body: { tasks: ['Read package.json only.'], worktree: true, mode: 'plan' },
      })
      expect(container.querySelector('[aria-label="First task"]')).toBeNull()
      expect(selectedValue(container.querySelector('#project-run-mode'))).toBe('bypass')

      await type(root, container.querySelector('#project-run-task'), 'Second task.')
      await click(root, buttonWithText(container, 'Run'))
      await settle(10)
      await click(root, buttonWithText(container, 'Confirm'))
      await settle(20)

      expect(runSetup.startCalls).toHaveLength(2)
      expect(runSetup.startCalls[1]).toEqual({
        lane: 'claude',
        body: { tasks: ['Second task.'], worktree: true, mode: 'bypass' },
      })
    })
  })
})

describe('local records notice on Connect and in README', () => {
  it('shows the exact local records and model provider sentence in Connect and README.md', () => {
    const html = renderToString(createElement(Connect, { firstBoot: false }))
    expect(html).toContain(RECORDS_SENTENCE)

    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
    expect(readme).toContain(RECORDS_SENTENCE)
  })
})
