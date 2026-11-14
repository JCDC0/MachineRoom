import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createRunsApi } from '../server/runs.js'
import { waitFor } from './helpers/bridge.js'
import { makeTempDir } from './helpers/tempRoot.js'

const cleanups = []

afterEach(() => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    fn()
  }
})

function tempDir(prefix) {
  const dir = makeTempDir(prefix)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

function writeRunner(dir, out) {
  const path = join(dir, 'runner.mjs')
  writeFileSync(
    path,
    [
      "import { writeFileSync } from 'node:fs'",
      'const args = process.argv.slice(2)',
      `writeFileSync(${JSON.stringify(out)}, JSON.stringify(args))`,
    ].join('\n')
  )
  return path
}

function readArgs(out) {
  try {
    return JSON.parse(readFileSync(out, 'utf8'))
  } catch {
    return null
  }
}

function writeLanes(dir) {
  const path = join(dir, 'lanes.json')
  writeFileSync(
    path,
    JSON.stringify({
      opencode: { name: 'OpenCode', cli: { harness: 'opencode', bin: 'opencode.exe', model: 'opencode-go/deepseek-v4.1-flash' } },
      claude: { name: 'Claude Code', cli: { harness: 'claude', bin: 'claude', model: 'sonnet' } },
    })
  )
  return path
}

function makeApi() {
  const project = tempDir('mr-mode-project-')
  const runnerDir = tempDir('mr-mode-runner-')
  const lanesDir = tempDir('mr-mode-lanes-')
  const runs = tempDir('mr-mode-runs-')
  const out = join(runnerDir, 'args.json')
  mkdirSync(runs, { recursive: true })
  let next = null
  let answer = null
  const api = createRunsApi({
    projectRoot: project,
    runnerCommand: { file: process.execPath, args: [writeRunner(runnerDir, out)] },
    sendJson: (req, res, status, body) => {
      answer = { status, body }
    },
    readJsonBody: async () => next,
    lanesFile: writeLanes(lanesDir),
    runsFolder: runs,
    activeLanes: { isChosen: () => true, isLaneActive: () => true },
  })
  cleanups.push(() => api.stopAll())
  return {
    project,
    api,
    out,
    async post(body) {
      next = body
      answer = null
      await api.handle(
        { method: 'POST', headers: { origin: 'http://localhost:5173' } },
        {},
        new URL('http://127.0.0.1/api/control/runs')
      )
      return answer
    },
  }
}

describe('the runs route with a permission mode', () => {
  it('starts a run with plan as --mode plan', async () => {
    const { project, api, out, post } = makeApi()
    const answer = await post({ lane: 'opencode', task: 'Fix the typo.', mode: 'plan', confirmed: true })
    expect(answer.status).toBe(202)
    const args = await waitFor(() => readArgs(out), { what: 'the runner arguments' })
    expect(args).toEqual(['opencode', '--project', project, '--task', 'Fix the typo.', '--mode', 'plan', '--started-at', answer.body.startedAt])
    await waitFor(() => !api.isRunning('opencode'), { what: 'the run to end' })
  })

  it('refuses a mode outside the harness list and starts nothing', async () => {
    const { api, out, post } = makeApi()
    const answer = await post({ lane: 'opencode', task: 'Fix the typo.', mode: 'bypass', confirmed: true })
    expect(answer.status).toBe(400)
    expect(answer.body).toEqual({ error: "The bypass mode is not one opencode's harness has. It has: plan, edits, auto." })
    expect(readArgs(out)).toBeNull()
    expect(api.isRunning('opencode')).toBe(false)
  })

  it('refuses ask in a lane run', async () => {
    const { api, out, post } = makeApi()
    const answer = await post({ lane: 'claude', task: 'Fix the typo.', mode: 'ask', confirmed: true })
    expect(answer.status).toBe(400)
    expect(answer.body).toEqual({ error: 'A lane run has nobody to ask, so the ask mode is for orchestrators only.' })
    expect(readArgs(out)).toBeNull()
    expect(api.isRunning('claude')).toBe(false)
  })

  it("starts a run with no mode and today's arguments", async () => {
    const { project, api, out, post } = makeApi()
    const answer = await post({ lane: 'opencode', task: 'Fix the typo.', confirmed: true })
    expect(answer.status).toBe(202)
    const args = await waitFor(() => readArgs(out), { what: 'the runner arguments' })
    expect(args).toEqual(['opencode', '--project', project, '--task', 'Fix the typo.', '--started-at', answer.body.startedAt])
    await waitFor(() => !api.isRunning('opencode'), { what: 'the run to end' })
  })
})
