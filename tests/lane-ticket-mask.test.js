import { randomBytes } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { maskKeys } from '../src/briefs/audit.js'
import { createLaneLog } from '../src/briefs/run.js'
import { getJson, waitFor } from './helpers/bridge.js'
import { makeTempDir } from './helpers/tempRoot.js'

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const cleanups = []

afterEach(async () => {
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

function postJson(url, body) {
  return getJson(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: new URL(url).origin },
    body: JSON.stringify(body),
  })
}

function ticketValue() {
  return randomBytes(16).toString('hex')
}

function writeRunner(dir, form) {
  const logPath = join(dir, 'lane.log')
  const ticketPath = join(dir, 'ticket.txt')
  const runUrl = pathToFileURL(join(REPO_ROOT, 'src', 'briefs', 'run.js')).href
  const lines = [
    "import { appendFileSync, writeFileSync } from 'node:fs'",
    `import { createLaneLog } from ${JSON.stringify(runUrl)}`,
    "const ticket = process.env.MACHINEROOM_LANE_TICKET ?? ''",
    `writeFileSync(${JSON.stringify(ticketPath)}, ticket)`,
    `const log = createLaneLog({ write: (text) => appendFileSync(${JSON.stringify(logPath)}, text) })`,
  ]
  if (form === 'header') {
    lines.push("const text = 'X-MachineRoom-Lane: ' + ticket + '\\n'")
    lines.push("log.push('stdout', text)")
    lines.push('process.stdout.write(text)')
  } else if (form === 'bare') {
    lines.push("const text = ticket + '\\n'")
    lines.push("log.push('stdout', text)")
    lines.push('process.stdout.write(text)')
  } else {
    lines.push("log.push('stdout', 'X-MachineRoom-Lane: ' + ticket.slice(0, 16))")
    lines.push("process.stdout.write('X-MachineRoom-Lane: ' + ticket.slice(0, 16))")
    lines.push('await new Promise((done) => setTimeout(done, 250))')
    lines.push("log.push('stdout', ticket.slice(16) + '\\n')")
    lines.push("process.stdout.write(ticket.slice(16) + '\\n')")
    lines.push("log.push('stdout', ticket.slice(0, 12))")
    lines.push('process.stdout.write(ticket.slice(0, 12))')
    lines.push('await new Promise((done) => setTimeout(done, 250))')
    lines.push("log.push('stdout', ticket.slice(12) + '\\n')")
    lines.push("process.stdout.write(ticket.slice(12) + '\\n')")
  }
  lines.push('log.flush()')
  lines.push('await new Promise((done) => setTimeout(done, 1200))')
  lines.push('process.exit(3)')
  const path = join(dir, `runner-${form}.mjs`)
  writeFileSync(path, lines.join('\n'))
  return { path, logPath, ticketPath }
}

async function startBridge({ projectRoot, runnerPath }) {
  const runs = tempDir('mr-ticket-runs-')
  mkdirSync(runs, { recursive: true })
  writeActiveLanes(activeLanesFileFor(projectRoot, runs), ['opencode', 'opencode2'])
  const bridge = createBridge({
    projectRoot,
    port: 0,
    runsFolder: runs,
    lanesFile: join(REPO_ROOT, 'docs', 'agents', 'lanes.json'),
    runnerCommand: { file: process.execPath, args: [runnerPath] },
  })
  cleanups.push(() => bridge.stop())
  const { url } = await bridge.start()
  return { url, runs }
}

function readLastRecord(runs) {
  try {
    const text = readFileSync(join(runs, 'runs.jsonl'), 'utf8').trim()
    if (text === '') return null
    return JSON.parse(text.split(/\r?\n/).at(-1))
  } catch {
    return null
  }
}

async function startAndCollect({ form }) {
  const project = tempDir('mr-ticket-project-')
  const dir = tempDir('mr-ticket-runner-')
  const runner = writeRunner(dir, form)
  const { url, runs } = await startBridge({ projectRoot: project, runnerPath: runner.path })
  const started = await postJson(`${url}/api/control/runs`, { lane: 'opencode', task: 'Print the ticket.', confirmed: true })
  expect(started.status).toBe(202)
  const ticket = await waitFor(
    () => {
      try {
        return readFileSync(runner.ticketPath, 'utf8').trim() || null
      } catch {
        return null
      }
    },
    { what: 'the runner ticket' }
  )
  expect(ticket).toMatch(/^[0-9a-f]{32}$/)
  const running = await waitFor(
    async () => {
      const { body } = await getJson(`${url}/api/control/runs`)
      return body.running.length > 0 && body.running[0].lastLines.length > 0 ? body : null
    },
    { what: 'the running output' }
  )
  expect(JSON.stringify(running)).not.toContain(ticket)
  await waitFor(async () => (await getJson(`${url}/api/control/runs`)).body.running.length === 0, { what: 'the run to end' })
  const record = await waitFor(
    () => {
      const found = readLastRecord(runs)
      return found && found.startedAt === started.body.startedAt ? found : null
    },
    { what: 'the run record' }
  )
  return { ticket, record, log: readFileSync(runner.logPath, 'utf8') }
}

describe('maskKeys on a lane ticket', () => {
  it('masks the value after the lane header and after the ticket variable', () => {
    const ticket = ticketValue()
    expect(maskKeys(`X-MachineRoom-Lane: ${ticket}`)).toEqual({ text: 'X-MachineRoom-Lane: [key]', count: 1 })
    expect(maskKeys(`MACHINEROOM_LANE_TICKET=${ticket}`)).toEqual({ text: 'MACHINEROOM_LANE_TICKET=[key]', count: 1 })
  })

  it('masks the lane header in a curl command', () => {
    const ticket = ticketValue()
    expect(maskKeys(`curl -H "X-MachineRoom-Lane: ${ticket}" http://127.0.0.1:4040/api/orchestrator/messages`)).toEqual({
      text: 'curl -H "X-MachineRoom-Lane: [key]" http://127.0.0.1:4040/api/orchestrator/messages',
      count: 1,
    })
  })
})

describe('createLaneLog on a lane ticket', () => {
  it('masks the bare ticket and a ticket split across two chunks', () => {
    const ticket = ticketValue()
    const chunks = []
    const log = createLaneLog({ write: (text) => chunks.push(text), ticket })
    log.push('stdout', `${ticket.slice(0, 10)}`)
    log.push('stdout', `${ticket.slice(10)}\n`)
    log.push('stdout', `X-MachineRoom-Lane: ${ticket}\n`)
    log.flush()
    const text = chunks.join('')
    expect(text).not.toContain(ticket)
    expect(text).toContain('[key]')
  })
})

describe('a runner that prints its lane ticket', () => {
  it('keeps the header value out of the running answer, the record and the lane log', async () => {
    const { ticket, record, log } = await startAndCollect({ form: 'header' })
    expect(JSON.stringify(record)).not.toContain(ticket)
    expect(record.note).toContain('X-MachineRoom-Lane: [key]')
    expect(log).not.toContain(ticket)
    expect(log).toContain('X-MachineRoom-Lane: [key]')
  })

  it('keeps the bare ticket out of the running answer, the record and the lane log', async () => {
    const { ticket, record, log } = await startAndCollect({ form: 'bare' })
    expect(JSON.stringify(record)).not.toContain(ticket)
    expect(log).not.toContain(ticket)
    expect(log).toContain('[key]')
  })

  it('masks a ticket split across two output chunks', async () => {
    const { ticket, record, log } = await startAndCollect({ form: 'split' })
    expect(JSON.stringify(record)).not.toContain(ticket)
    expect(record.note).toContain('X-MachineRoom-Lane: [key]')
    expect(log).not.toContain(ticket)
    expect(log).toContain('X-MachineRoom-Lane: [key]')
    expect(log.match(/\[key\]/g)).toHaveLength(2)
  })
})
