import { EventEmitter } from 'node:events'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { act, createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { createBridge } from '../server/index.js'
import { chatFileFor } from '../server/orchestrator.js'
import OrchestratorChat from '../src/ui/OrchestratorChat.jsx'
import { roomNoticeSummary } from '../src/ui/roomNotice.js'
import { getJson } from './helpers/bridge.js'
import { makeTempDir } from './helpers/tempRoot.js'
import { buttonWithText, click, withDom } from './helpers/uiDom.js'

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function tempDir(prefix = 'mr-room-notice-') {
  const dir = makeTempDir(prefix)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

async function waitFor(fn, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await fn()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
  throw new Error('condition not met in time')
}

function fakeClaudeSpawn() {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = () => {}
  setTimeout(() => {
    child.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake' }) + '\n')
    child.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', result: 'Noted.', usage: { input_tokens: 1, output_tokens: 1 } }) + '\n')
    child.emit('close', 0)
  }, 10)
  return child
}

async function startNoticeBridge(setup = null) {
  const base = tempDir()
  const projectRoot = join(base, 'project')
  const runs = join(base, 'runs')
  mkdirSync(projectRoot, { recursive: true })
  mkdirSync(runs, { recursive: true })
  const lanes = {
    orchestrator: { name: 'Orchestrator', harness: 'Claude Code', cli: { harness: 'claude', bin: 'claude', model: 'opus' } },
    opencode: { name: 'OpenCode', harness: 'OpenCode', cli: { harness: 'opencode', bin: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' } },
  }
  const lanesFile = join(base, 'lanes.json')
  writeFileSync(lanesFile, JSON.stringify(lanes))
  writeActiveLanes(activeLanesFileFor(projectRoot, runs), ['opencode'])
  const promptFile = join(base, 'prompt.md')
  writeFileSync(promptFile, 'project={{PROJECT}}')
  if (setup) setup({ projectRoot, runs, lanesFile, promptFile })

  const bridge = createBridge({
    projectRoot,
    port: 0,
    env: {},
    runsFolder: runs,
    lanesFile,
    lanesSource: { folder: runs, lanes, repoRoot: projectRoot, pollMs: 20, quietMs: 60000 },
    orchestratorHarnessAvailable: () => true,
    orchestratorPrompt: promptFile,
    orchestratorSpawn: fakeClaudeSpawn,
  })
  cleanups.push(() => bridge.stop())
  const { url } = await bridge.start()
  return { url, projectRoot, runs }
}

const success = 'Run codex2-P536-20261118-012152 on lane codex2 ended: succeeded.\nlane codex2 | briefs P536, P537 | exit 0 | branch feat/test | commits a2d359be 0.1.402: Fix the rail; b1234567 0.1.403: Next | cost not reported'
const failed = 'Run test on lane codex2 ended: failed.\nlane codex2 | briefs P536 | exit 1 | branch feat/test | commits none | cost not reported\nError: failed'

describe('run-end room notices', () => {
  it('summarizes the first commit', () => {
    expect(roomNoticeSummary(success)).toEqual({ lane: 'codex2', briefs: 'P536, P537', status: 'succeeded', subject: 'Fix the rail' })
  })
  it('reads the first commit from firstCommit when the notice carries it', () => {
    expect(roomNoticeSummary(success, 'a2d359be 0.1.402: Fix the picker; keep drafts').subject).toBe('Fix the picker; keep drafts')
  })
  it('summarizes a failure without commits', () => {
    expect(roomNoticeSummary(failed)).toEqual({ lane: 'codex2', briefs: 'P536', status: 'failed', subject: null })
  })
  it('summarizes a stopped run without a record', () => {
    expect(roomNoticeSummary('Run test on lane codex2 ended: stopped.')).toEqual({ lane: 'codex2', briefs: null, status: 'stopped', subject: null })
  })
  it('leaves other text alone', () => {
    expect(roomNoticeSummary('The room is ready.')).toBeNull()
  })
  it('folds the full message behind Details', async () => {
    const client = {
      orchestrator: async () => ({ state: 'idle', messages: [{ id: 'r1', from: 'room', text: success }, { id: 'r2', from: 'room', text: 'The room is ready.' }] }),
      orchestrators: async () => [],
      subscribe: () => () => {},
    }
    await withDom(async ({ container, root }) => {
      await act(async () => { root.render(createElement(OrchestratorChat, { client, open: true })) })
      await act(async () => {})
      const row = container.querySelector('.mr-orch-line.is-run-notice')
      const summary = row.querySelector('.mr-orch-run-summary')
      expect(summary.textContent).toContain('codex2')
      expect(summary.textContent).toContain('P536, P537')
      expect(summary.textContent).toContain('succeeded')
      expect(summary.querySelector('.mr-orch-run-subject').textContent).toBe('Fix the rail')
      expect(row.textContent).not.toContain('exit 0')
      expect(container.textContent).toContain('The room is ready.')
      const button = buttonWithText(summary, 'Details')
      expect(button.getAttribute('aria-expanded')).toBe('false')
      await click(root, button)
      expect(button.getAttribute('aria-expanded')).toBe('true')
      expect(row.textContent).toContain('exit 0')
      expect(row.textContent).toContain('cost not reported')
      await click(root, button)
      expect(row.textContent).not.toContain('exit 0')
    })
  })

  it('publishes firstCommit from a mocked server run and keeps semicolons in the chat notice', async () => {
    const { url, projectRoot, runs } = await startNoticeBridge()
    const runName = 'opencode-P592-20261118-012152'
    const log = join(runs, `${runName}.log`)
    const commit = 'a2d359be 0.1.402: Fix the picker; keep drafts'
    writeFileSync(join(runs, `${runName}.meta.json`), JSON.stringify({ project: projectRoot, startedBy: 'orchestrator' }) + '\n')
    writeFileSync(log, 'done\n')
    writeFileSync(
      join(runs, 'runs.jsonl'),
      JSON.stringify({
        lane: 'opencode',
        briefs: ['P592'],
        model: 'opencode-go/deepseek-v4.1-flash',
        startedAt: '2026-11-18T01:21:52.000Z',
        minutes: 1,
        exitCode: 0,
        killed: false,
        startedBy: 'orchestrator',
        log,
        branch: 'feat/test',
        commits: [commit, 'b1234567 0.1.403: Next'],
      }) + '\n'
    )

    const chat = await waitFor(async () => {
      const response = await getJson(`${url}/api/orchestrator`)
      const notice = response.body?.messages?.find((entry) => entry.from === 'room' && entry.text.includes(runName))
      return notice && response.body.state === 'idle' ? { body: response.body, notice } : null
    })

    expect(chat.notice.firstCommit).toBe(commit)
    expect(roomNoticeSummary(chat.notice.text, chat.notice.firstCommit)).toEqual({
      lane: 'opencode',
      briefs: 'P592',
      status: 'succeeded',
      subject: 'Fix the picker; keep drafts',
    })

    const client = {
      orchestrator: async () => chat.body,
      orchestrators: async () => [],
      subscribe: () => () => {},
    }
    await withDom(async ({ container, root }) => {
      await act(async () => { root.render(createElement(OrchestratorChat, { client, open: true, initialChat: chat.body })) })
      await act(async () => {})
      const subject = container.querySelector('.mr-orch-run-subject')
      expect(subject.textContent).toBe('Fix the picker; keep drafts')
      expect(subject.getAttribute('title')).toBe('Fix the picker; keep drafts')
    })
  })

  it('keeps and masks firstCommit when reloading a saved room notice', async () => {
    const secret = 'sk-or-v1-' + 'q'.repeat(24)
    const setting = 'OPENROUTER_API_KEY='
    const profile = process.platform === 'win32' ? (process.env.USERPROFILE || homedir()) : (process.env.HOME || homedir())
    const profilePath = join(profile, 'project', 'trace.log')
    const expectedHome = process.platform === 'win32' ? '%USERPROFILE%' : '~'
    const text =
      'Run opencode-P592-20261118-012152 on lane opencode ended: succeeded.\n' +
      'lane opencode | briefs P592 | exit 0 | branch feat/test | commits a2d359be 0.1.402: Fix trace; keep key | cost not reported'
    let savedFile = ''

    const { url } = await startNoticeBridge(({ projectRoot, runs }) => {
      savedFile = chatFileFor(projectRoot, runs)
      writeFileSync(
        savedFile,
        JSON.stringify({
          project: projectRoot,
          sessionId: null,
          state: 'idle',
          messages: [
            {
              id: 'r1',
              from: 'room',
              text,
              at: '2026-11-18T01:22:00.000Z',
              firstCommit: `a2d359be 0.1.402: Fix ${profilePath}; keep ${setting}${secret}`,
            },
          ],
          pending: [],
        }) + '\n'
      )
    })

    const chat = await getJson(`${url}/api/orchestrator`)
    expect(chat.status).toBe(200)
    const notice = chat.body.messages.find((entry) => entry.id === 'r1')
    expect(notice.firstCommit).toBeDefined()
    expect(notice.firstCommit).toContain('; keep ')
    expect(notice.firstCommit).toContain('[key]')
    expect(notice.firstCommit).toContain(expectedHome)
    expect(notice.firstCommit).not.toContain(secret)
    expect(notice.firstCommit).not.toContain(profile)

    const persisted = readFileSync(savedFile, 'utf8')
    expect(persisted).not.toContain(secret)
    expect(persisted).not.toContain(profile)

    const summary = roomNoticeSummary(notice.text, notice.firstCommit)
    expect(summary.subject).toContain('; keep ')
    expect(summary.subject).toContain('[key]')
    expect(summary.subject).toContain(expectedHome)
  })
})
