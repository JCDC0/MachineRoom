import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { projectSettingsFileFor, readProjectSettings } from '../server/project-settings.js'
import { createClient } from '../src/control/client.js'
import { createMockClient } from '../src/control/mock.js'
import DispatchPanel from '../src/ui/panels/DispatchPanel.jsx'
import { clearProjectDraft } from '../src/ui/panels/runs.js'
import { buttonWithText, click, settle, type, withDom } from './helpers/uiDom.js'
import { makeTempDir } from './helpers/tempRoot.js'

const cleanups = []
const trackedProjects = []

afterEach(async () => {
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

function planCheckbox(container) {
  const label = container
    .querySelectorAll('label')
    .find((item) => item.textContent.includes('Start new runs in Plan'))
  return label ? label.querySelector('input[type="checkbox"]') ?? label.querySelector('input') : null
}

async function toggleCheckbox(root, box, checked) {
  await act(async () => {
    box.checked = checked
    box.click()
  })
  await settle(20)
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
})
