import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBridge } from '../server/index.js'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { chatFileFor } from '../server/orchestrator.js'
import { LANE_BACKUP_PROBLEM, LANE_LIMIT_PROBLEM, LANE_TAKEOVER_PROBLEM } from '../server/orchestrators.js'
import { buildPrompt } from '../src/briefs/briefs.js'
import { unattendedPrompt } from '../src/briefs/run.js'
import { gitPath } from '../server/programPath.js'
import { startLane } from '../scripts/run-lane.mjs'
import { getJson } from './helpers/bridge.js'
import { makeTempDir } from './helpers/tempRoot.js'

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const RECORDINGS = join(REPO_ROOT, 'public', 'recordings')
const PROMPT = 'project={{PROJECT}}\nmachineroom={{MACHINEROOM}}\nruns={{RUNS}}\nbridge={{BRIDGE}}'
const BRIEF = { id: 'P439X', title: 'A failover identity', text: 'Do it.\n\nFiles: note.txt\n' }
const PRIMARY = 'opencode'
const BACKUP = 'agy'
const TICKET_VALUE = '4b3a29180706f5e4d3c2b1a09f8e7d6c'
const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'MachineRoom Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'MachineRoom Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
}
const LANES = {
  orchestrator: { name: 'Orchestrator', harness: 'Claude Code', cli: { harness: 'claude', bin: 'claude', model: 'opus' } },
  opencode: { name: 'Primary lane', harness: 'OpenCode', fallback: BACKUP, cli: { harness: 'opencode', bin: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' } },
  agy: { name: 'Backup lane', harness: 'AGY', cli: { harness: 'opencode', bin: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' } },
  claude: { name: 'Other lane', harness: 'Claude Code', cli: { harness: 'claude', bin: 'claude', model: 'opus' } },
}

const LANE_RUNNER = [
  "import { appendFileSync, existsSync } from 'node:fs'",
  'const args = process.argv.slice(2)',
  "const calls = String(args[0] ?? '')",
  "const release = String(args[1] ?? '')",
  "appendFileSync(calls, JSON.stringify({ args: args.slice(2), ticket: process.env.MACHINEROOM_LANE_TICKET ?? '' }) + '\\n')",
  "while (release && !existsSync(release)) await new Promise((done) => setTimeout(done, 20))",
].join('\n')

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms))
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

function makeBase({ ladder = null } = {}) {
  const base = makeTempDir('mr-failover-inbox-')
  const runs = join(base, 'runs')
  const projectRoot = join(base, 'project')
  mkdirSync(runs, { recursive: true })
  mkdirSync(projectRoot, { recursive: true })
  const promptFile = join(base, 'orchestrator-agent.md')
  writeFileSync(promptFile, PROMPT)
  const runner = join(base, 'lane-runner.mjs')
  const calls = join(base, 'lane-runner.jsonl')
  const release = join(base, 'lane-release')
  writeFileSync(runner, LANE_RUNNER)
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
    promptFile,
    calls,
    release,
    runnerCommand: { file: process.execPath, args: [runner, calls, release] },
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

async function makeBridge(files) {
  writeActiveLanes(activeLanesFileFor(files.projectRoot, files.runs), Object.keys(LANES).filter((key) => key !== 'orchestrator'))
  const bridge = createBridge({
    projectRoot: files.projectRoot,
    port: 0,
    env: {},
    briefsDir: join(REPO_ROOT, 'docs', 'agents'),
    lanesFile: join(REPO_ROOT, 'docs', 'agents', 'lanes.json'),
    orchestratorPrompt: files.promptFile,
    lanesSource: { folder: files.runs, lanes: LANES, pollMs: 20, quietMs: 60000 },
    runnerCommand: files.runnerCommand,
  })
  cleanups.push(() => bridge.stop())
  const { url } = await bridge.start()
  return { ...files, bridge, url, token: (id) => bridge.orchestrators().token(id) }
}

function pagePost(url, path, body) {
  return getJson(url + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
    body: JSON.stringify(body),
  })
}

function tokenPost(url, path, body, token) {
  return getJson(url + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-MachineRoom-Orchestrator': token },
    body: JSON.stringify(body),
  })
}

function lanePost(url, path, ticket, body) {
  return getJson(url + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-MachineRoom-Lane': ticket },
    body: JSON.stringify(body),
  })
}

function laneGet(url, ticket) {
  return getJson(`${url}/api/orchestrator/messages`, { headers: { 'X-MachineRoom-Lane': ticket } })
}

function claimBackup(url, ticket, lane, startedAt) {
  return getJson(`${url}/api/orchestrator/failover`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-MachineRoom-Lane': ticket },
    body: JSON.stringify({ lane, startedAt }),
  })
}

async function startRun(rig, lane) {
  const started = await pagePost(rig.url, '/api/control/runs', { lane, task: 'Fix the typo.', confirmed: true })
  expect(started.status).toBe(202)
  const call = await waitFor(() => readLines(rig.calls).find((entry) => entry.args[0] === lane), 15000, `the ${lane} runner`)
  return call.ticket
}

async function releaseRun(rig) {
  writeFileSync(rig.release, 'go\n')
  await waitFor(
    async () => (await getJson(`${rig.url}/api/control/runs`)).body.running.length === 0,
    15000,
    'the run to end'
  )
}

describe('a failover backup in the bridge', () => {
  it('delivers only messages for the backup start after takeover', async () => {
    const rig = await makeBridge(makeBase())
    const ticket = await startRun(rig, PRIMARY)
    const primaryStart = (await getJson(`${rig.url}/api/control/runs`)).body.running.find((run) => run.lane === PRIMARY).startedAt
    const backupStart = new Date(Date.parse(primaryStart) + 1000).toISOString()
    expect((await claimBackup(rig.url, ticket, BACKUP, backupStart)).status).toBe(200)
    const send = (startedAt) => pagePost(rig.url, '/api/orchestrator/messages', { to: `lane:${BACKUP}`, text: 'For this run.', startedAt })
    expect((await send(primaryStart)).status).toBe(409)
    expect((await send(backupStart)).status).toBe(202)
    expect((await laneGet(rig.url, ticket)).body.messages.map((message) => message.text)).toEqual(['For this run.'])
    await releaseRun(rig)
  })

  it('sends its messages as lane:BACKUP', async () => {
    const rig = await makeBridge(makeBase())
    const ticket = await startRun(rig, PRIMARY)

    const claimed = await claimBackup(rig.url, ticket, BACKUP)
    expect(claimed.status).toBe(200)
    expect(claimed.body).toEqual({ lane: BACKUP, from: PRIMARY })

    const sent = await lanePost(rig.url, '/api/orchestrator/messages', ticket, { text: 'The header is ready.' })
    expect(sent.status).toBe(202)

    const messages = await waitFor(
      () => {
        const chat = rig.chat('orchestrator')
        return Array.isArray(chat?.messages) && chat.messages.length > 0 ? chat.messages : null
      },
      15000,
      'the coordinator to receive the backup message'
    )
    expect(messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ from: `lane:${BACKUP}`, text: 'The header is ready.' })])
    )
    expect(messages.some((message) => message.from === `lane:${PRIMARY}`)).toBe(false)
    await releaseRun(rig)
  })

  it('keeps a reply sent to the primary before the failover in the backup inbox', async () => {
    const rig = await makeBridge(makeBase())
    const ticket = await startRun(rig, PRIMARY)

    const before = await tokenPost(
      rig.url,
      '/api/orchestrator/messages',
      { to: `lane:${PRIMARY}`, text: 'Read this before you go.' },
      rig.token('orchestrator')
    )
    expect(before.status).toBe(202)

    expect((await claimBackup(rig.url, ticket, BACKUP)).status).toBe(200)

    const read = await laneGet(rig.url, ticket)
    expect(read.status).toBe(200)
    expect(read.body.messages).toEqual([
      { id: expect.any(String), from: 'orchestrator', text: 'Read this before you go.', at: expect.any(String) },
    ])
    await releaseRun(rig)
  })

  it('takes a reply sent to either lane name after the failover', async () => {
    const rig = await makeBridge(makeBase())
    const ticket = await startRun(rig, PRIMARY)
    expect((await claimBackup(rig.url, ticket, BACKUP)).status).toBe(200)

    const toPrimary = await tokenPost(
      rig.url,
      '/api/orchestrator/messages',
      { to: `lane:${PRIMARY}`, text: 'Still for the primary.' },
      rig.token('orchestrator')
    )
    expect(toPrimary.status).toBe(202)
    const toBackup = await tokenPost(
      rig.url,
      '/api/orchestrator/messages',
      { to: `lane:${BACKUP}`, text: 'Now for the backup.' },
      rig.token('orchestrator')
    )
    expect(toBackup.status).toBe(202)

    const read = await laneGet(rig.url, ticket)
    expect(read.body.messages.map((message) => message.text)).toEqual(['Still for the primary.', 'Now for the backup.'])
    await releaseRun(rig)
  })

  it('counts the primary sends toward the backup four', async () => {
    const rig = await makeBridge(makeBase())
    const ticket = await startRun(rig, PRIMARY)

    for (let index = 1; index <= 3; index += 1) {
      const sent = await lanePost(rig.url, '/api/orchestrator/messages', ticket, { text: `Before ${index}` })
      expect(sent.status, String(index)).toBe(202)
    }

    expect((await claimBackup(rig.url, ticket, BACKUP)).status).toBe(200)
    const after = await lanePost(rig.url, '/api/orchestrator/messages', ticket, { text: 'After the failover' })
    expect(after.status).toBe(202)
    const fifth = await lanePost(rig.url, '/api/orchestrator/messages', ticket, { text: 'One too many' })
    expect(fifth.status).toBe(429)
    expect(fifth.body).toEqual({ error: LANE_LIMIT_PROBLEM })
    await releaseRun(rig)
  })

  it('refuses a page and a lane not in lanes.json at the takeover', async () => {
    const rig = await makeBridge(makeBase())
    const ticket = await startRun(rig, PRIMARY)

    const page = await pagePost(rig.url, '/api/orchestrator/failover', { lane: BACKUP })
    expect(page.status).toBe(403)

    const unknown = await claimBackup(rig.url, ticket, 'not-a-lane')
    expect(unknown.status).toBe(400)
    expect(unknown.body).toEqual({ error: LANE_BACKUP_PROBLEM })
    await releaseRun(rig)
  })

  it("refuses a lane that is not its fallback and still reaches that lane's own run", async () => {
    const rig = await makeBridge(makeBase())
    const ticket = await startRun(rig, PRIMARY)
    const otherTicket = await startRun(rig, 'claude')

    const claimed = await claimBackup(rig.url, ticket, 'claude')
    expect(claimed.status).toBe(403)
    expect(claimed.body).toEqual({ error: LANE_TAKEOVER_PROBLEM })

    const sent = await tokenPost(
      rig.url,
      '/api/orchestrator/messages',
      { to: 'lane:claude', text: 'For the other lane.' },
      rig.token('orchestrator')
    )
    expect(sent.status).toBe(202)
    const other = await laneGet(rig.url, otherTicket)
    expect(other.body.messages.map((message) => message.text)).toContain('For the other lane.')
    const primary = await laneGet(rig.url, ticket)
    expect(primary.body.messages).toEqual([])
    await releaseRun(rig)
  })

  it('refuses a second claim on the same ticket', async () => {
    const rig = await makeBridge(makeBase())
    const ticket = await startRun(rig, PRIMARY)

    expect((await claimBackup(rig.url, ticket, BACKUP)).status).toBe(200)
    const second = await claimBackup(rig.url, ticket, BACKUP)
    expect(second.status).toBe(403)
    expect(second.body).toEqual({ error: LANE_TAKEOVER_PROBLEM })
    await releaseRun(rig)
  })

  it("gives a message to the backup's own run when the backup is running", async () => {
    const rig = await makeBridge(makeBase())
    const ticket = await startRun(rig, PRIMARY)
    expect((await claimBackup(rig.url, ticket, BACKUP)).status).toBe(200)
    const backupTicket = await startRun(rig, BACKUP)

    const sent = await tokenPost(
      rig.url,
      '/api/orchestrator/messages',
      { to: `lane:${BACKUP}`, text: 'For the backup itself.' },
      rig.token('orchestrator')
    )
    expect(sent.status).toBe(202)
    const backup = await laneGet(rig.url, backupTicket)
    expect(backup.body.messages.map((message) => message.text)).toContain('For the backup itself.')
    const primary = await laneGet(rig.url, ticket)
    expect(primary.body.messages).toEqual([])
    await releaseRun(rig)
  })
})

describe('a failover run that claims its ticket', () => {
  function gitIn(folder, args) {
    const result = spawnSync(gitPath(), ['-c', 'commit.gpgsign=false', ...args], {
      cwd: folder,
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, ...GIT_IDENTITY },
    })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${folder}: ${String(result.stderr ?? '').trim()}`)
    return String(result.stdout ?? '').trim()
  }

  function makeRepo(folder, scriptName, script) {
    mkdirSync(folder, { recursive: true })
    gitIn(folder, ['init', '-q', '-b', 'main'])
    writeFileSync(join(folder, 'readme.txt'), 'start\n')
    writeFileSync(join(folder, scriptName), script)
    gitIn(folder, ['add', '-A'])
    gitIn(folder, ['commit', '-q', '-m', 'Start the repository'])
  }

  function failScript() {
    return [
      "console.log(JSON.stringify({ type: 'error', error: { type: 'provider.rate_limit', message: '429 Too Many Requests' } }))",
      'process.exit(1)',
      '',
    ].join('\n')
  }

  function okScript(envFile) {
    return [
      "const { writeFileSync } = require('node:fs')",
      `writeFileSync(${JSON.stringify(envFile)}, JSON.stringify({ ticket: process.env.MACHINEROOM_LANE_TICKET ?? null }))`,
      "writeFileSync('note.txt', 'done\\n')",
      "console.log('{\"type\":\"step_finish\",\"part\":{\"cost\":0,\"tokens\":{\"input\":1,\"output\":1}}}')",
      '',
    ].join('\n')
  }

  function readRecords(runs) {
    const path = join(runs, 'runs.jsonl')
    if (!existsSync(path)) return []
    return readFileSync(path, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
  }

  function recordingNames(runs) {
    const names = new Set()
    for (const record of readRecords(runs)) {
      if (typeof record.log !== 'string' || record.log === '') continue
      names.add(basename(record.log).replace(/\.log$/i, ''))
    }
    return [...names]
  }

  function removeRecordings(names, indexBefore, existed) {
    for (const name of names) {
      for (const suffix of ['run.jsonl', 'agents.json', 'tree.json']) {
        rmSync(join(RECORDINGS, `${name}-${suffix}`), { force: true })
      }
    }
    if (existed !== true) {
      rmSync(RECORDINGS, { recursive: true, force: true })
      return
    }
    if (indexBefore !== null) writeFileSync(join(RECORDINGS, 'index.json'), indexBefore)
    else rmSync(join(RECORDINGS, 'index.json'), { force: true })
  }

  it('calls the bridge with its ticket and the backup name before the backup starts', async () => {
    const base = makeTempDir('mr-failover-claim-')
    const savedTicket = process.env.MACHINEROOM_LANE_TICKET
    const savedBridge = process.env.MACHINEROOM_BRIDGE
    const savedRuns = process.env.MACHINEROOM_RUNS
    const requests = []
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk.toString('utf8')
      })
      req.on('end', () => {
        requests.push({ method: req.method, path: req.url, ticket: req.headers['x-machineroom-lane'], body })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{"lane":"agy"}')
      })
    })
    try {
      const first = join(base, '.worktrees', 'first')
      const backup = join(base, '.worktrees', 'backup')
      const runs = join(base, 'runs')
      const backupEnv = join(base, 'backup-env.json')
      makeRepo(first, 'run', failScript())
      makeRepo(backup, 'run', okScript(backupEnv))
      mkdirSync(runs, { recursive: true })
      const lanes = {
        opencode: { name: 'Primary lane', worktree: first, fallback: BACKUP, forbidden: [], cli: { harness: 'opencode', bin: process.execPath, model: 'fake/fail' } },
        agy: { name: 'Backup lane', worktree: backup, forbidden: [], cli: { harness: 'opencode', bin: process.execPath, model: 'fake/ok' } },
      }
      await new Promise((done) => server.listen(0, '127.0.0.1', done))
      const { port } = server.address()
      process.env.MACHINEROOM_LANE_TICKET = TICKET_VALUE
      process.env.MACHINEROOM_BRIDGE = `http://127.0.0.1:${port}`
      process.env.MACHINEROOM_RUNS = runs
      const promptFor = (laneKey, branchSuffix = '') =>
        unattendedPrompt(buildPrompt({ briefs: [BRIEF], laneKey, lanes, rules: { about: '', rules: [] }, version: '0.1.1', branchSuffix }), process.env)
      const indexPath = join(RECORDINGS, 'index.json')
      const recordingsExisted = existsSync(RECORDINGS)
      const indexBefore = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : null
      const logs = []
      const spy = vi.spyOn(console, 'log').mockImplementation((line) => logs.push(String(line)))
      let result
      try {
        result = await startLane({
          options: { lane: PRIMARY, minutes: 1, folderCheck: { mainCheckout: dirname(runs), lanes, home: join(dirname(runs), 'home'), temp: join(dirname(runs), 'temp'), runs } },
          lane: lanes.opencode,
          lanes,
          wanted: [BRIEF],
          prompt: promptFor(PRIMARY),
          promptFor,
          logPath: join(runs, 'claim.log'),
          usageFile: join(runs, 'claim.usage.json'),
          name: 'claim',
        })
      } finally {
        spy.mockRestore()
        removeRecordings(recordingNames(runs), indexBefore, recordingsExisted)
      }
      expect(result.code, logs.join('\n')).toBe(0)
      expect(JSON.parse(readFileSync(backupEnv, 'utf8'))).toEqual({ ticket: TICKET_VALUE })
      const claim = requests.find((entry) => entry.method === 'POST' && entry.path === '/api/orchestrator/failover')
      expect(claim).toBeTruthy()
      expect(claim.ticket).toBe(TICKET_VALUE)
      expect(JSON.parse(claim.body)).toEqual({ lane: BACKUP, startedAt: readLines(join(runs, 'runs.jsonl')).find((entry) => entry.lane === BACKUP).startedAt })
      expect(requests.filter((entry) => entry.path === '/api/orchestrator/failover')).toHaveLength(1)
      expect(readFileSync(join(backup, 'note.txt'), 'utf8')).toBe('done\n')
    } finally {
      await new Promise((done) => server.close(done))
      if (savedTicket === undefined) delete process.env.MACHINEROOM_LANE_TICKET
      else process.env.MACHINEROOM_LANE_TICKET = savedTicket
      if (savedBridge === undefined) delete process.env.MACHINEROOM_BRIDGE
      else process.env.MACHINEROOM_BRIDGE = savedBridge
      if (savedRuns === undefined) delete process.env.MACHINEROOM_RUNS
      else process.env.MACHINEROOM_RUNS = savedRuns
      rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })
})
