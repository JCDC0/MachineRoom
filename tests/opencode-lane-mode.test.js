import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { makeTempDir } from './helpers/tempRoot.js'

const RUN_LANE_SCRIPT = fileURLToPath(new URL('../scripts/run-lane.mjs', import.meta.url))
const cleanups = []

afterEach(() => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    fn()
  }
})

function runLane(args, extraEnv = {}) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [RUN_LANE_SCRIPT, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...extraEnv },
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      fail(new Error(`run-lane did not exit. stderr: ${stderr}`))
    }, 30000)
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      fail(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      done({ code, stdout, stderr })
    })
  })
}

function setupRig({ cliMode, exitCode = 0 } = {}) {
  const folder = makeTempDir('mr-opencode-lane-mode-')
  cleanups.push(() => rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const runs = join(folder, 'runs')
  const project = join(folder, 'project')
  mkdirSync(runs, { recursive: true })
  mkdirSync(project, { recursive: true })
  const captureFile = join(folder, 'capture.json')
  const lanesFile = join(folder, 'lanes.json')
  writeFileSync(
    lanesFile,
    `${JSON.stringify({
      opencode: {
        name: 'OpenCode',
        worktree: join(folder, '.worktrees', 'opencode'),
        cli: {
          harness: 'opencode',
          bin: process.execPath,
          model: 'fake/model',
          ...(cliMode !== undefined ? { mode: cliMode } : {}),
        },
      },
    }, null, 2)}\n`
  )
  writeFileSync(
    join(project, 'run'),
    [
      "const { existsSync, readdirSync, readFileSync, statSync, writeFileSync } = require('node:fs')",
      `const runsDir = ${JSON.stringify(runs)}`,
      "const cfg = process.env.OPENCODE_CONFIG || ''",
      'const existed = cfg !== "" && existsSync(cfg)',
      'const modeBits = existed ? statSync(cfg).mode & 0o777 : null',
      "const content = existed ? JSON.parse(readFileSync(cfg, 'utf8')) : null",
      "const filesInRuns = readdirSync(runsDir).filter((entry) => entry.endsWith('.mcp.json'))",
      `writeFileSync(${JSON.stringify(captureFile)}, JSON.stringify({ cfg, existed, modeBits, content, filesInRuns }))`,
      "console.log('{\"type\":\"step_finish\",\"part\":{\"cost\":0,\"tokens\":{\"input\":1,\"output\":1}}}')",
      `process.exit(${Number(exitCode)})`,
      '',
    ].join('\n')
  )
  return {
    folder,
    runs,
    project,
    env: { MACHINEROOM_LANES_FILE: lanesFile, MACHINEROOM_RUNS: runs },
    readCapture: () => JSON.parse(readFileSync(captureFile, 'utf8')),
    mcpFilesInRuns: () => readdirSync(runs).filter((entry) => entry.endsWith('.mcp.json')),
  }
}

describe('OpenCode lane permission config', () => {
  it('passes OPENCODE_CONFIG denying edit and bash for --mode plan and removes it after the run', async () => {
    const rig = setupRig()
    const result = await runLane(['opencode', '--project', rig.project, '--task', 'Plan the change.', '--mode', 'plan'], rig.env)
    expect(result.code, result.stdout + result.stderr).toBe(0)
    const seen = rig.readCapture()
    expect(seen.cfg).toMatch(/\.mcp\.json$/)
    expect(seen.cfg.startsWith(rig.runs)).toBe(true)
    expect(seen.existed).toBe(true)
    if (process.platform !== 'win32') expect(seen.modeBits).toBe(0o600)
    expect(seen.content).toEqual({ permission: { external_directory: 'deny', edit: 'deny', bash: 'deny' } })
    expect(existsSync(seen.cfg)).toBe(false)
    expect(rig.mcpFilesInRuns()).toEqual([])
  })

  it('passes OPENCODE_CONFIG denying bash only for --mode edits and removes it after the run', async () => {
    const rig = setupRig()
    const result = await runLane(['opencode', '--project', rig.project, '--task', 'Edit the file.', '--mode', 'edits'], rig.env)
    expect(result.code, result.stdout + result.stderr).toBe(0)
    const seen = rig.readCapture()
    expect(seen.cfg).toMatch(/\.mcp\.json$/)
    expect(seen.cfg.startsWith(rig.runs)).toBe(true)
    expect(seen.existed).toBe(true)
    if (process.platform !== 'win32') expect(seen.modeBits).toBe(0o600)
    expect(seen.content).toEqual({ permission: { external_directory: 'deny', bash: 'deny' } })
    expect(existsSync(seen.cfg)).toBe(false)
    expect(rig.mcpFilesInRuns()).toEqual([])
  })

  it('merges enabled MCP servers with permission config for plan and edits and removes the file', async () => {
    const rig = setupRig()
    writeFileSync(
      join(rig.runs, 'mcp.json'),
      JSON.stringify({
        servers: [
          { name: 'browser', transport: 'http', url: 'https://example.com/mcp', enabled: true },
          { name: 'db', transport: 'stdio', command: 'node', args: ['db.js'], env: { DB_MODE: 'ro' }, enabled: true },
          { name: 'disabled_srv', transport: 'stdio', command: 'node', enabled: false },
        ],
      })
    )
    const expectedMcp = {
      browser: { type: 'remote', url: 'https://example.com/mcp', enabled: true },
      db: { type: 'local', command: ['node', 'db.js'], environment: { DB_MODE: 'ro' }, enabled: true },
    }

    const planResult = await runLane(['opencode', '--project', rig.project, '--task', 'Plan with MCP.', '--mode', 'plan'], rig.env)
    expect(planResult.code, planResult.stdout + planResult.stderr).toBe(0)
    const planSeen = rig.readCapture()
    expect(planSeen.existed).toBe(true)
    expect(planSeen.content).toEqual({
      mcp: expectedMcp,
      permission: { external_directory: 'deny', edit: 'deny', bash: 'deny' },
    })
    expect(existsSync(planSeen.cfg)).toBe(false)

    const editsResult = await runLane(['opencode', '--project', rig.project, '--task', 'Edit with MCP.', '--mode', 'edits'], rig.env)
    expect(editsResult.code, editsResult.stdout + editsResult.stderr).toBe(0)
    const editsSeen = rig.readCapture()
    expect(editsSeen.existed).toBe(true)
    expect(editsSeen.content).toEqual({
      mcp: expectedMcp,
      permission: { external_directory: 'deny', bash: 'deny' },
    })
    expect(existsSync(editsSeen.cfg)).toBe(false)
    expect(rig.mcpFilesInRuns()).toEqual([])
  })

  it('writes an external directory denial when no mode or auto mode is used', async () => {
    const rig = setupRig()

    const planResult = await runLane(['opencode', '--project', rig.project, '--task', 'Plan first.', '--mode', 'plan'], rig.env)
    expect(planResult.code, planResult.stdout + planResult.stderr).toBe(0)
    const planSeen = rig.readCapture()
    expect(planSeen.existed).toBe(true)
    expect(planSeen.filesInRuns).toHaveLength(1)
    expect(existsSync(planSeen.cfg)).toBe(false)

    const plainResult = await runLane(['opencode', '--project', rig.project, '--task', 'Run without mode.'], rig.env)
    expect(plainResult.code, plainResult.stdout + plainResult.stderr).toBe(0)
    const plainSeen = rig.readCapture()
    expect(plainSeen.cfg).toMatch(/\.mcp\.json$/)
    expect(plainSeen.existed).toBe(true)
    expect(plainSeen.content).toEqual({ permission: { external_directory: 'deny' } })
    expect(existsSync(plainSeen.cfg)).toBe(false)
    expect(rig.mcpFilesInRuns()).toEqual([])

    const autoResult = await runLane(['opencode', '--project', rig.project, '--task', 'Run in auto.', '--mode', 'auto'], rig.env)
    expect(autoResult.code, autoResult.stdout + autoResult.stderr).toBe(0)
    const autoSeen = rig.readCapture()
    expect(autoSeen.cfg).toMatch(/\.mcp\.json$/)
    expect(autoSeen.existed).toBe(true)
    expect(autoSeen.content).toEqual({ permission: { external_directory: 'deny' } })
    expect(existsSync(autoSeen.cfg)).toBe(false)
    expect(rig.mcpFilesInRuns()).toEqual([])
  })

  it('removes the config file when a cli.mode plan run exits non-zero and keeps ask refused', async () => {
    const rig = setupRig({ cliMode: 'plan', exitCode: 1 })
    const failed = await runLane(['opencode', '--project', rig.project, '--task', 'Fail in plan.'], rig.env)
    expect(failed.code).toBe(1)
    const seen = rig.readCapture()
    expect(seen.existed).toBe(true)
    expect(seen.content).toEqual({ permission: { external_directory: 'deny', edit: 'deny', bash: 'deny' } })
    expect(existsSync(seen.cfg)).toBe(false)
    expect(rig.mcpFilesInRuns()).toEqual([])

    const asked = await runLane(['opencode', '--project', rig.project, '--task', 'Ask mode.', '--mode', 'ask'], rig.env)
    expect(asked.code).toBe(1)
    expect(asked.stderr).toContain("The ask mode is not one opencode's harness has. It has: plan, edits, auto.")
    expect(rig.mcpFilesInRuns()).toEqual([])
  })
})
