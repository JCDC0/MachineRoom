import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBridge } from '../server/index.js'
import { projectSettingsFileFor, readProjectSettings } from '../server/project-settings.js'
import { createClient } from '../src/control/client.js'
import { createMockClient } from '../src/control/mock.js'
import DispatchPanel from '../src/ui/panels/DispatchPanel.jsx'
import { clearProjectDraft, clearSplitRun } from '../src/ui/panels/runs.js'
import { buttonWithText, click, settle, type, withDom } from './helpers/uiDom.js'
import { makeTempDir } from './helpers/tempRoot.js'

const cleanups = []
const trackedProjects = []

afterEach(async () => {
  vi.useRealTimers()
  clearSplitRun()
  while (trackedProjects.length > 0) {
    clearProjectDraft(trackedProjects.pop())
  }
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function tempDir(prefix) {
  const dir = makeTempDir(prefix)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

async function startSettingsBridge() {
  const project = tempDir('mr-plan-default-project-')
  const runs = tempDir('mr-plan-default-runs-')
  writeFileSync(join(project, 'package.json'), JSON.stringify({ scripts: { test: 'node test.mjs' } }))
  const bridge = createBridge({ projectRoot: project, port: 0, runsFolder: runs, env: {} })
  cleanups.push(() => bridge.stop())
  const { url } = await bridge.start()
  const client = createClient({
    baseUrl: url,
    fetchImpl: (input, init = {}) =>
      fetch(input, {
        ...init,
        headers: {
          ...init?.headers,
          Origin: 'http://localhost:5173',
        },
      }),
  })
  return { client, project, runs }
}

function makeDispatchClient({
  project = 'plan-default-demo',
  agents = [],
  planByDefault = false,
  checkCommand = '',
} = {}) {
  trackedProjects.push(project)
  const startCalls = []
  const savedCalls = []
  let settings = { checkCommand, planByDefault, hasTestScript: true }
  const client = {
    health: async () => ({ lanes: true }),
    agents: async () => agents,
    runs: async () => ({
      running: [],
      recent: [{ lane: agents[0]?.key ?? 'claude', task: 'Prior run', exitCode: 0, startedAt: '2026-11-16T10:00:00.000Z' }],
      project,
    }),
    projectSettings: async () => ({ ...settings }),
    saveProjectSettings: async (patch = {}) => {
      savedCalls.push(patch)
      settings = {
        ...settings,
        ...(Object.hasOwn(patch, 'checkCommand') && patch.checkCommand !== undefined
          ? { checkCommand: String(patch.checkCommand).trim() }
          : {}),
        ...(Object.hasOwn(patch, 'planByDefault') && patch.planByDefault !== undefined
          ? { planByDefault: Boolean(patch.planByDefault) }
          : {}),
      }
      return { ...settings }
    },
    startRun: async (lane, body) => {
      startCalls.push({ lane, body })
      return { lane, queue: true, tasks: 1 }
    },
  }
  return { client, startCalls, savedCalls, readSettings: () => ({ ...settings }) }
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

function checkboxWithLabel(container, text) {
  const label = container
    .querySelectorAll('label')
    .find((item) => item.textContent.includes(text))
  return label ? label.querySelector('input[type="checkbox"]') ?? label.querySelector('input') : null
}

function planCheckbox(container) {
  return checkboxWithLabel(container, 'Start new runs in Plan')
}

async function toggleCheckbox(root, box, checked, useFake = false) {
  await act(async () => {
    box.checked = checked
    box.click()
  })
  if (useFake) await settleTimers()
  else await settle(20)
}

async function settleTimers() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

async function mountDispatchTimers(root, client, agents) {
  await act(async () => {
    root.render(createElement(DispatchPanel, { client, initialAgents: agents }))
  })
  await settleTimers()
}

describe('planByDefault setting and Dispatch behavior', () => {
  it('saves and reads back planByDefault across the bridge, mock and Dispatch checkbox', async () => {
    const { client, project, runs } = await startSettingsBridge()
    const file = projectSettingsFileFor(project, runs)

    expect(await client.projectSettings()).toEqual({
      checkCommand: '',
      planByDefault: false,
      hasTestScript: true,
    })

    expect(await client.saveProjectSettings({ checkCommand: 'npm run check' })).toEqual({
      checkCommand: 'npm run check',
      planByDefault: false,
      hasTestScript: true,
    })
    expect(await client.saveProjectSettings({ planByDefault: true })).toEqual({
      checkCommand: 'npm run check',
      planByDefault: true,
      hasTestScript: true,
    })
    expect(await client.projectSettings()).toEqual({
      checkCommand: 'npm run check',
      planByDefault: true,
      hasTestScript: true,
    })
    expect(readProjectSettings(file)).toEqual({
      checkCommand: 'npm run check',
      planByDefault: true,
    })
    expect(await client.saveProjectSettings({ planByDefault: false })).toEqual({
      checkCommand: 'npm run check',
      planByDefault: false,
      hasTestScript: true,
    })

    const mock = createMockClient({ latencyMs: 0 })
    expect(await mock.projectSettings()).toEqual({
      checkCommand: '',
      planByDefault: false,
      hasTestScript: true,
    })
    expect(await mock.saveProjectSettings({ planByDefault: true })).toEqual({
      checkCommand: '',
      planByDefault: true,
      hasTestScript: true,
    })
    expect(await mock.saveProjectSettings({ checkCommand: 'npm test' })).toEqual({
      checkCommand: 'npm test',
      planByDefault: true,
      hasTestScript: true,
    })
    expect(await mock.projectSettings()).toEqual({
      checkCommand: 'npm test',
      planByDefault: true,
      hasTestScript: true,
    })

    const agents = [
      { id: 'agent-claude', key: 'claude', name: 'Claude Code', adapterType: 'claude_local', harness: 'claude', mode: 'bypass', role: null },
    ]
    const ui = makeDispatchClient({ project: 'checkbox-save-project', agents, planByDefault: false })

    await withDom(async ({ container, root }) => {
      await mountDispatch(root, ui.client, agents)
      const checkField = container.querySelector('#project-run-check')
      const box = planCheckbox(container)
      expect(checkField).not.toBeNull()
      expect(box).not.toBeNull()
      expect(box.checked).toBe(false)

      await toggleCheckbox(root, box, true)
      expect(box.checked).toBe(true)
      expect(ui.savedCalls).toEqual([{ planByDefault: true }])
      expect(ui.readSettings().planByDefault).toBe(true)
    })

    await withDom(async ({ container, root }) => {
      await mountDispatch(root, ui.client, agents)
      const box = planCheckbox(container)
      expect(box).not.toBeNull()
      expect(box.checked).toBe(true)

      await toggleCheckbox(root, box, false)
      expect(box.checked).toBe(false)
      expect(ui.savedCalls).toEqual([{ planByDefault: true }, { planByDefault: false }])
      expect(ui.readSettings().planByDefault).toBe(false)
    })

    const failing = makeDispatchClient({ project: 'checkbox-fail-project', agents, planByDefault: false })
    failing.client.saveProjectSettings = async () => {
      throw new Error('Could not write project settings.')
    }
    await withDom(async ({ container, root }) => {
      await mountDispatch(root, failing.client, agents)
      const box = planCheckbox(container)
      await toggleCheckbox(root, box, true)
      expect(box.checked).toBe(false)
      expect(container.textContent).toContain('Could not write project settings.')
    })
  })

  it('with planByDefault on, starts Plan-capable lanes in Plan and still lets the owner pick another mode', async () => {
    const agents = [
      { id: 'agent-claude', key: 'claude', name: 'Claude Code', adapterType: 'claude_local', harness: 'claude', mode: 'bypass', role: null },
      { id: 'agent-opencode', key: 'opencode', name: 'OpenCode', adapterType: 'opencode_local', harness: 'opencode', mode: 'auto', role: null },
      { id: 'agent-codex', key: 'codex', name: 'Codex', adapterType: 'codex_local', harness: 'codex', mode: 'choice', role: null },
    ]
    const { client, startCalls } = makeDispatchClient({ project: 'plan-on-proj', agents, planByDefault: true })

    await withDom(async ({ container, root }) => {
      await mountDispatch(root, client, agents)

      const laneSelect = container.querySelector('#project-run-lane')
      await type(root, laneSelect, 'claude')
      await settle(10)
      expect(selectedValue(container.querySelector('#project-run-mode'))).toBe('plan')

      await type(root, laneSelect, 'opencode')
      await settle(10)
      expect(selectedValue(container.querySelector('#project-run-mode'))).toBe('plan')

      await type(root, laneSelect, 'codex')
      await settle(10)
      expect(selectedValue(container.querySelector('#project-run-mode'))).toBe('plan')

      await type(root, laneSelect, 'claude')
      await settle(10)
      expect(selectedValue(container.querySelector('#project-run-mode'))).toBe('plan')

      await type(root, container.querySelector('#project-run-task'), 'Inspect the server routes.')
      await click(root, buttonWithText(container, 'Run'))
      await settle(10)
      const card = container.querySelector('[aria-label="Confirm project run"]')
      expect(card).not.toBeNull()
      expect(card.textContent).not.toContain('This lane has no Plan mode.')

      await click(root, buttonWithText(container, 'Confirm'))
      await settle(20)

      expect(startCalls[0]).toEqual({
        lane: 'claude',
        body: { tasks: ['Inspect the server routes.'], worktree: true, mode: 'plan' },
      })

      await type(root, container.querySelector('#project-run-mode'), 'edits')
      await settle(10)
      expect(selectedValue(container.querySelector('#project-run-mode'))).toBe('edits')

      await type(root, container.querySelector('#project-run-task'), 'Edit the route.')
      await click(root, buttonWithText(container, 'Run'))
      await settle(10)
      await click(root, buttonWithText(container, 'Confirm'))
      await settle(20)

      expect(startCalls[1]).toEqual({
        lane: 'claude',
        body: { tasks: ['Edit the route.'], worktree: true, mode: 'edits' },
      })
      expect(selectedValue(container.querySelector('#project-run-mode'))).toBe('plan')
    })

    let resolveSettings = null
    const slow = makeDispatchClient({ project: 'slow-settings-proj', agents, planByDefault: false })
    slow.client.projectSettings = () =>
      new Promise((resolve) => {
        resolveSettings = resolve
      })

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(DispatchPanel, { client: slow.client, initialAgents: agents }))
      })
      await settle(10)
      await type(root, container.querySelector('#project-run-lane'), 'claude')
      expect(selectedValue(container.querySelector('#project-run-mode'))).toBe('bypass')

      await act(async () => {
        resolveSettings({ checkCommand: '', planByDefault: true, hasTestScript: true })
      })
      await settle(10)
      expect(selectedValue(container.querySelector('#project-run-mode'))).toBe('plan')
    })
  })

  it('with planByDefault on, a lane without Plan shows the line on the confirm card and keeps its mode', async () => {
    const agents = [
      { id: 'agent-hermes', key: 'hermes', name: 'Hermes', adapterType: 'hermes_local', harness: 'hermes', role: null },
      { id: 'agent-hermes-saved', key: 'hermes-saved', name: 'Hermes Saved', adapterType: 'hermes_local', harness: 'hermes', mode: 'edits', role: null },
    ]
    const { client, startCalls } = makeDispatchClient({ project: 'no-plan-proj', agents, planByDefault: true })

    await withDom(async ({ container, root }) => {
      await mountDispatch(root, client, agents)

      const laneSelect = container.querySelector('#project-run-lane')
      await type(root, laneSelect, 'hermes')
      await settle(10)
      expect(container.querySelector('#project-run-mode')).toBeNull()

      await type(root, container.querySelector('#project-run-task'), 'Summarize the readme.')
      await click(root, buttonWithText(container, 'Run'))
      await settle(10)
      const card = container.querySelector('[aria-label="Confirm project run"]')
      expect(card).not.toBeNull()
      expect(card.textContent).toContain('This lane has no Plan mode.')

      await click(root, buttonWithText(container, 'Confirm'))
      await settle(20)

      expect(startCalls[0]).toEqual({
        lane: 'hermes',
        body: { tasks: ['Summarize the readme.'], worktree: true },
      })

      await type(root, laneSelect, 'hermes-saved')
      await settle(10)
      await type(root, container.querySelector('#project-run-task'), 'Keep edits mode.')
      await click(root, buttonWithText(container, 'Run'))
      await settle(10)
      const secondCard = container.querySelector('[aria-label="Confirm project run"]')
      expect(secondCard).not.toBeNull()
      expect(secondCard.textContent).toContain('This lane has no Plan mode.')

      await click(root, buttonWithText(container, 'Confirm'))
      await settle(20)

      expect(startCalls[1]).toEqual({
        lane: 'hermes-saved',
        body: { tasks: ['Keep edits mode.'], worktree: true, mode: 'edits' },
      })
    })
  })

  it('with planByDefault off nothing changes and toggling updates the default mode', async () => {
    const agents = [
      { id: 'agent-claude', key: 'claude', name: 'Claude Code', adapterType: 'claude_local', harness: 'claude', mode: 'bypass', role: null },
      { id: 'agent-codex', key: 'codex', name: 'Codex', adapterType: 'codex_local', harness: 'codex', mode: 'choice', role: null },
      { id: 'agent-hermes', key: 'hermes', name: 'Hermes', adapterType: 'hermes_local', harness: 'hermes', role: null },
    ]
    const { client, startCalls } = makeDispatchClient({ project: 'plan-off-proj', agents, planByDefault: false })

    await withDom(async ({ container, root }) => {
      await mountDispatch(root, client, agents)

      const laneSelect = container.querySelector('#project-run-lane')
      await type(root, laneSelect, 'claude')
      await settle(10)
      expect(selectedValue(container.querySelector('#project-run-mode'))).toBe('bypass')

      await type(root, laneSelect, 'codex')
      await settle(10)
      expect(selectedValue(container.querySelector('#project-run-mode'))).toBe('auto')

      await type(root, laneSelect, 'hermes')
      await settle(10)
      await type(root, container.querySelector('#project-run-task'), 'Check the docs.')
      await click(root, buttonWithText(container, 'Run'))
      await settle(10)
      const card = container.querySelector('[aria-label="Confirm project run"]')
      expect(card).not.toBeNull()
      expect(card.textContent).not.toContain('This lane has no Plan mode.')

      await click(root, buttonWithText(container, 'Confirm'))
      await settle(20)
      expect(startCalls[0]).toEqual({
        lane: 'hermes',
        body: { tasks: ['Check the docs.'], worktree: true },
      })

      await type(root, laneSelect, 'claude')
      await settle(10)
      expect(selectedValue(container.querySelector('#project-run-mode'))).toBe('bypass')

      const box = planCheckbox(container)
      await toggleCheckbox(root, box, true)
      expect(selectedValue(container.querySelector('#project-run-mode'))).toBe('plan')

      await toggleCheckbox(root, box, false)
      expect(selectedValue(container.querySelector('#project-run-mode'))).toBe('bypass')
    })
  })

  it('with planByDefault on, two split tasks on Plan-capable lanes each send mode: plan', async () => {
    vi.useFakeTimers()
    const agents = [
      { id: 'agent-claude', key: 'claude', name: 'Claude Code', adapterType: 'claude_local', harness: 'claude', mode: 'bypass', role: null },
      { id: 'agent-opencode', key: 'opencode', name: 'OpenCode', adapterType: 'opencode_local', harness: 'opencode', mode: 'auto', role: null },
    ]
    const { client, startCalls } = makeDispatchClient({ project: 'split-plan-on', agents, planByDefault: true })

    await withDom(async ({ container, root }) => {
      await mountDispatchTimers(root, client, agents)
      await type(root, container.querySelector('#project-run-task'), 'Inspect routes.\n---\nCheck tests.')
      await toggleCheckbox(root, checkboxWithLabel(container, 'One lane per task'), true, true)
      await click(root, buttonWithText(container, 'Run 2 tasks on 2 lanes'))
      await settleTimers()

      const card = container.querySelector('[aria-label="Confirm project runs"]')
      expect(card).not.toBeNull()
      expect(card.textContent).not.toContain('This lane has no Plan mode.')

      await click(root, buttonWithText(card, 'Confirm'))
      await settleTimers()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      await settleTimers()

      expect(startCalls).toEqual([
        { lane: 'claude', body: { tasks: ['Inspect routes.'], worktree: true, mode: 'plan' } },
        { lane: 'opencode', body: { tasks: ['Check tests.'], worktree: true, mode: 'plan' } },
      ])
    })
  })

  it('with planByDefault on, split tasks on lanes without Plan send no mode and show the line once per such lane', async () => {
    vi.useFakeTimers()
    const agents = [
      { id: 'agent-claude', key: 'claude', name: 'Claude Code', adapterType: 'claude_local', harness: 'claude', mode: 'bypass', role: null },
      { id: 'agent-hermes', key: 'hermes', name: 'Hermes', adapterType: 'hermes_local', harness: 'hermes', role: null },
      { id: 'agent-copilot', key: 'copilot', name: 'Copilot', adapterType: 'copilot_local', harness: 'copilot', role: null },
    ]
    const { client, startCalls } = makeDispatchClient({ project: 'split-no-plan', agents, planByDefault: true })

    await withDom(async ({ container, root }) => {
      await mountDispatchTimers(root, client, agents)
      await type(root, container.querySelector('#project-run-task'), 'Task A.\n---\nTask B.\n---\nTask C.')
      await toggleCheckbox(root, checkboxWithLabel(container, 'One lane per task'), true, true)
      await click(root, buttonWithText(container, 'Run 3 tasks on 3 lanes'))
      await settleTimers()

      const card = container.querySelector('[aria-label="Confirm project runs"]')
      expect(card).not.toBeNull()
      expect(card.textContent.match(/This lane has no Plan mode\./g)).toHaveLength(2)

      const entries = card.querySelectorAll('.runs-entry')
      expect(entries).toHaveLength(3)
      expect(entries[0].textContent).not.toContain('This lane has no Plan mode.')
      expect(entries[1].textContent).toContain('This lane has no Plan mode.')
      expect(entries[2].textContent).toContain('This lane has no Plan mode.')

      await click(root, buttonWithText(card, 'Confirm'))
      await settleTimers()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      await settleTimers()

      expect(startCalls).toEqual([
        { lane: 'claude', body: { tasks: ['Task A.'], worktree: true, mode: 'plan' } },
        { lane: 'hermes', body: { tasks: ['Task B.'], worktree: true } },
        { lane: 'copilot', body: { tasks: ['Task C.'], worktree: true } },
      ])
      expect(Object.hasOwn(startCalls[1].body, 'mode')).toBe(false)
      expect(Object.hasOwn(startCalls[2].body, 'mode')).toBe(false)
    })
  })

  it('with planByDefault off, split tasks send no mode and toggling updates split starts', async () => {
    vi.useFakeTimers()
    const agents = [
      { id: 'agent-claude', key: 'claude', name: 'Claude Code', adapterType: 'claude_local', harness: 'claude', mode: 'bypass', role: null },
      { id: 'agent-opencode', key: 'opencode', name: 'OpenCode', adapterType: 'opencode_local', harness: 'opencode', mode: 'auto', role: null },
      { id: 'agent-hermes', key: 'hermes', name: 'Hermes', adapterType: 'hermes_local', harness: 'hermes', role: null },
    ]
    const { client, startCalls } = makeDispatchClient({ project: 'split-plan-off', agents, planByDefault: false })

    await withDom(async ({ container, root }) => {
      await mountDispatchTimers(root, client, agents)
      await type(root, container.querySelector('#project-run-task'), 'One.\n---\nTwo.\n---\nThree.')
      await toggleCheckbox(root, checkboxWithLabel(container, 'One lane per task'), true, true)
      await click(root, buttonWithText(container, 'Run 3 tasks on 3 lanes'))
      await settleTimers()

      const firstCard = container.querySelector('[aria-label="Confirm project runs"]')
      expect(firstCard).not.toBeNull()
      expect(firstCard.textContent).not.toContain('This lane has no Plan mode.')

      await click(root, buttonWithText(firstCard, 'Confirm'))
      await settleTimers()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      await settleTimers()

      expect(startCalls).toEqual([
        { lane: 'claude', body: { tasks: ['One.'], worktree: true } },
        { lane: 'opencode', body: { tasks: ['Two.'], worktree: true } },
        { lane: 'hermes', body: { tasks: ['Three.'], worktree: true } },
      ])
      for (const call of startCalls) {
        expect(Object.hasOwn(call.body, 'mode')).toBe(false)
      }

      const box = planCheckbox(container)
      await toggleCheckbox(root, box, true, true)
      await type(root, container.querySelector('#project-run-task'), 'Four.\n---\nFive.')
      await click(root, buttonWithText(container, 'Run 2 tasks on 2 lanes'))
      await settleTimers()
      await click(root, buttonWithText(container.querySelector('[aria-label="Confirm project runs"]'), 'Confirm'))
      await settleTimers()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      await settleTimers()

      expect(startCalls.slice(3)).toEqual([
        { lane: 'claude', body: { tasks: ['Four.'], worktree: true, mode: 'plan' } },
        { lane: 'opencode', body: { tasks: ['Five.'], worktree: true, mode: 'plan' } },
      ])

      await toggleCheckbox(root, box, false, true)
      await type(root, container.querySelector('#project-run-task'), 'Six.\n---\nSeven.')
      await click(root, buttonWithText(container, 'Run 2 tasks on 2 lanes'))
      await settleTimers()
      await click(root, buttonWithText(container.querySelector('[aria-label="Confirm project runs"]'), 'Confirm'))
      await settleTimers()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      await settleTimers()

      expect(startCalls.slice(5)).toEqual([
        { lane: 'claude', body: { tasks: ['Six.'], worktree: true } },
        { lane: 'opencode', body: { tasks: ['Seven.'], worktree: true } },
      ])
    })
  })
})
