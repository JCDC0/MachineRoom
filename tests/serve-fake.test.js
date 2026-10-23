import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { FAKE_VERSION, startFakePaperclip } from '../scripts/fake-paperclip.mjs'
import { killTree } from '../server/processTree.js'
import { FEATURES } from '../server/surface.js'
import { makeTree } from '../src/model/paths.js'
import { createPipeline } from '../src/model/pipeline.js'
import { apply, createState } from '../src/model/state.js'
import { getJson, postJson, readFrames, runEnded, waitForPaperclip } from './helpers/loop.js'
import { makeTempDir } from './helpers/tempRoot.js'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = join(rootDir, 'bin', 'machine-room.mjs')
const FIXTURES = join(rootDir, 'public', 'fixtures')
const OPEN = /^machine-room: open (http:\/\/127\.0\.0\.1:\d+\/\?live&bridge=http:\/\/127\.0\.0\.1:\d+)$/m
const cleanups = []
const children = []
const fakes = []

afterEach(async () => {
  while (children.length > 0) {
    const child = children.pop()
    if (child.exitCode === null && child.signalCode === null) killTree(child)
  }
  while (fakes.length > 0) await fakes.pop().stop()
  while (cleanups.length > 0) {
    try {
      cleanups.pop()()
    } catch {}
  }
})

function makeSandbox() {
  const tree = JSON.parse(readFileSync(join(FIXTURES, 'sandbox-tree.json'), 'utf8'))
  const base = makeTempDir('mr-serve-fake-')
  const folder = join(base, tree.root)
  for (const file of tree.files) {
    if (tree.created.includes(file)) continue
    const path = join(folder, file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${file}\n`)
  }
  cleanups.push(() => rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return { folder, tree }
}

function makeDist() {
  const base = makeTempDir('mr-serve-fake-dist-')
  const dist = join(base, 'dist')
  mkdirSync(dist, { recursive: true })
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Room</title>')
  cleanups.push(() => rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dist
}

async function setupRoom() {
  const fake = await startFakePaperclip({ port: 0, speed: 1000 })
  fakes.push(fake)
  const { folder, tree } = makeSandbox()
  return { fake, sandbox: folder, fixture: tree, dist: makeDist() }
}

function childEnv() {
  const env = { ...process.env }
  delete env.PAPERCLIP_URL
  delete env.PAPERCLIP_COMPANY_ID
  delete env.PROJECT_ROOT
  delete env.PORT
  return env
}

function startBin(args) {
  const run = { stdout: '', stderr: '', child: null }
  run.child = spawn(process.execPath, [BIN, ...args], { env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
  run.child.stdout.on('data', (chunk) => {
    run.stdout += chunk
  })
  run.child.stderr.on('data', (chunk) => {
    run.stderr += chunk
  })
  children.push(run.child)
  return run
}

function waitForAddress(run, timeoutMs = 20000) {
  return new Promise((resolveAddress, rejectAddress) => {
    let timer
    const finish = (settle, value) => {
      clearTimeout(timer)
      run.child.stdout.off('data', check)
      run.child.off('exit', onExit)
      settle(value)
    }
    const check = () => {
      const match = OPEN.exec(run.stdout)
      if (match) finish(resolveAddress, match[1])
    }
    const onExit = (code) => {
      finish(rejectAddress, new Error(`the bin exited ${code}. stdout: ${run.stdout} stderr: ${run.stderr}`))
    }
    timer = setTimeout(() => {
      finish(rejectAddress, new Error(`the bin printed no address. stdout: ${run.stdout} stderr: ${run.stderr}`))
    }, timeoutMs)
    run.child.stdout.on('data', check)
    run.child.once('exit', onExit)
    check()
  })
}

function outputLines(run) {
  return run.stdout.trim().split(/\r?\n/).filter(Boolean)
}

function runBin(args) {
  const run = startBin(args)
  return new Promise((resolveRun, rejectRun) => {
    const timer = setTimeout(() => {
      killTree(run.child)
      rejectRun(new Error(`the bin did not exit. stdout: ${run.stdout} stderr: ${run.stderr}`))
    }, 15000)
    run.child.once('error', (error) => {
      clearTimeout(timer)
      rejectRun(error)
    })
    run.child.once('exit', (code) => {
      clearTimeout(timer)
      resolveRun({ code, stdout: run.stdout, stderr: run.stderr })
    })
  })
}

function playFrames(frames, agents, tree) {
  const pipeline = createPipeline({ agents, tree })
  const state = createState(tree, agents)
  const activities = []
  for (const frame of frames) {
    for (const activity of pipeline.push(frame)) {
      apply(state, activity)
      activities.push(activity)
    }
  }
  for (const activity of pipeline.flush()) {
    apply(state, activity)
    activities.push(activity)
  }
  return { state, activities }
}

describe('the one-port room against the fake Paperclip', () => {
  it('serves the viewer and the bridge routes, runs a Hermes task, and resolves its reads in the sandbox', async () => {
    const { fake, sandbox, fixture, dist } = await setupRoom()
    const run = startBin([
      '--paperclip', fake.url,
      '--company', fake.companyId,
      '--root', sandbox,
      '--dist', dist,
      '--port', '0',
    ])
    const address = await waitForAddress(run)
    const origin = new URL(address).origin
    expect(address).toBe(`${origin}/?live&bridge=${origin}`)

    const viewer = await fetch(`${origin}/`)
    expect(viewer.status).toBe(200)
    expect(viewer.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await viewer.text()).toContain('<title>Room</title>')

    const health = await waitForPaperclip(origin)
    expect(health.ok).toBe(true)
    expect(health.paperclip).toBe(true)
    expect(health.paperclipVersion).toBe(FAKE_VERSION)
    expect(health.features).toEqual(Object.fromEntries(FEATURES.map((name) => [name, true])))

    const listed = await getJson(`${origin}/api/agents`)
    expect(listed.status).toBe(200)
    expect(listed.body).toHaveLength(5)
    expect(listed.body.find((agent) => agent.name === 'Orchestrator')).toMatchObject({ role: 'ceo' })
    const hermes = listed.body.find((agent) => agent.key === 'hermes')
    expect(hermes).toMatchObject({ name: 'Hermes', adapterType: 'hermes_local' })

    const readTree = await getJson(`${origin}/api/tree`)
    expect(readTree.status).toBe(200)
    expect(readTree.body.root).toBe('agent-sandbox')
    const expected = fixture.files.filter((file) => !fixture.created.includes(file)).sort()
    expect([...readTree.body.files].sort()).toEqual(expected)

    const created = await postJson(`${origin}/api/control/issues`, {
      title: 'Summarize the sandbox',
      assigneeAgentId: hermes.id,
      confirmed: true,
    })
    expect(created.status).toBe(201)
    expect(created.body.identifier).toBe('MR-1')

    const frames = await readFrames(origin, runEnded(hermes.id))
    const tree = makeTree(readTree.body)
    const { state, activities } = playFrames(frames, listed.body, tree)
    const mine = activities.filter((activity) => activity.agent === 'hermes')
    expect(mine.map((activity) => activity.type)).toEqual(expect.arrayContaining(['run.queued', 'run.start', 'tool.start', 'run.end']))
    expect(mine.at(-1)).toMatchObject({ type: 'run.end', ok: true })
    expect(state.agents.get('hermes')).toMatchObject({ status: 'done', runs: 1 })

    const reads = mine.filter((activity) => activity.type === 'tool.start' && activity.tool === 'read').flatMap((activity) => activity.touches)
    expect(reads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'src/strings.js', mode: 'read' }),
        expect.objectContaining({ path: 'src/math.js', mode: 'read' }),
        expect.objectContaining({ path: 'test/math.test.js', mode: 'read' }),
      ])
    )
    const paths = reads.map((touch) => touch.path)
    expect(paths).not.toContain('strings.js')
    expect(paths).not.toContain('math.js')
    expect(paths).not.toContain('math.test.js')
    expect(state.files.get('src/strings.js').reads).toBeGreaterThanOrEqual(1)
    expect(state.files.get('src/math.js').reads).toBeGreaterThanOrEqual(1)
    expect(state.files.get('test/math.test.js').reads).toBeGreaterThanOrEqual(1)
  }, 30000)

  it('passes doctor against the fake and fails it against a dead port', async () => {
    const { fake, sandbox } = await setupRoom()
    const passed = await runBin(['doctor', '--paperclip', fake.url, '--company', fake.companyId, '--root', sandbox])
    const lines = passed.stdout.trim().split(/\r?\n/)
    expect(passed.code).toBe(0)
    expect(lines).toHaveLength(5)
    expect(lines.every((line) => line.startsWith('ok '))).toBe(true)
    expect(lines[0]).toContain(`Paperclip answers at ${fake.url}`)
    expect(lines[0]).toContain(`version ${FAKE_VERSION}`)
    expect(passed.stderr).toBe('')

    const failed = await runBin(['doctor', '--paperclip', 'http://127.0.0.1:1', '--company', fake.companyId, '--root', sandbox])
    expect(failed.code).toBe(1)
    expect(failed.stdout).toContain('FAIL Paperclip does not answer at http://127.0.0.1:1.')
  }, 30000)

  it('prints its checks and serves the room with up', async () => {
    const { fake, sandbox, dist } = await setupRoom()
    const run = startBin([
      'up',
      '--paperclip', fake.url,
      '--company', fake.companyId,
      '--root', sandbox,
      '--dist', dist,
      '--port', '0',
    ])
    const address = await waitForAddress(run)
    const origin = new URL(address).origin
    expect(address).toBe(`${origin}/?live&bridge=${origin}`)

    const viewer = await fetch(`${origin}/`)
    expect(viewer.status).toBe(200)
    expect(await viewer.text()).toContain('<title>Room</title>')

    const lines = outputLines(run)
    expect(lines.at(-1)).toBe(`machine-room: open ${address}`)
    const checks = lines.slice(0, -1)
    expect(checks).toHaveLength(5)
    expect(checks.every((line) => line.startsWith('ok '))).toBe(true)
    expect(checks[0]).toContain('Paperclip answers at')
    expect(checks[4]).toContain('The newest database backup is 2 hours old.')
  }, 30000)
})
