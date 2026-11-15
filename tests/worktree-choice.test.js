import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { createBridge } from '../server/index.js'
import { gitPath } from '../server/programPath.js'
import { createClient } from '../src/control/client.js'
import OrchestratorChat from '../src/ui/OrchestratorChat.jsx'
import DispatchPanel from '../src/ui/panels/DispatchPanel.jsx'
import { clearSplitRun, startSplitRun } from '../src/ui/panels/runs.js'
import { getJson, waitFor } from './helpers/bridge.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'
import { buttonWithText, settle, type, withDom } from './helpers/uiDom.js'

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const LANES_FILE = join(REPO_ROOT, 'docs', 'agents', 'lanes.json')
const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function tempDir(prefix) {
  const dir = makeTempDir(prefix)
  cleanups.push(() => removeTempDir(dir))
  return dir
}

function gitProject() {
  const dir = tempDir('mr-worktree-choice-')
  execFileSync(gitPath(), ['init'], { cwd: dir, stdio: 'ignore' })
  return dir
}

function writeRunner(dir, callsFile) {
  const path = join(dir, 'runner.mjs')
  writeFileSync(
    path,
    [
      "import { appendFileSync } from 'node:fs'",
      'const args = process.argv.slice(2)',
      `appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify(args) + '\\n')`,
    ].join('\n')
  )
  return path
}

function readCalls(callsFile) {
  if (!existsSync(callsFile)) return []
  return readFileSync(callsFile, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))
}

async function startBridge(project) {
  const base = tempDir('mr-worktree-choice-bridge-')
  const runs = join(base, 'runs')
  mkdirSync(runs, { recursive: true })
  const callsFile = join(base, 'calls.jsonl')
  const runnerPath = writeRunner(base, callsFile)
  const promptFile = join(base, 'orchestrator-agent.md')
  writeFileSync(promptFile, 'project={{PROJECT}}\nruns={{RUNS}}\n')
  const lanes = JSON.parse(readFileSync(LANES_FILE, 'utf8'))
  writeActiveLanes(activeLanesFileFor(project, runs), ['opencode'])
  const bridge = createBridge({
    projectRoot: project,
    port: 0,
    env: {},
    briefsDir: join(REPO_ROOT, 'docs', 'agents'),
    lanesFile: LANES_FILE,
    runsFolder: runs,
    runnerCommand: { file: process.execPath, args: [runnerPath] },
    orchestratorPrompt: promptFile,
    lanesSource: { folder: runs, lanes, pollMs: 20, quietMs: 60000 },
    orchestratorSpawn: () => {
      throw new Error('orchestrator should not spawn during direct lane dispatch')
    },
  })
  cleanups.push(() => bridge.stop())
  const { url } = await bridge.start()
  return { url, callsFile }
}

function postMessage(url, body) {
  return getJson(`${url}/api/orchestrator/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: url },
    body: JSON.stringify(body),
  })
}

describe('a direct lane message carries the worktree choice', () => {
  it('starts the task without a worktree when the box is off', async () => {
    const project = gitProject()
    const { url, callsFile } = await startBridge(project)

    const res = await postMessage(url, { to: 'opencode', text: 'Fix the typo.', worktree: false })
    expect(res.status).toBe(202)
    expect(res.body).toEqual({ ok: true, started: true })

    const calls = await waitFor(() => (readCalls(callsFile).length === 1 ? readCalls(callsFile) : null), {
      what: 'chat dispatch runner call',
    })
    expect(calls[0]).toEqual([
      'opencode',
      '--project',
      project,
      '--task',
      'Fix the typo.',
      '--started-by',
      'orchestrator',
      '--started-at',
      expect.any(String),
    ])
    expect(calls[0]).not.toContain('--worktree')
    await waitFor(async () => !(await bridgeRunning(url)), { what: 'chat dispatch run to end' })
  })

  it('keeps today\'s worktree on a git project when no choice is given', async () => {
    const project = gitProject()
    const { url, callsFile } = await startBridge(project)

    const res = await postMessage(url, { to: 'opencode', text: 'Fix the typo.' })
    expect(res.status).toBe(202)

    const calls = await waitFor(() => (readCalls(callsFile).length === 1 ? readCalls(callsFile) : null), {
      what: 'chat dispatch runner call',
    })
    expect(calls[0]).toContain('--worktree')
    await waitFor(async () => !(await bridgeRunning(url)), { what: 'chat dispatch run to end' })
  })

  it('never uses a worktree outside a git checkout, even when asked', async () => {
    const project = tempDir('mr-worktree-choice-plain-')
    const { url, callsFile } = await startBridge(project)

    const res = await postMessage(url, { to: 'opencode', text: 'Fix the typo.', worktree: true })
    expect(res.status).toBe(202)

    const calls = await waitFor(() => (readCalls(callsFile).length === 1 ? readCalls(callsFile) : null), {
      what: 'chat dispatch runner call',
    })
    expect(calls[0]).toEqual([
      'opencode',
      '--project',
      project,
      '--task',
      'Fix the typo.',
      '--started-by',
      'orchestrator',
      '--started-at',
      expect.any(String),
    ])
    expect(calls[0]).not.toContain('--worktree')
    await waitFor(async () => !(await bridgeRunning(url)), { what: 'chat dispatch run to end' })
  })
})

async function bridgeRunning(url) {
  const answer = await getJson(`${url}/api/control/runs`)
  return Array.isArray(answer.body?.running) && answer.body.running.length > 0
}

describe('startSplitRun carries the worktree choice', () => {
  afterEach(() => {
    clearSplitRun()
  })

  function makeClient() {
    const calls = []
    const client = {
      startRun: async (lane, body) => {
        calls.push({ lane, body })
        return { lane, queue: true, tasks: 1 }
      },
    }
    return { client, calls }
  }

  it('sends worktree false when the box is off', async () => {
    const { client, calls } = makeClient()
    const started = await startSplitRun({
      client,
      pairs: [{ lane: 'alpha', task: 'One.' }],
      delay: 0,
      worktree: false,
    })
    expect(started).toBe(true)
    expect(calls).toEqual([{ lane: 'alpha', body: { tasks: ['One.'], worktree: false } }])
  })

  it('keeps today\'s worktree when no choice is given', async () => {
    const { client, calls } = makeClient()
    await startSplitRun({ client, pairs: [{ lane: 'alpha', task: 'One.' }], delay: 0 })
    expect(calls).toEqual([{ lane: 'alpha', body: { tasks: ['One.'], worktree: true } }])
  })
})

describe('the chat worktree box', () => {
  const LANES = [{ key: 'opencode', name: 'OpenCode', cli: { bin: 'opencode' } }]

  function chatClient() {
    const calls = []
    return {
      calls,
      orchestrator: async () => ({ state: 'idle', messages: [{ id: 'm1', from: 'owner', text: 'Hello.' }] }),
      orchestrators: async () => [],
      sendOrchestrator: async (text, options) => {
        calls.push({ text, options })
        return { id: 'm2' }
      },
      stopOrchestrator: async () => ({ ok: true }),
      subscribe: () => () => {},
    }
  }

  it('sends worktree false to a lane when the box is off', async () => {
    const client = chatClient()
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(OrchestratorChat, {
            client,
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
      const label = container
        .querySelectorAll('label')
        .find((item) => item.textContent.includes('Separate worktree'))
      expect(label).not.toBeUndefined()
      const checkbox = label.querySelector('input')
      await act(async () => {
        checkbox.checked = false
        checkbox.click()
      })
      await type(root, container.querySelector('.mr-orch-input'), 'Fix tests')
      await act(async () => {
        container.querySelector('.mr-orch-form').dispatchEvent({
          type: 'submit',
          bubbles: true,
          cancelable: true,
        })
      })
      expect(client.calls).toEqual([{ text: 'Fix tests', options: { id: 'opencode', worktree: false } }])
    })
  })

  it('sends worktree true to a lane when the box stays on', async () => {
    const client = chatClient()
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(OrchestratorChat, {
            client,
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
      await type(root, container.querySelector('.mr-orch-input'), 'Fix tests')
      await act(async () => {
        container.querySelector('.mr-orch-form').dispatchEvent({
          type: 'submit',
          bubbles: true,
          cancelable: true,
        })
      })
      expect(client.calls).toEqual([{ text: 'Fix tests', options: { id: 'opencode', worktree: true } }])
    })
  })
})

describe('the control client sends the worktree choice', () => {
  function recorder() {
    const calls = []
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url, method: options.method, body: options.body })
      return { ok: true, json: async () => ({ ok: true }) }
    }
    return { calls, client: createClient({ baseUrl: 'http://127.0.0.1:9', fetchImpl }) }
  }

  it('posts worktree false when the box is off', async () => {
    const { calls, client } = recorder()
    await client.sendOrchestrator('Fix tests', { id: 'opencode', worktree: false })
    expect(calls).toEqual([
      {
        url: 'http://127.0.0.1:9/api/orchestrator/messages',
        method: 'POST',
        body: JSON.stringify({ text: 'Fix tests', id: 'opencode', confirmed: true, worktree: false }),
      },
    ])
  })

  it('leaves worktree out of the body when no choice is given', async () => {
    const { calls, client } = recorder()
    await client.sendOrchestrator('Fix tests', { id: 'opencode' })
    const body = JSON.parse(calls[0].body)
    expect(body).toEqual({ text: 'Fix tests', id: 'opencode', confirmed: true })
    expect('worktree' in body).toBe(false)
  })
})

describe('the Dispatch worktree box', () => {
  const AGENTS = [
    { id: 'agent-alpha', key: 'alpha', name: 'Alpha', adapterType: 'opencode_local', role: null },
    { id: 'agent-beta', key: 'beta', name: 'Beta', adapterType: 'opencode_local', role: null },
  ]

  it('sends worktree false when a split run has the box off', async () => {
    const calls = []
    const client = {
      health: async () => ({ lanes: true }),
      agents: async () => AGENTS,
      runs: async () => ({ running: [], recent: [], project: 'C:\\work\\demo' }),
      startRun: async (lane, body) => {
        calls.push({ lane, body })
        return { lane, queue: true, tasks: 1 }
      },
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(DispatchPanel, { client, initialAgents: AGENTS }))
      })
      await settle()
      await type(root, container.querySelector('#project-run-task'), 'One\n---\nTwo')
      const oneLane = container
        .querySelectorAll('label')
        .find((label) => label.textContent.includes('One lane per task'))
      const splitBox = oneLane.querySelector('input')
      await act(async () => {
        splitBox.checked = true
        splitBox.click()
      })
      const worktreeLabel = container
        .querySelectorAll('label')
        .find((label) => label.textContent.includes('Separate worktree'))
      expect(worktreeLabel).not.toBeUndefined()
      const worktreeBox = worktreeLabel.querySelector('input')
      expect(worktreeBox.getAttribute('disabled')).toBeNull()
      await act(async () => {
        worktreeBox.checked = false
        worktreeBox.click()
      })
      const runButton = buttonWithText(container, 'Run 2 tasks on 2 lanes')
      expect(runButton).not.toBeNull()
      await act(async () => {
        runButton.click()
      })
      const confirm = buttonWithText(container, 'Confirm')
      await act(async () => {
        confirm.click()
        await Promise.resolve()
      })
      expect(calls).toEqual([{ lane: 'alpha', body: { tasks: ['One'], worktree: false } }])
      clearSplitRun()
    })
  })
})
