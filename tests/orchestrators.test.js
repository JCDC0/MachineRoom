import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { createLanesSource } from '../server/lanes-source.js'
import { chatFileFor, CONFIRM_HARNESS_PROBLEM, NO_NEW_REPORT, NO_REPORT } from '../server/orchestrator.js'
import { availableHarnesses, branchChanges, createOrchestrators, NO_TOKEN_PROBLEM, OWNER_HARNESS_PROBLEM, SCOPE_UNREAD_PROBLEM } from '../server/orchestrators.js'
import { saveEndpoints } from '../server/endpoints.js'
import { gitPath } from '../server/programPath.js'
import { parseRunArgs, runRecord } from '../src/briefs/run.js'
import { getJson, postJson, readFrames } from './helpers/bridge.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PROMPT = 'project={{PROJECT}}\nmachineroom={{MACHINEROOM}}\nruns={{RUNS}}\nbridge={{BRIDGE}}'
const LANES = {
  orchestrator: { name: 'Orchestrator', harness: 'Claude Code', cli: { harness: 'claude', bin: 'claude', model: 'opus' } },
  opencode: { name: 'OpenCode', harness: 'OpenCode', cli: { harness: 'opencode', bin: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' } },
  opencode2: { name: 'OpenCode 2', harness: 'OpenCode', cli: { harness: 'opencode', bin: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' } },
  claude: { name: 'Claude Code', harness: 'Claude Code', cli: { harness: 'claude', bin: 'claude', model: 'sonnet' } },
}
const FRONTEND = {
  id: 'frontend',
  name: 'Frontend',
  harness: 'claude',
  model: 'sonnet',
  lanes: ['opencode'],
  scope: ['src/ui/**'],
  restricted: true,
  setBy: 'owner',
}

const FAKE_AGENT = [
  "import { appendFileSync, existsSync } from 'node:fs'",
  'const args = process.argv.slice(2)',
  "const calls = String(process.env.MR_CALLS ?? '')",
  "if (calls) appendFileSync(calls, JSON.stringify({ pid: process.pid, args, cwd: process.cwd() }) + '\\n')",
  "const mode = String(process.env.MR_MODE ?? 'reply')",
  "const claude = args.includes('-p')",
  "const prompt = claude ? String(args[args.indexOf('-p') + 1] ?? '') : String(args.at(-1) ?? '')",
  'const hold = async () => {',
  "  while (!existsSync(String(process.env.MR_RELEASE ?? ''))) {",
  '    await new Promise((done) => setTimeout(done, 20))',
  '  }',
  '}',
  'if (claude) {',
  "  console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake' }))",
  "  console.log(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Working.' }] } }))",
  "  if (mode === 'hold') await hold()",
  "  const keyReply = 'I read OPENROUTER_API_KEY=' + 'sk-or-v1-' + 'q'.repeat(24) + ' in the file.'",
  "  const reply = mode === 'empty' ? '' : mode === 'no_report' ? 'NO_REPORT' : mode === 'key' ? keyReply : 'Reply: ' + prompt.split('\\n').join(' / ').slice(0, 200)",
  "  console.log(JSON.stringify({ type: 'result', subtype: 'success', result: reply, total_cost_usd: 0.125, usage: { input_tokens: 12, output_tokens: 3 } }))",
  '} else {',
  "  const at = args.indexOf('--session')",
  "  const sessionId = at === -1 ? 'ses_fake_first' : String(args[at + 1] ?? '')",
  "  console.log(JSON.stringify({ type: 'step_start', timestamp: 1, sessionID: sessionId, part: { type: 'step-start' } }))",
  "  console.log(JSON.stringify({ type: 'tool_use', timestamp: 2, sessionID: sessionId, part: { id: 'prt_1', type: 'tool', tool: 'read', state: { status: 'completed', input: { filePath: 'src/math.js' } } } }))",
  "  if (mode === 'hold') await hold()",
  "  console.log(JSON.stringify({ type: 'text', timestamp: 3, sessionID: sessionId, part: { type: 'text', text: 'Working.' } }))",
  "  const reply = mode === 'no_report' ? 'NO_REPORT' : 'Reply: ' + prompt.split('\\n').join(' / ').slice(0, 200)",
  "  console.log(JSON.stringify({ type: 'text', timestamp: 4, sessionID: sessionId, part: { type: 'text', text: reply } }))",
  "  console.log(JSON.stringify({ type: 'step_finish', timestamp: 5, sessionID: sessionId, part: { type: 'step-finish', cost: 0.25, tokens: { input: 12, output: 3 } } }))",
  '}',
].join('\n')

const RUNNER = [
  "import { appendFileSync } from 'node:fs'",
  'const args = process.argv.slice(2)',
  "const target = String(args.shift() ?? '')",
  "appendFileSync(target, JSON.stringify(args) + '\\n')",
  "console.log('args ' + args.join(' '))",
].join('\n')

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function sleep(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms))
}

async function waitFor(check, timeoutMs = 15000, what = 'the condition') {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`)
    await sleep(15)
  }
}

function readLines(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

function git(folder, args) {
  const result = spawnSync(gitPath(), args, { cwd: folder, encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr ?? '').trim()}`)
}

function makeWorktree(project, base) {
  const folder = join(base, 'worktree')
  git(project, ['worktree', 'add', '-b', 'feat/k2', folder])
  mkdirSync(join(folder, 'Src', 'ui'), { recursive: true })
  mkdirSync(join(folder, 'server'), { recursive: true })
  writeFileSync(join(folder, 'Src', 'ui', 'a.jsx'), 'two\n')
  writeFileSync(join(folder, 'server', 'x.js'), 'outside\n')
  git(folder, ['add', '.'])
  git(folder, ['commit', '-m', 'change'])
  return folder
}

function makeBase({ ladder = null, branch = '' } = {}) {
  const base = makeTempDir('mr-orchestrators-')
  const runs = join(base, 'runs')
  const projectRoot = join(base, 'project')
  mkdirSync(runs, { recursive: true })
  mkdirSync(projectRoot, { recursive: true })
  if (branch) {
    mkdirSync(join(projectRoot, 'Src', 'ui'), { recursive: true })
    writeFileSync(join(projectRoot, 'Src', 'ui', 'a.jsx'), 'one\n')
    git(projectRoot, ['init', '-b', branch])
    git(projectRoot, ['config', 'user.email', 'test@example.com'])
    git(projectRoot, ['config', 'user.name', 'Test'])
    git(projectRoot, ['add', '.'])
    git(projectRoot, ['commit', '-m', 'base'])
  }
  const script = join(base, 'fake-agent.mjs')
  writeFileSync(script, FAKE_AGENT)
  const promptFile = join(base, 'orchestrator-agent.md')
  writeFileSync(promptFile, PROMPT)
  const callsFile = join(base, 'calls.jsonl')
  const releaseFile = join(base, 'release')
  const behaviour = { mode: 'reply' }
  const spawnFake = (file, args, options) => {
    const env = { ...(options.env ?? process.env), MR_CALLS: callsFile, MR_MODE: behaviour.mode, MR_RELEASE: releaseFile }
    return spawn(process.execPath, [script, ...args], { ...options, env })
  }
  if (ladder) {
    writeFileSync(
      chatFileFor(projectRoot, runs, 'orchestrator'),
      `${JSON.stringify({ project: projectRoot, sessionId: null, state: 'idle', messages: [], pending: [], ladder })}\n`
    )
  }
  const files = {
    base,
    runs,
    projectRoot,
    script,
    promptFile,
    callsFile,
    releaseFile,
    behaviour,
    spawnFake,
    calls: () => readLines(callsFile),
    chat: (id = 'orchestrator') => {
      try {
        return JSON.parse(readFileSync(chatFileFor(projectRoot, runs, id), 'utf8'))
      } catch {
        return null
      }
    },
  }
  cleanups.push(() => rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return files
}

function makeRig(files, extra = {}) {
  const activeFile = activeLanesFileFor(files.projectRoot, files.runs)
  if (!existsSync(activeFile) && extra.active !== false) {
    writeActiveLanes(activeFile, Object.keys(LANES).filter((k) => k !== 'orchestrator'))
  }
  const { active: _active, ...rest } = extra
  const registry = createOrchestrators({
    projectRoot: files.projectRoot,
    runsFolder: files.runs,
    lanes: LANES,
    spawn: files.spawnFake,
    promptFile: files.promptFile,
    bridgeUrl: () => 'http://127.0.0.1:5999',
    onNotice: () => {},
    ...rest,
  })
  cleanups.push(() => registry.close())
  return { ...files, registry }
}

function bridgeOptions(files, extra = {}) {
  return {
    projectRoot: files.projectRoot,
    port: 0,
    env: {},
    briefsDir: join(REPO_ROOT, 'docs', 'agents'),
    orchestratorPrompt: files.promptFile,
    lanesSource: { folder: files.runs, lanes: LANES, pollMs: 20, quietMs: 60000 },
    orchestratorSpawn: files.spawnFake,
    ...extra,
  }
}

async function makeBridge(files, extra = {}) {
  writeActiveLanes(activeLanesFileFor(files.projectRoot, files.runs), Object.keys(LANES).filter((k) => k !== 'orchestrator'))
  const bridge = createBridge(bridgeOptions(files, extra))
  cleanups.push(() => bridge.stop())
  const { url } = await bridge.start()
  return { ...files, bridge, url }
}

function messagesOf(registry, id = 'orchestrator') {
  const instance = registry.find(id)
  return instance ? instance.answer().messages : []
}

function turnMessages(registry, id = 'orchestrator') {
  return messagesOf(registry, id).filter((message) => message.from === 'orchestrator')
}

function frame(runName, status = 'succeeded', lane = 'opencode') {
  return { type: 'heartbeat.run.status', payload: { runId: `run-${runName}`, agentId: `agent-${lane}`, status } }
}

function appendRecord(files, { logName, lane = 'opencode', startedBy, project = '' }) {
  const log = join(files.runs, `${logName}.log`)
  writeFileSync(log, 'a log\n')
  const record = {
    lane,
    briefs: ['K1'],
    model: 'm',
    startedAt: '2026-10-25T12:00:00.000Z',
    minutes: 2,
    exitCode: 0,
    killed: false,
    costUsd: 0.5,
    log,
    branch: 'feat/k1-work',
    commits: ['abc1234 Work'],
    ...(startedBy ? { startedBy } : {}),
    ...(project ? { project } : {}),
  }
  appendFileSync(join(files.runs, 'runs.jsonl'), `${JSON.stringify(record)}\n`)
  return record
}

async function waitIdle(registry, id, turns) {
  await waitFor(
    () => registry.find(id)?.answer().state === 'idle' && turnMessages(registry, id).length === turns,
    15000,
    `${id} turn ${turns} to end`
  )
}

function pagePost(url, body) {
  return getJson(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
    body: JSON.stringify(body),
  })
}

function tokenPost(url, body, token = '') {
  return getJson(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'X-MachineRoom-Orchestrator': token } : {}),
    },
    body: JSON.stringify(body),
  })
}

describe('branchChanges', () => {
  it('diffs against the project branch, not main', () => {
    const base = makeTempDir('mr-branch-')
    cleanups.push(() => removeTempDir(base))
    const project = join(base, 'project')
    mkdirSync(join(project, 'src', 'ui'), { recursive: true })
    writeFileSync(join(project, 'src', 'ui', 'a.jsx'), 'one\n')
    git(project, ['init', '-b', 'trunk'])
    git(project, ['config', 'user.email', 'test@example.com'])
    git(project, ['config', 'user.name', 'Test'])
    git(project, ['add', '.'])
    git(project, ['commit', '-m', 'base'])

    const worktree = join(base, 'worktree')
    git(project, ['worktree', 'add', '-b', 'feat/k2', worktree])
    mkdirSync(join(worktree, 'server'), { recursive: true })
    writeFileSync(join(worktree, 'src', 'ui', 'a.jsx'), 'two\n')
    writeFileSync(join(worktree, 'server', 'x.js'), 'outside\n')
    git(worktree, ['add', '.'])
    git(worktree, ['commit', '-m', 'change'])

    expect(branchChanges({ project: worktree }, {}, { project })).toEqual(['server/x.js', 'src/ui/a.jsx'])
  })

  it('lists paths relative to a project that sits below the repository root', () => {
    const base = makeTempDir('mr-branch-')
    cleanups.push(() => removeTempDir(base))
    const repo = join(base, 'repo')
    const project = join(repo, 'packages', 'app')
    mkdirSync(join(project, 'src'), { recursive: true })
    writeFileSync(join(project, 'src', 'a.js'), 'one\n')
    git(repo, ['init', '-b', 'main'])
    git(repo, ['config', 'user.email', 'test@example.com'])
    git(repo, ['config', 'user.name', 'Test'])
    git(repo, ['add', '.'])
    git(repo, ['commit', '-m', 'base'])

    const worktree = join(base, 'worktree')
    git(repo, ['worktree', 'add', '-b', 'feat/k2', worktree])
    mkdirSync(join(worktree, 'packages', 'app', 'server'), { recursive: true })
    writeFileSync(join(worktree, 'packages', 'app', 'src', 'a.js'), 'two\n')
    writeFileSync(join(worktree, 'packages', 'app', 'server', 'y.js'), 'outside\n')
    git(worktree, ['add', '.'])
    git(worktree, ['commit', '-m', 'change'])

    expect(branchChanges({ project: worktree }, {}, { project })).toEqual(['server/y.js', 'src/a.js'])
  })

  it('lists uncommitted paths beside the committed ones', () => {
    const base = makeTempDir('mr-branch-')
    cleanups.push(() => removeTempDir(base))
    const project = join(base, 'project')
    mkdirSync(join(project, 'src'), { recursive: true })
    mkdirSync(join(project, 'server'), { recursive: true })
    writeFileSync(join(project, 'src', 'old.js'), 'old\n')
    writeFileSync(join(project, 'server', 'edited.js'), 'one\n')
    git(project, ['init', '-b', 'main'])
    git(project, ['config', 'user.email', 'test@example.com'])
    git(project, ['config', 'user.name', 'Test'])
    git(project, ['add', '.'])
    git(project, ['commit', '-m', 'base'])

    const worktree = join(base, 'worktree')
    git(project, ['worktree', 'add', '-b', 'feat/k3', worktree])
    writeFileSync(join(worktree, 'server', 'committed.js'), 'committed\n')
    git(worktree, ['add', '.'])
    git(worktree, ['commit', '-m', 'change'])
    writeFileSync(join(worktree, 'server', 'committed.js'), 'committed again\n')
    writeFileSync(join(worktree, 'server', 'edited.js'), 'two\n')
    writeFileSync(join(worktree, 'secret.txt'), 'secret\n')
    mkdirSync(join(worktree, 'secret'), { recursive: true })
    git(worktree, ['mv', 'src/old.js', 'secret/moved.js'])

    const changes = branchChanges({ project: worktree }, {}, { project })
    expect(Array.isArray(changes), `branchChanges returned ${JSON.stringify(changes)}`).toBe(true)
    expect(changes.sort()).toEqual(
      ['secret/moved.js', 'secret.txt', 'server/committed.js', 'server/edited.js', 'src/old.js'].sort()
    )
  })

  it('lists an untracked file in the project folder', () => {
    const base = makeTempDir('mr-branch-')
    cleanups.push(() => removeTempDir(base))
    const project = join(base, 'project')
    mkdirSync(join(project, 'src'), { recursive: true })
    writeFileSync(join(project, 'src', 'a.js'), 'one\n')
    git(project, ['init', '-b', 'main'])
    git(project, ['config', 'user.email', 'test@example.com'])
    git(project, ['config', 'user.name', 'Test'])
    git(project, ['add', '.'])
    git(project, ['commit', '-m', 'base'])
    writeFileSync(join(project, 'secret.txt'), 'secret\n')

    expect(branchChanges({ project })).toEqual(['secret.txt'])
  })

  it('lists only the committed changes when the tree is clean', () => {
    const base = makeTempDir('mr-branch-')
    cleanups.push(() => removeTempDir(base))
    const project = join(base, 'project')
    mkdirSync(join(project, 'src'), { recursive: true })
    writeFileSync(join(project, 'src', 'a.js'), 'one\n')
    git(project, ['init', '-b', 'main'])
    git(project, ['config', 'user.email', 'test@example.com'])
    git(project, ['config', 'user.name', 'Test'])
    git(project, ['add', '.'])
    git(project, ['commit', '-m', 'base'])

    const worktree = join(base, 'worktree')
    git(project, ['worktree', 'add', '-b', 'feat/k3', worktree])
    writeFileSync(join(worktree, 'src', 'a.js'), 'two\n')
    mkdirSync(join(worktree, 'server'), { recursive: true })
    writeFileSync(join(worktree, 'server', 'b.js'), 'outside\n')
    git(worktree, ['add', '.'])
    git(worktree, ['commit', '-m', 'change'])

    expect(branchChanges({ project: worktree }, {}, { project }).sort()).toEqual(['server/b.js', 'src/a.js'])
  })

  it('reads a lane worktree only from the lane file own keys', () => {
    const lanes = Object.create({ opencode: { worktree: join(REPO_ROOT, 'no-such-lane-worktree') } })
    expect(branchChanges({ lane: 'opencode' }, lanes)).toEqual([])
  })
})

describe('the orchestrator registry', () => {
  it('sends the agents and family notices when the ladder changes', async () => {
    const notices = []
    let answer = null
    const rig = makeRig(makeBase(), {
      onNotice: (event) => notices.push(event.topic),
      readJsonBody: async () => ({ ladder: { subs: [FRONTEND] }, by: 'owner', confirmed: true }),
      sendJson: (req, res, status, body) => {
        answer = { status, body }
      },
    })
    const req = { method: 'POST', headers: { origin: 'http://localhost:5173' } }
    await rig.registry.handle(req, {}, new URL('http://127.0.0.1/api/orchestrator/ladder'))
    expect(answer.status).toBe(200)
    expect(notices).toEqual(expect.arrayContaining(['agents', 'family']))
  })

  it('keeps the main orchestrator alone and unchanged when there is no ladder', async () => {
    const rig = makeRig(makeBase())
    const list = rig.registry.list()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      id: 'orchestrator',
      name: 'Orchestrator',
      harness: 'claude',
      model: 'opus',
      state: 'idle',
      scope: [],
      restricted: false,
      setBy: 'owner',
    })
    expect([...list[0].lanes].sort()).toEqual(['claude', 'opencode', 'opencode2'])
    expect(rig.registry.find('frontend')).toBeNull()
    expect(rig.chat()).toBeTruthy()
    expect(Object.hasOwn(rig.chat(), 'ladder')).toBe(false)

    rig.registry.main.send({ text: 'Hello', confirmed: true })
    await waitIdle(rig.registry, 'orchestrator', 1)
    const record = readLines(join(rig.runs, 'runs.jsonl')).at(-1)
    expect(record.lane).toBe('orchestrator')
    expect(basename(record.log)).toMatch(/^orchestrator-chat-/)
    expect(rig.calls()[0].args).toContain('-p')

    appendRecord(rig, { logName: 'opencode-K1-20261025-120000' })
    rig.registry.onFrame(frame('opencode-K1-20261025-120000'))
    await waitIdle(rig.registry, 'orchestrator', 2)
    expect(rig.calls()[1].args[1]).toContain('Run opencode-K1-20261025-120000 on lane opencode ended: succeeded.')
  })

  it('leaves out a retired lane from the main orchestrator lanes', () => {
    const files = makeBase()
    const lanesWithRetired = {
      ...LANES,
      hermes: { name: 'Hermes', retired: true, cli: { harness: 'hermes', bin: 'hermes', model: 'hermes-3' } },
    }
    const activeFile = activeLanesFileFor(files.projectRoot, files.runs)
    writeActiveLanes(activeFile, ['opencode', 'hermes', 'claude'])
    const rig = makeRig(files, { lanes: lanesWithRetired })
    const mainEntry = rig.registry.list()[0]
    expect(mainEntry.lanes).toContain('opencode')
    expect(mainEntry.lanes).toContain('claude')
    expect(mainEntry.lanes).not.toContain('hermes')
    expect(rig.registry.sector('orchestrator').lanes).toEqual(mainEntry.lanes)
  })

  it('leaves out an inactive lane when an active choice has been made', () => {
    const files = makeBase()
    const activeFile = activeLanesFileFor(files.projectRoot, files.runs)
    writeActiveLanes(activeFile, ['opencode'])
    const rig = makeRig(files)
    const mainEntry = rig.registry.list()[0]
    expect(mainEntry.lanes).toEqual(['opencode'])
    expect(rig.registry.sector('orchestrator').lanes).toEqual(['opencode'])
  })

  it('leaves out a lane that a sub orchestrator claims', () => {
    const files = makeBase({ ladder: { subs: [FRONTEND] } })
    const activeFile = activeLanesFileFor(files.projectRoot, files.runs)
    writeActiveLanes(activeFile, ['opencode', 'opencode2', 'claude'])
    const rig = makeRig(files)
    const list = rig.registry.list()
    expect(list[0].lanes).toEqual(['opencode2', 'claude'])
    expect(list[1].lanes).toEqual(['opencode'])
    expect(rig.registry.sector('orchestrator').lanes).toEqual(['opencode2', 'claude'])
  })

  it('lists no lanes when no active lanes choice has been made', () => {
    const files = makeBase()
    const rig = makeRig(files, { active: false })
    const mainEntry = rig.registry.list()[0]
    expect(mainEntry.lanes).toEqual([])
    expect(rig.registry.sector('orchestrator').lanes).toEqual([])
  })

  it('reads and sets autocompact per orchestrator', async () => {
    const rig = await makeBridge(makeBase())
    const chat = await getJson(`${rig.url}/api/orchestrator`)
    expect(chat.status).toBe(200)
    expect(chat.body).toMatchObject({
      contextTokens: null,
      contextWindow: 200000,
      autocompact: true,
      autocompactMode: 'percent',
      autocompactValue: 80,
      compactRules: '',
      autocompactPercent: 80,
    })
    expect((await getJson(`${rig.url}/api/orchestrators`)).body[0]).toMatchObject({
      contextTokens: null,
      contextWindow: 200000,
      autocompact: true,
      autocompactMode: 'percent',
      autocompactValue: 80,
      compactRules: '',
      autocompactPercent: 80,
    })

    const noOrigin = await postJson(`${rig.url}/api/orchestrator/autocompact`, { id: 'orchestrator', on: false, confirmed: true })
    expect(noOrigin.status).toBe(403)
    expect(noOrigin.body).toEqual({ error: 'A request with no Origin cannot set autocompact.' })

    expect((await pagePost(`${rig.url}/api/orchestrator/autocompact`, { id: 'orchestrator', on: false })).body).toEqual({
      error: 'Confirm the autocompact change first.',
    })
    expect((await pagePost(`${rig.url}/api/orchestrator/autocompact`, { id: 'orchestrator', on: 'yes', confirmed: true })).status).toBe(400)
    expect((await pagePost(`${rig.url}/api/orchestrator/autocompact`, { id: 'orchestrator', percent: 0, confirmed: true })).status).toBe(400)
    expect((await pagePost(`${rig.url}/api/orchestrator/autocompact`, { id: 'orchestrator', percent: 101, confirmed: true })).status).toBe(400)
    expect(
      (await pagePost(`${rig.url}/api/orchestrator/autocompact`, { id: 'orchestrator', mode: 'tokens', value: 999, confirmed: true })).status
    ).toBe(400)
    expect(
      (await pagePost(`${rig.url}/api/orchestrator/autocompact`, { id: 'orchestrator', mode: 'tokens', value: 10000001, confirmed: true })).status
    ).toBe(400)
    expect(
      (await pagePost(`${rig.url}/api/orchestrator/autocompact`, { id: 'orchestrator', mode: 'invalid', confirmed: true })).status
    ).toBe(400)
    expect(
      (await pagePost(`${rig.url}/api/orchestrator/autocompact`, { id: 'orchestrator', rules: 'a'.repeat(2001), confirmed: true })).status
    ).toBe(400)

    const off = await pagePost(`${rig.url}/api/orchestrator/autocompact`, { id: 'orchestrator', on: false, percent: 75, confirmed: true })
    expect(off.status).toBe(200)
    expect(off.body).toEqual({
      id: 'orchestrator',
      autocompact: false,
      autocompactMode: 'percent',
      autocompactValue: 75,
      compactRules: '',
      autocompactPercent: 75,
    })
    expect((await getJson(`${rig.url}/api/orchestrator`)).body.autocompact).toBe(false)
    expect((await getJson(`${rig.url}/api/orchestrator`)).body.autocompactPercent).toBe(75)
    expect(rig.chat().autocompact).toBe(false)
    expect(rig.chat().autocompactPercent).toBe(75)

    const tokensRes = await pagePost(`${rig.url}/api/orchestrator/autocompact`, {
      id: 'orchestrator',
      mode: 'tokens',
      value: 60000,
      rules: 'Keep all decisions.',
      confirmed: true,
    })
    expect(tokensRes.status).toBe(200)
    expect(tokensRes.body).toMatchObject({
      id: 'orchestrator',
      autocompact: false,
      autocompactMode: 'tokens',
      autocompactValue: 60000,
      compactRules: 'Keep all decisions.',
    })
    expect((await getJson(`${rig.url}/api/orchestrator`)).body).toMatchObject({
      autocompactMode: 'tokens',
      autocompactValue: 60000,
      compactRules: 'Keep all decisions.',
    })

    const page = await pagePost(`${rig.url}/api/orchestrator/autocompact`, { id: 'orchestrator', on: true, confirmed: true })
    expect(page.status).toBe(200)
    expect((await getJson(`${rig.url}/api/orchestrator`)).body.autocompact).toBe(true)
    expect((await pagePost(`${rig.url}/api/orchestrator/autocompact`, { id: 'missing', on: true, confirmed: true })).status).toBe(404)

    await pagePost(`${rig.url}/api/orchestrator/ladder`, { ladder: { subs: [FRONTEND] }, by: 'owner', confirmed: true })
    expect((await getJson(`${rig.url}/api/orchestrators`)).body[1]).toMatchObject({
      contextTokens: null,
      contextWindow: 200000,
      autocompact: true,
      autocompactMode: 'percent',
      autocompactValue: 80,
      compactRules: '',
      autocompactPercent: 80,
    })
    expect((await pagePost(`${rig.url}/api/orchestrator/autocompact`, { id: 'frontend', on: false, percent: 60, confirmed: true })).status).toBe(200)
    expect(rig.chat('frontend').autocompact).toBe(false)
    expect(rig.chat('frontend').autocompactPercent).toBe(60)
  })

  it('compacts now and sets the model for an orchestrator', async () => {
    const rig = await makeBridge(makeBase())
    const noOriginCompact = await postJson(`${rig.url}/api/orchestrator/compact`, { confirmed: true })
    expect(noOriginCompact.status).toBe(403)
    expect(noOriginCompact.body).toEqual({ error: 'A request with no Origin cannot compact an orchestrator.' })

    const noOriginModel = await postJson(`${rig.url}/api/orchestrator/model`, { model: 'claude-sonnet-5-5', confirmed: true })
    expect(noOriginModel.status).toBe(403)
    expect(noOriginModel.body).toEqual({ error: 'A request with no Origin cannot set the model.' })

    expect((await pagePost(`${rig.url}/api/orchestrator/compact`, {})).status).toBe(400)
    expect((await pagePost(`${rig.url}/api/orchestrator/compact`, { confirmed: true })).status).toBe(400)
    expect((await pagePost(`${rig.url}/api/orchestrator/compact`, { confirmed: true, keep: 'a'.repeat(2001) })).status).toBe(400)
    expect((await pagePost(`${rig.url}/api/orchestrator/compact`, { id: 'missing', confirmed: true })).status).toBe(404)

    expect((await pagePost(`${rig.url}/api/orchestrator/model`, { confirmed: false })).status).toBe(400)
    expect((await pagePost(`${rig.url}/api/orchestrator/model`, { model: 'unlisted-model', confirmed: true })).status).toBe(400)
    expect((await pagePost(`${rig.url}/api/orchestrator/model`, { model: 'opencode/deepseek-v4.1-flash-free', confirmed: true })).status).toBe(400)
    expect((await pagePost(`${rig.url}/api/orchestrator/model`, { id: 'missing', model: 'claude-haiku-5-5', confirmed: true })).status).toBe(404)

    const modelSet = await pagePost(`${rig.url}/api/orchestrator/model`, { model: 'claude-haiku-5-5', confirmed: true })
    expect(modelSet.status).toBe(200)
    expect(modelSet.body).toEqual({ id: 'orchestrator', model: 'claude-haiku-5-5' })
    expect((await getJson(`${rig.url}/api/orchestrator`)).body.model).toBe('claude-haiku-5-5')
    expect((await getJson(`${rig.url}/api/orchestrators`)).body[0].model).toBe('claude-haiku-5-5')
  })

  it('sets the harness and model for an orchestrator over the bridge route', async () => {
    const files = makeBase({ ladder: { subs: [FRONTEND] } })
    const lanes = {
      ...LANES,
      orchestrator: { ...LANES.orchestrator, cli: { ...LANES.orchestrator.cli, bin: process.execPath } },
      claude: { name: 'Claude Code', harness: 'Claude Code', cli: { harness: 'claude', bin: process.execPath, model: 'sonnet' } },
      opencode: { name: 'OpenCode', harness: 'OpenCode', cli: { harness: 'opencode', bin: process.execPath, model: 'opencode-go/deepseek-v4.1-flash' } },
      acp: { name: 'ACP', harness: 'ACP', cli: { harness: 'acp', bin: join(files.base, 'does-not-exist.exe'), model: 'm' } },
    }
    const rig = await makeBridge(files, { lanesSource: { folder: files.runs, lanes, pollMs: 20, quietMs: 60000 } })

    const noOriginHarness = await postJson(`${rig.url}/api/orchestrator/harness`, { harness: 'claude', model: 'claude-haiku-5-5', confirmed: true })
    expect(noOriginHarness.status).toBe(403)
    expect(noOriginHarness.body).toEqual({ error: OWNER_HARNESS_PROBLEM })

    expect((await pagePost(`${rig.url}/api/orchestrator/harness`, { harness: 'claude', model: 'claude-haiku-5-5' })).body).toEqual({
      error: CONFIRM_HARNESS_PROBLEM,
    })

    const unavailableHarness = await pagePost(`${rig.url}/api/orchestrator/harness`, { harness: 'acp', model: 'some-model', confirmed: true })
    expect(unavailableHarness.status).toBe(400)
    expect(unavailableHarness.body).toEqual({ error: 'The harness acp is not available on this computer.' })

    const unavailableModel = await pagePost(`${rig.url}/api/orchestrator/harness`, { harness: 'claude', model: 'opencode/deepseek-v4.1-flash-free', confirmed: true })
    expect(unavailableModel.status).toBe(400)
    expect(unavailableModel.body).toEqual({ error: 'The model opencode/deepseek-v4.1-flash-free is not available for claude.' })

    expect((await pagePost(`${rig.url}/api/orchestrator/harness`, { id: 'missing', harness: 'claude', model: 'claude-haiku-5-5', confirmed: true })).status).toBe(404)

    const mainChanged = await pagePost(`${rig.url}/api/orchestrator/harness`, { harness: 'claude', model: 'claude-sonnet-5-5', confirmed: true })
    expect(mainChanged.status).toBe(200)
    expect(mainChanged.body).toMatchObject({
      id: 'orchestrator',
      harness: 'claude',
      model: 'claude-sonnet-5-5',
      contextWindow: 1000000,
    })
    expect(rig.chat('orchestrator')).toMatchObject({
      harness: 'claude',
      model: 'claude-sonnet-5-5',
      contextWindow: 1000000,
      sessionId: null,
    })

    const subChanged = await pagePost(`${rig.url}/api/orchestrator/harness`, { id: 'frontend', harness: 'opencode', model: 'opencode/deepseek-v4.1-flash-free', confirmed: true })
    expect(subChanged.status).toBe(200)
    expect(subChanged.body).toMatchObject({
      id: 'frontend',
      harness: 'opencode',
      model: 'opencode/deepseek-v4.1-flash-free',
      contextWindow: 200000,
    })
    expect(rig.chat('frontend')).toMatchObject({
      harness: 'opencode',
      model: 'opencode/deepseek-v4.1-flash-free',
      sessionId: null,
    })
    expect(rig.chat('orchestrator').ladder.subs[0]).toMatchObject({
      id: 'frontend',
      harness: 'opencode',
      model: 'opencode/deepseek-v4.1-flash-free',
    })

    const list = (await getJson(`${rig.url}/api/orchestrators`)).body
    expect(list[0].harnesses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ harness: 'claude' }),
        expect.objectContaining({ harness: 'opencode' }),
      ])
    )
    const claudeEntry = list[0].harnesses.find((item) => item.harness === 'claude')
    expect(claudeEntry.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'claude-sonnet-5-5', contextWindow: 1000000 }),
      ])
    )

    files.behaviour.mode = 'hold'
    await pagePost(`${rig.url}/api/orchestrator/messages`, { id: 'orchestrator', text: 'Work on something', confirmed: true })
    await waitFor(() => rig.chat('orchestrator')?.state === 'working')
    const runningConflict = await pagePost(`${rig.url}/api/orchestrator/harness`, { harness: 'claude', model: 'claude-haiku-5-5', confirmed: true })
    expect(runningConflict.status).toBe(409)
    expect(runningConflict.body).toEqual({ error: 'A turn is already running.' })
    writeFileSync(files.releaseFile, 'go')
    await waitFor(() => rig.chat('orchestrator')?.state === 'idle')
  })

  it('offers and sets the machineroom harness when an endpoint is saved', async () => {
    const files = makeBase()
    saveEndpoints(files.runs, [
      {
        name: 'Work',
        provider: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        keyName: 'openrouter',
        models: ['alpha'],
      },
    ])
    const rig = await makeBridge(files)

    const list = (await getJson(`${rig.url}/api/orchestrators`)).body
    const machineroom = list[0].harnesses.find((entry) => entry.harness === 'machineroom')
    expect(machineroom).toBeDefined()

    const changed = await pagePost(`${rig.url}/api/orchestrator/harness`, {
      harness: 'machineroom',
      model: 'Work/alpha',
      confirmed: true,
    })
    expect(changed.status).toBe(200)
    expect(changed.body).toMatchObject({ id: 'orchestrator', harness: 'machineroom', model: 'Work/alpha' })
  })

  it('sets reasoning effort and manages sessions over the bridge routes', async () => {
    const rig = await makeBridge(makeBase())

    const noOriginEffort = await postJson(`${rig.url}/api/orchestrator/effort`, { effort: 'high', confirmed: true })
    expect(noOriginEffort.status).toBe(403)
    expect(noOriginEffort.body).toEqual({ error: 'A request with no Origin cannot set effort.' })

    expect((await pagePost(`${rig.url}/api/orchestrator/effort`, { effort: 'high' })).status).toBe(400)
    expect((await pagePost(`${rig.url}/api/orchestrator/effort`, { effort: 'invalid', confirmed: true })).status).toBe(400)
    expect((await pagePost(`${rig.url}/api/orchestrator/effort`, { id: 'missing', effort: 'high', confirmed: true })).status).toBe(404)

    const setHigh = await pagePost(`${rig.url}/api/orchestrator/effort`, { effort: 'high', confirmed: true })
    expect(setHigh.status).toBe(200)
    expect(setHigh.body).toEqual({ id: 'orchestrator', effort: 'high' })
    expect((await getJson(`${rig.url}/api/orchestrator`)).body.effort).toBe('high')
    expect((await getJson(`${rig.url}/api/orchestrators`)).body[0].effort).toBe('high')

    const clearEffort = await pagePost(`${rig.url}/api/orchestrator/effort`, { effort: null, confirmed: true })
    expect(clearEffort.status).toBe(200)
    expect((await getJson(`${rig.url}/api/orchestrator`)).body.effort).toBeNull()

    const initialSessions = await getJson(`${rig.url}/api/orchestrator/sessions`)
    expect(initialSessions.status).toBe(200)
    expect(initialSessions.body).toEqual({
      current: { title: null, startedAt: null, count: 0 },
      sessions: [],
    })

    const noOriginNew = await postJson(`${rig.url}/api/orchestrator/sessions/new`, { confirmed: true })
    expect(noOriginNew.status).toBe(403)
    expect(noOriginNew.body).toEqual({ error: 'A request with no Origin cannot change sessions.' })

    const unconfirmedNew = await pagePost(`${rig.url}/api/orchestrator/sessions/new`, {})
    expect(unconfirmedNew.status).toBe(400)

    const sent1 = await pagePost(`${rig.url}/api/orchestrator/messages`, { text: 'Create initial database schema', confirmed: true })
    expect(sent1.status).toBe(202)
    await waitFor(() => rig.chat()?.messages.some((m) => m.from === 'orchestrator'))

    const currentAfterSend = await getJson(`${rig.url}/api/orchestrator/sessions`)
    expect(currentAfterSend.body.current.title).toBe('Create initial database schema')
    expect(currentAfterSend.body.current.count).toBe(2)

    const newArchived = await pagePost(`${rig.url}/api/orchestrator/sessions/new`, { confirmed: true })
    expect(newArchived.status).toBe(200)

    const sessionsAfterNew = await getJson(`${rig.url}/api/orchestrator/sessions`)
    expect(sessionsAfterNew.body.current.count).toBe(0)
    expect(sessionsAfterNew.body.sessions).toHaveLength(1)
    const session1 = sessionsAfterNew.body.sessions[0]
    expect(session1.title).toBe('Create initial database schema')
    expect(session1.pinned).toBe(false)
    expect(session1.count).toBe(2)

    const sent2 = await pagePost(`${rig.url}/api/orchestrator/messages`, { text: 'Add authentication routes for users', confirmed: true })
    expect(sent2.status).toBe(202)
    await waitFor(() => rig.chat()?.messages.some((m) => m.from === 'orchestrator') && rig.chat()?.state === 'idle')

    const new2 = await pagePost(`${rig.url}/api/orchestrator/sessions/new`, { confirmed: true })
    expect(new2.status).toBe(200)
    const sessionsAfterSecond = await getJson(`${rig.url}/api/orchestrator/sessions`)
    expect(sessionsAfterSecond.body.sessions).toHaveLength(2)

    const singleSession = await getJson(`${rig.url}/api/orchestrator/sessions/${session1.id}`)
    expect(singleSession.status).toBe(200)
    expect(singleSession.body.id).toBe(session1.id)
    expect(singleSession.body.messages).toHaveLength(2)

    expect((await getJson(`${rig.url}/api/orchestrator/sessions/missing-id`)).status).toBe(404)

    const noOriginUpdate = await postJson(`${rig.url}/api/orchestrator/sessions/${session1.id}`, { pinned: true, confirmed: true })
    expect(noOriginUpdate.status).toBe(403)
    expect((await pagePost(`${rig.url}/api/orchestrator/sessions/${session1.id}`, { pinned: true })).status).toBe(400)
    expect((await pagePost(`${rig.url}/api/orchestrator/sessions/missing-id`, { pinned: true, confirmed: true })).status).toBe(404)

    const updated = await pagePost(`${rig.url}/api/orchestrator/sessions/${session1.id}`, {
      pinned: true,
      title: 'Database Schema v1',
      confirmed: true,
    })
    expect(updated.status).toBe(200)
    expect(updated.body).toMatchObject({ id: session1.id, pinned: true, title: 'Database Schema v1' })

    const sessionsPinned = (await getJson(`${rig.url}/api/orchestrator/sessions`)).body.sessions
    expect(sessionsPinned[0].id).toBe(session1.id)
    expect(sessionsPinned[0].pinned).toBe(true)
    expect(sessionsPinned[0].title).toBe('Database Schema v1')

    const noOriginOpen = await postJson(`${rig.url}/api/orchestrator/sessions/${session1.id}/open`, { confirmed: true })
    expect(noOriginOpen.status).toBe(403)
    expect((await pagePost(`${rig.url}/api/orchestrator/sessions/${session1.id}/open`, {})).status).toBe(400)
    expect((await pagePost(`${rig.url}/api/orchestrator/sessions/missing-id/open`, { confirmed: true })).status).toBe(404)

    const opened = await pagePost(`${rig.url}/api/orchestrator/sessions/${session1.id}/open`, { confirmed: true })
    expect(opened.status).toBe(200)
    expect((await getJson(`${rig.url}/api/orchestrator`)).body.messages).toHaveLength(2)

    const noOriginDelete = await postJson(`${rig.url}/api/orchestrator/sessions/${sessionsPinned[1].id}/delete`, { confirmed: true })
    expect(noOriginDelete.status).toBe(403)
    expect((await pagePost(`${rig.url}/api/orchestrator/sessions/missing-id/delete`, { confirmed: true })).status).toBe(404)

    const deleted = await pagePost(`${rig.url}/api/orchestrator/sessions/${sessionsPinned[1].id}/delete`, { confirmed: true })
    expect(deleted.status).toBe(200)

    const remainingSessions = (await getJson(`${rig.url}/api/orchestrator/sessions`)).body.sessions
    expect(remainingSessions).toHaveLength(1)
    expect(remainingSessions[0].id).toBe(session1.id)
  })

  it('attaches a sub from the owner ladder, answers its chat by id and removes it', async () => {
    const rig = await makeBridge(makeBase())
    expect((await getJson(`${rig.url}/api/orchestrators`)).body).toHaveLength(1)

    const attached = await pagePost(`${rig.url}/api/orchestrator/ladder`, {
      ladder: { subs: [FRONTEND] },
      by: 'owner',
      confirmed: true,
    })
    expect(attached.status).toBe(200)
    expect(attached.body.ladder.subs).toHaveLength(1)

    const list = (await getJson(`${rig.url}/api/orchestrators`)).body
    expect(list).toHaveLength(2)
    expect(list[1]).toMatchObject({
      id: 'frontend',
      name: 'Frontend',
      harness: 'claude',
      model: 'sonnet',
      state: 'idle',
      lanes: ['opencode'],
      scope: ['src/ui/**'],
      restricted: true,
      setBy: 'owner',
    })

    const chat = await getJson(`${rig.url}/api/orchestrator?id=frontend`)
    expect(chat.status).toBe(200)
    expect(chat.body).toMatchObject({ id: 'frontend', name: 'Frontend', parent: 'orchestrator', model: 'sonnet' })
    expect(chat.body.messages).toEqual([])
    expect((await getJson(`${rig.url}/api/orchestrator?id=missing`)).status).toBe(404)

    const sent = await pagePost(`${rig.url}/api/orchestrator/messages`, { id: 'frontend', text: 'Build the header', confirmed: true })
    expect(sent.status).toBe(202)
    await waitFor(() => rig.chat('frontend')?.messages.some((message) => message.from === 'orchestrator'))
    const call = rig.calls().find((item) => item.args.includes('--append-system-prompt'))
    const instruction = call.args[call.args.indexOf('--append-system-prompt') + 1]
    expect(instruction).toContain(`project=${rig.projectRoot}`)
    expect(instruction).toContain('Your id is `frontend`')
    expect(instruction).toContain('Your parent is `orchestrator`')
    expect(instruction).toContain('Your scope: `src/ui/**`')

    expect((await pagePost(`${rig.url}/api/orchestrator/stop`, { id: 'frontend', confirmed: true })).body).toEqual({ ok: true })
    expect((await getJson(`${rig.url}/api/orchestrator?id=frontend`)).body.state).toBe('paused')

    const removed = await pagePost(`${rig.url}/api/orchestrator/ladder`, { ladder: { subs: [] }, by: 'owner', confirmed: true })
    expect(removed.status).toBe(200)
    expect((await getJson(`${rig.url}/api/orchestrator?id=frontend`)).status).toBe(404)
    expect((await getJson(`${rig.url}/api/orchestrators`)).body).toHaveLength(1)
  })

  it('refuses a second room on the same project', async () => {
    const files = makeBase()
    const first = await makeBridge(files)
    expect((await getJson(`${first.url}/api/orchestrator`)).status).toBe(200)
    expect(() => createBridge(bridgeOptions(files))).toThrow(/Another room is already running on this project/)
    await first.bridge.stop()
    const second = await makeBridge(files)
    expect((await getJson(`${second.url}/api/orchestrator`)).status).toBe(200)
  })

  it('refuses a ladder that does not read and a write without a confirmation', async () => {
    const rig = await makeBridge(makeBase())
    const mainToken = rig.bridge.orchestrators().token('orchestrator')
    const unconfirmed = await tokenPost(`${rig.url}/api/orchestrator/ladder`, { ladder: { subs: [] }, by: 'owner' }, mainToken)
    expect(unconfirmed.body).toEqual({ error: 'Confirm the ladder first.' })

    const missing = await pagePost(`${rig.url}/api/orchestrator/ladder`, { by: 'owner', confirmed: true })
    expect(missing.status).toBe(400)
    expect(missing.body.problems).toEqual(['The ladder is not an object.'])

    const bad = await pagePost(`${rig.url}/api/orchestrator/ladder`, {
      ladder: { subs: [{ ...FRONTEND, id: 'Frontend' }] },
      by: 'owner',
      confirmed: true,
    })
    expect(bad.status).toBe(400)
    expect(bad.body.problems).toContain('The sub id "Frontend" must be 1 to 24 lower case letters, digits or dashes.')

    const wrongLane = await pagePost(`${rig.url}/api/orchestrator/ladder`, {
      ladder: { subs: [{ ...FRONTEND, lanes: ['nope'] }] },
      by: 'owner',
      confirmed: true,
    })
    expect(wrongLane.status).toBe(400)
    expect(wrongLane.body.problems).toContain('Sub "frontend" names the lane "nope", which is not a lane key.')
    expect((await getJson(`${rig.url}/api/orchestrators`)).body).toHaveLength(1)
  })

  it('lets only the owner change a scope the owner set', async () => {
    const rig = await makeBridge(makeBase())
    const mainToken = rig.bridge.orchestrators().token('orchestrator')
    expect((await pagePost(`${rig.url}/api/orchestrator/ladder`, { ladder: { subs: [FRONTEND] }, by: 'owner', confirmed: true })).status).toBe(200)

    const changedScope = await tokenPost(`${rig.url}/api/orchestrator/ladder`, {
      ladder: { subs: [{ ...FRONTEND, scope: ['src/ui/**', 'src/engine/**'] }] },
      by: 'orchestrator',
      confirmed: true,
    }, mainToken)
    expect(changedScope.status).toBe(403)
    expect(changedScope.body.problems[0]).toContain('Sub "frontend" was set by the owner')

    const changedRestriction = await tokenPost(`${rig.url}/api/orchestrator/ladder`, {
      ladder: { subs: [{ ...FRONTEND, restricted: false }] },
      by: 'orchestrator',
      confirmed: true,
    }, mainToken)
    expect(changedRestriction.status).toBe(403)

    const same = await tokenPost(`${rig.url}/api/orchestrator/ladder`, {
      ladder: { subs: [FRONTEND] },
      by: 'orchestrator',
      confirmed: true,
    }, mainToken)
    expect(same.status).toBe(200)

    const removal = await tokenPost(`${rig.url}/api/orchestrator/ladder`, { ladder: { subs: [] }, by: 'orchestrator', confirmed: true }, mainToken)
    expect(removal.status).toBe(403)
    expect(removal.body.problems[0]).toContain('only the owner can remove it')

    const page = await pagePost(`${rig.url}/api/orchestrator/ladder`, { ladder: { subs: [FRONTEND] }, by: 'orchestrator', confirmed: true })
    expect(page.status).toBe(403)
    expect(page.body).toEqual({ error: 'A page cannot change the ladder as the orchestrator.' })

    const owner = await pagePost(`${rig.url}/api/orchestrator/ladder`, {
      ladder: { subs: [{ ...FRONTEND, scope: ['src/ui/**', 'src/engine/**'] }] },
      by: 'owner',
      confirmed: true,
    })
    expect(owner.status).toBe(200)
    expect((await getJson(`${rig.url}/api/orchestrators`)).body[1].scope).toEqual(['src/ui/**', 'src/engine/**'])
  })

  it('reads the actor from the request, not the body', async () => {
    const rig = await makeBridge(makeBase())
    const mainToken = rig.bridge.orchestrators().token('orchestrator')
    expect((await pagePost(`${rig.url}/api/orchestrator/ladder`, { ladder: { subs: [FRONTEND] }, by: 'owner', confirmed: true })).status).toBe(200)

    const ownerLadder = await tokenPost(`${rig.url}/api/orchestrator/ladder`, {
      ladder: { subs: [{ ...FRONTEND, scope: ['src/engine/**'] }] },
      by: 'owner',
      confirmed: true,
    }, mainToken)
    expect(ownerLadder.status).toBe(403)
    expect(ownerLadder.body).toEqual({ error: 'A request with no Origin cannot change the ladder as the owner.' })
    expect((await getJson(`${rig.url}/api/orchestrators`)).body[1].scope).toEqual(['src/ui/**'])

    const pageLadder = await pagePost(`${rig.url}/api/orchestrator/ladder`, {
      ladder: { subs: [{ ...FRONTEND, scope: ['src/engine/**'] }] },
      by: 'owner',
      confirmed: true,
    })
    expect(pageLadder.status).toBe(200)
    expect((await getJson(`${rig.url}/api/orchestrators`)).body[1].scope).toEqual(['src/engine/**'])

    const pageDefault = await pagePost(`${rig.url}/api/orchestrator/ladder`, {
      ladder: { subs: [{ ...FRONTEND, scope: ['src/engine/**'] }] },
      confirmed: true,
    })
    expect(pageDefault.status).toBe(200)

    const ownerMessage = await tokenPost(`${rig.url}/api/orchestrator/messages`, {
      id: 'frontend',
      text: 'Do the goal',
      from: 'owner',
      confirmed: true,
    }, mainToken)
    expect(ownerMessage.status).toBe(403)
    expect(ownerMessage.body).toEqual({ error: 'A request with no Origin cannot send a message as the owner.' })
    expect(rig.chat('frontend').messages.some((message) => message.from === 'owner')).toBe(false)

    const orchestratorMessage = await tokenPost(`${rig.url}/api/orchestrator/messages`, {
      id: 'frontend',
      text: 'Report back',
      confirmed: true,
    }, mainToken)
    expect(orchestratorMessage.status).toBe(202)
    expect(rig.chat('frontend').messages.some((message) => message.from === 'orchestrator' && message.text === 'Report back')).toBe(true)

    const pageMessage = await pagePost(`${rig.url}/api/orchestrator/messages`, {
      id: 'frontend',
      text: 'Do the goal',
      from: 'owner',
      confirmed: true,
    })
    expect(pageMessage.status).toBe(202)
    expect(rig.chat('frontend').messages.some((message) => message.from === 'owner' && message.text === 'Do the goal')).toBe(true)
  })

  it('sends a message from the main orchestrator to a sub only from a request with no origin', async () => {
    const rig = await makeBridge(makeBase())
    const mainToken = rig.bridge.orchestrators().token('orchestrator')
    await pagePost(`${rig.url}/api/orchestrator/ladder`, { ladder: { subs: [FRONTEND] }, by: 'owner', confirmed: true })

    const page = await pagePost(`${rig.url}/api/orchestrator/messages`, {
      id: 'frontend',
      text: 'Do the goal',
      from: 'orchestrator',
      confirmed: true,
    })
    expect(page.status).toBe(403)
    expect(page.body).toEqual({ error: 'A page cannot send a message as the orchestrator.' })

    const unconfirmed = await tokenPost(`${rig.url}/api/orchestrator/messages`, {
      id: 'frontend',
      text: 'Do the goal',
      from: 'orchestrator',
    }, mainToken)
    expect(unconfirmed.status).toBe(400)

    const toMain = await tokenPost(`${rig.url}/api/orchestrator/messages`, {
      text: 'Do the goal',
      from: 'orchestrator',
      confirmed: true,
    }, mainToken)
    expect(toMain.status).toBe(400)

    const sent = await tokenPost(`${rig.url}/api/orchestrator/messages`, {
      id: 'frontend',
      text: 'Do the goal',
      from: 'orchestrator',
      confirmed: true,
    }, mainToken)
    expect(sent.status).toBe(202)
    expect(rig.chat('frontend').messages.some((message) => message.from === 'orchestrator' && message.text === 'Do the goal')).toBe(true)
  })

  it('requires a valid token or origin for orchestrator stop', async () => {
    const rig = await makeBridge(makeBase())
    const mainToken = rig.bridge.orchestrators().token('orchestrator')

    const noOriginNoToken = await tokenPost(`${rig.url}/api/orchestrator/stop`, { confirmed: true }, '')
    expect(noOriginNoToken.status).toBe(403)
    expect(noOriginNoToken.body.error).toBe(NO_TOKEN_PROBLEM)

    const badToken = await tokenPost(`${rig.url}/api/orchestrator/stop`, { confirmed: true }, 'bad-token')
    expect(badToken.status).toBe(403)
    expect(badToken.body.error).toBe(NO_TOKEN_PROBLEM)

    const validToken = await tokenPost(`${rig.url}/api/orchestrator/stop`, { confirmed: true }, mainToken)
    expect(validToken.status).toBe(200)
    expect(validToken.body).toEqual({ ok: true })

    const pageCall = await pagePost(`${rig.url}/api/orchestrator/stop`, { confirmed: true })
    expect(pageCall.status).toBe(200)
    expect(pageCall.body).toEqual({ ok: true })
  })

  it('sends one order frame for a main message to a sub and one report frame for its reply', async () => {
    const files = makeBase({ ladder: { subs: [FRONTEND] } })
    writeFileSync(
      chatFileFor(files.projectRoot, files.runs, 'frontend'),
      `${JSON.stringify({ project: files.projectRoot, sessionId: 'sub-session', state: 'idle', messages: [] })}\n`
    )
    const rig = await makeBridge(files)
    const mainToken = rig.bridge.orchestrators().token('orchestrator')
    const sent = await tokenPost(`${rig.url}/api/orchestrator/messages`, {
      id: 'frontend',
      text: 'Do the goal',
      from: 'orchestrator',
      confirmed: true,
    }, mainToken)
    expect(sent.status).toBe(202)
    await waitFor(
      async () => (await getJson(`${rig.url}/api/orchestrator`)).body.messages.some((message) => message.from === 'sub:frontend'),
      15000,
      'the sub report'
    )

    const frames = (
      await readFrames(
        rig.url,
        (list) => list.some((frame) => frame.payload?.kind === 'order') && list.some((frame) => frame.payload?.kind === 'report')
      )
    ).filter((frame) => frame.type === 'orchestrator.message')
    const orders = frames.filter((frame) => frame.payload.kind === 'order')
    const reports = frames.filter((frame) => frame.payload.kind === 'report')
    expect(orders).toHaveLength(1)
    expect(reports).toHaveLength(1)
    expect(orders[0].payload).toEqual({ from: 'orchestrator', to: 'sub-frontend', kind: 'order', ts: expect.any(String) })
    expect(reports[0].payload).toEqual({ from: 'sub-frontend', to: 'orchestrator', kind: 'report', ts: expect.any(String) })
    for (const frame of frames) {
      expect(frame.companyId).toBe('company-orchestrator')
      expect(Number.isFinite(Date.parse(frame.createdAt))).toBe(true)
    }
  })
})

describe('starting lanes from a sub orchestrator', () => {
  it('refuses a lane outside the sector and passes --started-by for one inside it', async () => {
    const files = makeBase()
    const runner = join(files.base, 'runner.mjs')
    writeFileSync(runner, RUNNER)
    const runnerCalls = join(files.base, 'runner-calls.jsonl')
    const rig = await makeBridge(files, { runnerCommand: { file: process.execPath, args: [runner, runnerCalls] } })
    await pagePost(`${rig.url}/api/orchestrator/ladder`, { ladder: { subs: [FRONTEND] }, by: 'owner', confirmed: true })
    const mainToken = rig.bridge.orchestrators().token('orchestrator')
    const subToken = rig.bridge.orchestrators().token('frontend')

    const outside = await tokenPost(`${rig.url}/api/control/runs`, {
      lane: 'opencode2',
      task: 'Fix it.',
      confirmed: true,
    }, subToken)
    expect(outside.status).toBe(403)
    expect(outside.body.error).toContain('Frontend')
    expect(outside.body.error).toContain('opencode2')

    const mismatch = await tokenPost(`${rig.url}/api/control/runs`, {
      lane: 'opencode',
      task: 'Fix it.',
      startedBy: 'missing',
      confirmed: true,
    }, subToken)
    expect(mismatch.status).toBe(403)
    expect(mismatch.body).toEqual({ error: 'The startedBy orchestrator must match the token.' })

    const subNamingMain = await tokenPost(`${rig.url}/api/control/runs`, {
      lane: 'opencode',
      task: 'Fix it.',
      startedBy: 'orchestrator',
      confirmed: true,
    }, subToken)
    expect(subNamingMain.status).toBe(403)
    expect(subNamingMain.body).toEqual({ error: 'The startedBy orchestrator must match the token.' })

    const noToken = await postJson(`${rig.url}/api/control/runs`, {
      lane: 'opencode',
      task: 'Fix it.',
      confirmed: true,
    })
    expect(noToken.status).toBe(403)
    expect(noToken.body).toEqual({ error: 'A request with no Origin needs a valid orchestrator token.' })

    const wrongToken = await tokenPost(`${rig.url}/api/control/runs`, {
      lane: 'opencode',
      task: 'Fix it.',
      confirmed: true,
    }, 'wrong-token')
    expect(wrongToken.status).toBe(403)
    expect(wrongToken.body).toEqual({ error: 'A request with no Origin needs a valid orchestrator token.' })

    const inside = await tokenPost(`${rig.url}/api/control/runs`, {
      lane: 'opencode',
      task: 'Fix it.',
      confirmed: true,
    }, subToken)
    expect(inside.status).toBe(202)
    await waitFor(() => readLines(runnerCalls).length === 1)
    expect(readLines(runnerCalls)[0].slice(-2)).toEqual(['--started-by', 'frontend'])

    const main = await tokenPost(`${rig.url}/api/control/runs`, { lane: 'opencode2', task: 'Fix it.', confirmed: true }, mainToken)
    expect(main.status).toBe(202)
    await waitFor(() => readLines(runnerCalls).length === 2)
    expect(readLines(runnerCalls)[1].slice(-2)).toEqual(['--started-by', 'orchestrator'])
  })

  it('sends one dispatch frame from the starter to the lane it starts', async () => {
    const files = makeBase()
    const runner = join(files.base, 'runner.mjs')
    writeFileSync(runner, RUNNER)
    const runnerCalls = join(files.base, 'runner-calls.jsonl')
    const rig = await makeBridge(files, { runnerCommand: { file: process.execPath, args: [runner, runnerCalls] } })
    await pagePost(`${rig.url}/api/orchestrator/ladder`, { ladder: { subs: [FRONTEND] }, by: 'owner', confirmed: true })

    const inside = await pagePost(`${rig.url}/api/control/runs`, {
      lane: 'opencode',
      task: 'Fix it.',
      startedBy: 'frontend',
      confirmed: true,
    })
    expect(inside.status).toBe(202)

    const frames = (
      await readFrames(rig.url, (list) => list.some((frame) => frame.payload?.kind === 'dispatch'))
    ).filter((frame) => frame.type === 'orchestrator.message' && frame.payload.kind === 'dispatch')
    expect(frames).toHaveLength(1)
    expect(frames[0].payload).toEqual({ from: 'sub-frontend', to: 'opencode', kind: 'dispatch', ts: expect.any(String) })
    await waitFor(() => readLines(runnerCalls).length === 1)
  })

  it('sends one wake frame from the lane to the orchestrator it wakes', async () => {
    const seen = []
    const rig = makeRig(makeBase({ ladder: { subs: [FRONTEND] } }), { onMessage: (message) => seen.push(message) })
    rig.registry.main.send({ text: 'Hello', confirmed: true })
    await waitIdle(rig.registry, 'orchestrator', 1)
    rig.registry.find('frontend').send({ text: 'Do the work', confirmed: true })
    await waitIdle(rig.registry, 'frontend', 1)
    await waitIdle(rig.registry, 'orchestrator', 2)
    seen.length = 0

    appendRecord(rig, { logName: 'opencode-K9-20261025-150000', startedBy: 'frontend' })
    rig.registry.onFrame(frame('opencode-K9-20261025-150000'))
    await waitFor(() => messagesOf(rig.registry, 'frontend').some((message) => message.from === 'room' && message.text.includes('opencode-K9-20261025-150000')))
    expect(seen.filter((message) => message.kind === 'wake')).toEqual([{ from: 'opencode', to: 'sub-frontend', kind: 'wake' }])

    appendRecord(rig, { logName: 'opencode-K9-20261025-150500' })
    rig.registry.onFrame(frame('opencode-K9-20261025-150500'))
    await waitFor(() =>
      messagesOf(rig.registry, 'orchestrator').some((message) => message.from === 'room' && message.text.includes('opencode-K9-20261025-150500'))
    )
    expect(seen.filter((message) => message.kind === 'wake')).toEqual([
      { from: 'opencode', to: 'sub-frontend', kind: 'wake' },
      { from: 'opencode', to: 'orchestrator', kind: 'wake' },
    ])
  })

  it('refuses no-Origin requests without valid tokens and lets pages start runs', async () => {
    const files = makeBase()
    const runner = join(files.base, 'runner.mjs')
    writeFileSync(runner, RUNNER)
    const runnerCalls = join(files.base, 'runner-calls.jsonl')
    const rig = await makeBridge(files, { runnerCommand: { file: process.execPath, args: [runner, runnerCalls] } })
    await pagePost(`${rig.url}/api/orchestrator/ladder`, { ladder: { subs: [FRONTEND] }, by: 'owner', confirmed: true })
    const mainToken = rig.bridge.orchestrators().token('orchestrator')
    const subToken = rig.bridge.orchestrators().token('frontend')

    const claimedNoToken = await postJson(`${rig.url}/api/control/runs`, {
      lane: 'opencode',
      task: 'Fix it.',
      startedBy: 'orchestrator',
      confirmed: true,
    })
    expect(claimedNoToken.status).toBe(403)
    expect(claimedNoToken.body).toEqual({ error: 'A request with no Origin needs a valid orchestrator token.' })
    expect(readLines(runnerCalls)).toHaveLength(0)

    const subLadder = await tokenPost(`${rig.url}/api/orchestrator/ladder`, {
      ladder: { subs: [FRONTEND] },
      by: 'orchestrator',
      confirmed: true,
    }, subToken)
    expect(subLadder.status).toBe(403)
    expect(subLadder.body).toEqual({ error: "A ladder change needs the main orchestrator's token." })

    const noTokenLadder = await postJson(`${rig.url}/api/orchestrator/ladder`, {
      ladder: { subs: [FRONTEND] },
      by: 'orchestrator',
      confirmed: true,
    })
    expect(noTokenLadder.status).toBe(403)
    expect(noTokenLadder.body).toEqual({ error: 'A request with no Origin needs a valid orchestrator token.' })

    const wrongTokenLadder = await tokenPost(`${rig.url}/api/orchestrator/ladder`, {
      ladder: { subs: [FRONTEND] },
      by: 'orchestrator',
      confirmed: true,
    }, 'wrong-token')
    expect(wrongTokenLadder.status).toBe(403)
    expect(wrongTokenLadder.body).toEqual({ error: 'A request with no Origin needs a valid orchestrator token.' })

    const subMessage = await tokenPost(`${rig.url}/api/orchestrator/messages`, {
      id: 'frontend',
      text: 'Do the goal',
      from: 'orchestrator',
      confirmed: true,
    }, subToken)
    expect(subMessage.status).toBe(403)
    expect(subMessage.body).toEqual({ error: "A message to a sub needs the main orchestrator's token." })

    const noTokenMessage = await postJson(`${rig.url}/api/orchestrator/messages`, {
      id: 'frontend',
      text: 'Do the goal',
      from: 'orchestrator',
      confirmed: true,
    })
    expect(noTokenMessage.status).toBe(403)
    expect(noTokenMessage.body).toEqual({ error: 'A request with no Origin needs a valid orchestrator token.' })

    const page = await pagePost(`${rig.url}/api/control/runs`, {
      lane: 'opencode',
      task: 'Fix it.',
      startedBy: 'orchestrator',
      confirmed: true,
    })
    expect(page.status).toBe(202)
    await waitFor(() => readLines(runnerCalls).length === 1)
    expect(readLines(runnerCalls)[0].slice(-2)).toEqual(['--started-by', 'orchestrator'])

    const unknownPage = await pagePost(`${rig.url}/api/control/runs`, {
      lane: 'opencode',
      task: 'Fix it.',
      startedBy: 'missing',
      confirmed: true,
    })
    expect(unknownPage.status).toBe(400)
    expect(unknownPage.body).toEqual({ error: 'There is no orchestrator with that id.' })
  })

  it('makes new tokens when the bridge restarts', async () => {
    const files = makeBase()
    const first = await makeBridge(files)
    const firstToken = first.bridge.orchestrators().token('orchestrator')
    expect(firstToken).toBeTruthy()
    await first.bridge.stop()
    const second = await makeBridge(files)
    const secondToken = second.bridge.orchestrators().token('orchestrator')
    expect(secondToken).toBeTruthy()
    expect(secondToken).not.toBe(firstToken)
  })

  it('parses --started-by and writes it into the run record', () => {
    expect(parseRunArgs(['opencode', 'K1', '--started-by', 'frontend'])).toMatchObject({ startedBy: 'frontend' })
    expect(parseRunArgs(['opencode', 'K1', '--started-by=orchestrator'])).toMatchObject({ startedBy: 'orchestrator' })
    expect(() => parseRunArgs(['opencode', 'K1', '--started-by', 'Front End'])).toThrow('--started-by needs an orchestrator id.')
    expect(parseRunArgs(['opencode', 'K1']).startedBy).toBeUndefined()
    expect(runRecord({ lane: 'opencode', startedBy: 'frontend' }).startedBy).toBe('frontend')
    expect(Object.hasOwn(runRecord({ lane: 'opencode' }), 'startedBy')).toBe(false)
  })

  it('wakes only the starter when a lane run ends', async () => {
    const rig = makeRig(makeBase({ ladder: { subs: [FRONTEND] } }))
    rig.registry.main.send({ text: 'Hello', confirmed: true })
    await waitIdle(rig.registry, 'orchestrator', 1)
    rig.registry.find('frontend').send({ text: 'Do the work', confirmed: true })
    await waitIdle(rig.registry, 'frontend', 1)
    await waitIdle(rig.registry, 'orchestrator', 2)

    appendRecord(rig, { logName: 'opencode-K1-20261025-120000', startedBy: 'frontend' })
    rig.registry.onFrame(frame('opencode-K1-20261025-120000'))
    await waitFor(() => messagesOf(rig.registry, 'frontend').some((message) => message.from === 'room' && message.text.includes('Run opencode-K1-20261025-120000')))
    await waitIdle(rig.registry, 'frontend', 2)
    expect(messagesOf(rig.registry, 'orchestrator').filter((message) => message.from === 'room')).toHaveLength(0)
    await waitFor(() => messagesOf(rig.registry, 'orchestrator').some((message) => message.from === 'sub:frontend'))

    appendRecord(rig, { logName: 'opencode-K1-20261025-120500' })
    rig.registry.onFrame(frame('opencode-K1-20261025-120500'))
    await waitFor(() =>
      messagesOf(rig.registry, 'orchestrator').some((message) => message.from === 'room' && message.text.includes('Run opencode-K1-20261025-120500'))
    )
    expect(messagesOf(rig.registry, 'frontend').filter((message) => message.from === 'room')).toHaveLength(1)
  })

  it('wakes the main orchestrator when startedBy names a sub that no longer exists', async () => {
    const rig = makeRig(makeBase({ ladder: { subs: [FRONTEND] } }))
    rig.registry.main.send({ text: 'Hello', confirmed: true })
    await waitIdle(rig.registry, 'orchestrator', 1)

    const removed = rig.registry.ladderChange({ ladder: { subs: [] }, by: 'owner', confirmed: true }, true)
    expect(removed.status).toBe(200)

    appendRecord(rig, { logName: 'opencode-K1-20261030-140000', startedBy: 'frontend' })
    rig.registry.onFrame(frame('opencode-K1-20261030-140000'))
    await waitFor(() =>
      messagesOf(rig.registry, 'orchestrator').some((message) => message.from === 'room' && message.text.includes('Run opencode-K1-20261030-140000'))
    )
    await waitIdle(rig.registry, 'orchestrator', 2)
  })

  it('warns a restricted sub and the main about files outside the scope', async () => {
    const files = makeBase({ ladder: { subs: [FRONTEND] }, branch: 'trunk' })
    const worktree = makeWorktree(files.projectRoot, files.base)
    const rig = makeRig(files)
    rig.registry.main.send({ text: 'Hello', confirmed: true })
    await waitIdle(rig.registry, 'orchestrator', 1)
    rig.registry.find('frontend').send({ text: 'Do the work', confirmed: true })
    await waitIdle(rig.registry, 'frontend', 1)
    await waitIdle(rig.registry, 'orchestrator', 2)

    appendRecord(rig, { logName: 'opencode-K2-20261025-130000', startedBy: 'frontend', project: worktree })
    rig.registry.onFrame(frame('opencode-K2-20261025-130000'))
    const warning = await waitFor(() => messagesOf(rig.registry, 'frontend').find((message) => message.from === 'room' && message.text.startsWith('Outside the scope, do not merge:')))
    expect(warning.text).toContain('- server/x.js')
    if (process.platform === 'win32') expect(warning.text).not.toContain('Src/ui/a.jsx')
    else expect(warning.text).toContain('- Src/ui/a.jsx')
    expect(warning.text).toContain('Run opencode-K2-20261025-130000 on lane opencode ended: succeeded.')
    await waitFor(() => messagesOf(rig.registry, 'orchestrator').some((message) => message.from === 'room' && message.text === warning.text))

    const prompt = await waitFor(() => rig.calls().map((call) => call.args[call.args.indexOf('-p') + 1]).find((text) => typeof text === 'string' && text.includes('Outside the scope')))
    expect(prompt.startsWith('Room: Outside the scope, do not merge:')).toBe(true)
  })

  it('tells the parent when the scope could not be read', async () => {
    const files = makeBase({ ladder: { subs: [FRONTEND] } })
    const rig = makeRig(files)
    rig.registry.main.send({ text: 'Hello', confirmed: true })
    await waitIdle(rig.registry, 'orchestrator', 1)
    rig.registry.find('frontend').send({ text: 'Do the work', confirmed: true })
    await waitIdle(rig.registry, 'frontend', 1)
    await waitIdle(rig.registry, 'orchestrator', 2)

    appendRecord(rig, { logName: 'opencode-K2-20261025-140000', startedBy: 'frontend', project: rig.projectRoot })
    rig.registry.onFrame(frame('opencode-K2-20261025-140000'))
    await waitFor(() => messagesOf(rig.registry, 'orchestrator').some((message) => message.from === 'room' && message.text === SCOPE_UNREAD_PROBLEM))
  })
})

describe('a run the main starts on a sub lane', () => {
  const BACKEND = {
    id: 'backend',
    name: 'Backend',
    harness: 'claude',
    model: 'sonnet',
    lanes: ['opencode2'],
    scope: ['server/**'],
    restricted: true,
    setBy: 'owner',
  }

  async function laneRig() {
    const files = makeBase({ ladder: { subs: [FRONTEND, BACKEND] } })
    const runner = join(files.base, 'runner.mjs')
    writeFileSync(runner, RUNNER)
    const runnerCalls = join(files.base, 'runner-calls.jsonl')
    const rig = await makeBridge(files, { runnerCommand: { file: process.execPath, args: [runner, runnerCalls] } })
    return { ...rig, runnerCalls }
  }

  it('records the sub the main names and the sub that holds the lane', async () => {
    const rig = await laneRig()
    const mainToken = rig.bridge.orchestrators().token('orchestrator')

    const named = await tokenPost(`${rig.url}/api/control/runs`, {
      lane: 'opencode',
      task: 'Fix it.',
      startedBy: 'frontend',
      confirmed: true,
    }, mainToken)
    expect(named.status).toBe(202)
    await waitFor(() => readLines(rig.runnerCalls).length === 1)
    expect(readLines(rig.runnerCalls)[0].slice(-2)).toEqual(['--started-by', 'frontend'])

    const unnamed = await tokenPost(`${rig.url}/api/control/runs`, {
      lane: 'opencode2',
      task: 'Fix it.',
      confirmed: true,
    }, mainToken)
    expect(unnamed.status).toBe(202)
    await waitFor(() => readLines(rig.runnerCalls).length === 2)
    expect(readLines(rig.runnerCalls)[1].slice(-2)).toEqual(['--started-by', 'backend'])

    const pageRun = await fetch(`${rig.url}/api/control/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: rig.url },
      body: JSON.stringify({
        lane: 'opencode',
        task: 'Fix it.',
        confirmed: true,
      }),
    })
    expect(pageRun.status).toBe(202)
    await waitFor(() => readLines(rig.runnerCalls).length === 3)
    expect(readLines(rig.runnerCalls)[2].slice(-2)).toEqual(['--started-by', 'frontend'])
  })

  it('refuses a no-Origin request whose token names an orchestrator with no sector', async () => {
    const rig = await laneRig()
    const subToken = rig.bridge.orchestrators().token('frontend')
    const origSector = rig.bridge.orchestrators().sector
    rig.bridge.orchestrators().sector = (id) => (id === 'frontend' ? null : origSector(id))

    const res = await tokenPost(`${rig.url}/api/control/runs`, {
      lane: 'opencode',
      task: 'Fix it.',
      confirmed: true,
    }, subToken)
    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'The frontend sector does not hold the lane opencode.' })
    expect(readLines(rig.runnerCalls)).toHaveLength(0)
  })

  it('credits a run the page starts with no startedBy to the sub whose sector holds the lane', async () => {
    const rig = await laneRig()
    const res = await pagePost(`${rig.url}/api/control/runs`, { lane: 'opencode', task: 'Fix it.', confirmed: true })
    expect(res.status).toBe(202)
    await waitFor(() => readLines(rig.runnerCalls).length === 1)
    expect(readLines(rig.runnerCalls)[0].slice(-2)).toEqual(['--started-by', 'frontend'])
  })

  it('refuses a sub that does not hold the lane and a sub that names another id', async () => {
    const rig = await laneRig()
    const mainToken = rig.bridge.orchestrators().token('orchestrator')
    const subToken = rig.bridge.orchestrators().token('frontend')

    const outside = await tokenPost(`${rig.url}/api/control/runs`, {
      lane: 'opencode2',
      task: 'Fix it.',
      startedBy: 'frontend',
      confirmed: true,
    }, mainToken)
    expect(outside.status).toBe(403)
    expect(outside.body).toEqual({ error: 'The Frontend sector does not hold the lane opencode2.' })
    expect(readLines(rig.runnerCalls)).toHaveLength(0)

    const sibling = await tokenPost(`${rig.url}/api/control/runs`, {
      lane: 'opencode',
      task: 'Fix it.',
      startedBy: 'backend',
      confirmed: true,
    }, subToken)
    expect(sibling.status).toBe(403)
    expect(sibling.body).toEqual({ error: 'The startedBy orchestrator must match the token.' })

    const main = await tokenPost(`${rig.url}/api/control/runs`, {
      lane: 'opencode',
      task: 'Fix it.',
      startedBy: 'orchestrator',
      confirmed: true,
    }, subToken)
    expect(main.status).toBe(403)
    expect(main.body).toEqual({ error: 'The startedBy orchestrator must match the token.' })
    expect(readLines(rig.runnerCalls)).toHaveLength(0)
  })
})

describe('a sub orchestrator report', () => {
  it('lands in the parent chat as sub:<id> and wakes the parent', async () => {
    const rig = makeRig(makeBase({ ladder: { subs: [FRONTEND] } }))
    rig.registry.main.send({ text: 'Hello', confirmed: true })
    await waitIdle(rig.registry, 'orchestrator', 1)
    rig.registry.find('frontend').send({ text: 'Write the header', confirmed: true })
    await waitIdle(rig.registry, 'frontend', 1)
    await waitIdle(rig.registry, 'orchestrator', 2)

    const report = messagesOf(rig.registry, 'orchestrator').find((message) => message.from === 'sub:frontend')
    expect(report).toBeTruthy()
    expect(report.text).toContain('Reply:')
    expect(report.text).toContain('Write the header')
    const prompt = rig.calls()[rig.calls().length - 1].args[1]
    expect(prompt.startsWith('Sub frontend:')).toBe(true)
  })

  it('masks a key in a sub reply before it is stored or sent to the parent', async () => {
    const files = makeBase({ ladder: { subs: [FRONTEND] } })
    files.behaviour.mode = 'key'
    const rig = makeRig(files)
    const secret = 'sk-or-v1-' + 'q'.repeat(24)
    rig.registry.main.send({ text: 'Hello', confirmed: true })
    await waitIdle(rig.registry, 'orchestrator', 1)
    rig.registry.find('frontend').send({ text: 'Read the file', confirmed: true })
    await waitIdle(rig.registry, 'frontend', 1)
    await waitIdle(rig.registry, 'orchestrator', 2)

    const subReply = messagesOf(rig.registry, 'frontend').find((message) => message.from === 'orchestrator')
    expect(subReply.text).toContain('[key]')
    expect(subReply.text).not.toContain(secret)
    const report = messagesOf(rig.registry, 'orchestrator').find((message) => message.from === 'sub:frontend')
    expect(report.text).toContain('[key]')
    expect(report.text).not.toContain(secret)
    expect(rig.chat('frontend').messages.some((message) => message.text.includes(secret))).toBe(false)
    expect(rig.chat('orchestrator').messages.some((message) => message.text.includes(secret))).toBe(false)
  })

  it('posts nothing to the parent and starts no parent turn when a sub replies NO_REPORT', async () => {
    const files = makeBase({ ladder: { subs: [FRONTEND] } })
    files.behaviour.mode = 'no_report'
    const rig = makeRig(files)
    rig.registry.main.send({ text: 'Hello', confirmed: true })
    await waitIdle(rig.registry, 'orchestrator', 1)
    rig.registry.find('frontend').send({ text: 'Check the lanes', confirmed: true })
    await waitIdle(rig.registry, 'frontend', 1)

    const subReply = messagesOf(rig.registry, 'frontend').find((message) => message.from === 'orchestrator')
    expect(subReply).toBeTruthy()
    expect(subReply.text).toBe(NO_NEW_REPORT)
    expect(rig.chat('frontend').messages.some((message) => message.from === 'orchestrator' && message.text === NO_NEW_REPORT)).toBe(true)

    const report = messagesOf(rig.registry, 'orchestrator').find((message) => message.from === 'sub:frontend')
    expect(report).toBeUndefined()
    expect(rig.chat('orchestrator').messages.filter((message) => message.from === 'orchestrator')).toHaveLength(1)
  })
})

describe('sub orchestrator agents', () => {
  it('lists each sub as an agent and reads its chat log as that agent', async () => {
    const rig = await makeBridge(makeBase({ ladder: { subs: [{ ...FRONTEND, harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' }] } }))
    const agents = (await getJson(`${rig.url}/api/agents`)).body
    expect(agents.find((agent) => agent.key === 'sub-frontend')).toMatchObject({
      id: 'agent-sub-frontend',
      name: 'Frontend',
      parser: 'opencode',
      subOrchestrator: true,
    })

    const frames = []
    const source = createLanesSource({
      folder: rig.runs,
      projectRoot: rig.projectRoot,
      repoRoot: rig.projectRoot,
      lanes: LANES,
      subOrchestrators: () => [{ id: 'frontend', name: 'Frontend', harness: 'opencode' }],
      pollMs: 20,
      quietMs: 60000,
      onFrame: (item) => frames.push(item),
    })
    cleanups.push(() => source.stop())
    expect(source.agents.find((agent) => agent.key === 'sub-frontend')).toMatchObject({ parser: 'opencode', subOrchestrator: true })
    source.start()
    writeFileSync(
      join(rig.runs, 'sub-frontend-chat-20261025-120000-000.log'),
      `${JSON.stringify({
        type: 'tool_use',
        timestamp: 2,
        sessionID: 'ses_sub',
        part: { id: 'prt_1', type: 'tool', tool: 'read', state: { status: 'completed', input: { filePath: 'src/math.js' } } },
      })}\n`
    )
    const line = await waitFor(
      () => frames.find((item) => item.type === 'heartbeat.run.log' && item.payload.agentId === 'agent-sub-frontend'),
      15000,
      'the sub chat log line'
    )
    expect(line.payload.chunk).toContain('tool_use')
  })
})

describe('availableHarnesses with a Direct API endpoint', () => {
  it('lists the endpoint models for the Direct API and not the built-in ones', () => {
    const list = availableHarnesses({}, {}, process.platform, [{ name: 'OpenRouter', models: ['a/one', 'b/two'] }])
    const direct = list.find((entry) => entry.key === 'machineroom')
    expect(direct.models).toEqual([
      { id: 'OpenRouter/a/one', label: 'OpenRouter/a/one' },
      { id: 'OpenRouter/b/two', label: 'OpenRouter/b/two' },
    ])
  })
})
