import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { maskKeys } from '../src/briefs/audit.js'
import { maskProfilePaths } from '../src/model/paths.js'
import { harnessByKey } from '../src/harnesses/index.js'
import { HARNESS_OFF_PROBLEM, readHarnessSettings } from './harness-settings.js'
import { resolveHarnessProgram } from './harness-models.js'
import { harnessUnavailableProblem } from './model-list.js'
import { killTree } from './processTree.js'
import { endpointModels } from './models.js'
import { quietAgy } from './quiet-agy.js'

const PROBE_PROMPT = 'Reply with the word OK and nothing else.'
const PROBE_LIMIT_MS = 60000
export const PROBE_RUNNING_PROBLEM = 'A connection test is already running.'
const PROBE_ACP_PROBLEM = 'A connection test is not available for ACP.'
const PROBE_DIRECT_PROBLEM = 'Set a Direct API model first.'
const PROBE_TITLE = 'MachineRoom connection test'
const PROBE_PLAN_CONFIG = { permission: { external_directory: 'deny', edit: 'deny', bash: 'deny' } }

function directModel(runsFolder, lanes) {
  const lane = Object.values(lanes ?? {}).find((item) => item?.cli?.harness === 'machineroom' && item.enabled !== false && String(item.cli.model ?? '').trim() !== '')
  return lane ? String(lane.cli.model).trim() : (endpointModels(runsFolder)[0]?.id ?? '')
}

const running = new Set()

function firstLine(text) {
  const line = String(text ?? '').split(/\r?\n/).map((item) => item.trim()).find((item) => item !== '') ?? 'The program failed with no message.'
  return maskKeys(maskProfilePaths(line)).text.slice(0, 200)
}

function oneTurn(command, { env, limitMs, platform }) {
  return new Promise((done) => {
    const isNode = /\.m?js$/.test(command.file)
    let output = ''
    let timedOut = false
    let child
    try {
      child = spawn(isNode ? process.execPath : command.file, isNode ? [command.file, ...command.args] : command.args, {
        cwd: command.cwd,
        env: quietAgy({ ...env, ...command.env }),
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch {
      done({ code: null, output: 'The program could not be started.', timedOut })
      return
    }
    const timer = setTimeout(() => {
      timedOut = true
      if (!killTree(child, { platform })) child.kill()
    }, limitMs)
    const take = (chunk) => {
      if (output.length < 1_000_000) output += chunk.toString('utf8')
    }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    child.on('error', () => {
      clearTimeout(timer)
      done({ code: null, output: 'The program could not be started.', timedOut })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      done({ code, output, timedOut })
    })
  })
}

export async function probeHarness(key, { runsFolder, lanes = {}, env = process.env, platform = process.platform, limitMs = PROBE_LIMIT_MS, available = true } = {}) {
  const descriptor = Object.hasOwn(harnessByKey, key) ? harnessByKey[key] : null
  if (!descriptor) return { status: 404, error: 'Choose a known harness.' }
  if (readHarnessSettings(runsFolder).off.includes(key)) return { status: 409, error: HARNESS_OFF_PROBLEM }
  if (key === 'acp') return { status: 409, error: PROBE_ACP_PROBLEM }
  const program = key === 'machineroom' ? '' : resolveHarnessProgram(key, { runsFolder, lanes, env, platform })
  if (!available || (key !== 'machineroom' && !program)) return { status: 409, error: harnessUnavailableProblem(key) }
  if (running.has(key)) return { status: 409, error: PROBE_RUNNING_PROBLEM }
  let folder
  const started = Date.now()
  try {
    running.add(key)
    folder = mkdtempSync(join(tmpdir(), 'machineroom-probe-'))
    const model = key === 'machineroom' ? directModel(runsFolder, lanes) : ''
    if (key === 'machineroom' && !model) return { status: 200, body: { key, status: 'unknown', line: PROBE_DIRECT_PROBLEM, seconds: 0 } }
    let mcpConfig = ''
    if (key === 'opencode') {
      mcpConfig = join(folder, 'probe.mcp.json')
      writeFileSync(mcpConfig, JSON.stringify(PROBE_PLAN_CONFIG))
    }
    const command = descriptor.command({ cli: { bin: program, model }, prompt: PROBE_PROMPT, env, folder, mode: 'plan', title: PROBE_TITLE, mcpConfig })
    const { code, output, timedOut } = await oneTurn(command, { env, limitMs, platform })
    const seconds = Math.round((Date.now() - started) / 100) / 10
    const failure = descriptor.failure?.(output) || (descriptor.limited?.(output) ? firstLine(output) : '')
    let status = 'unknown'
    let line = ''
    if (timedOut) line = 'no clear reply'
    else if (code !== 0 || failure) {
      status = 'failed'
      line = firstLine(failure || output)
    } else if (/\bOK\b/.test(descriptor.reply?.(output) ?? '')) status = 'reached'
    else line = 'no clear reply'
    return { status: 200, body: { key, status, line, seconds } }
  } finally {
    running.delete(key)
    if (folder) rmSync(folder, { recursive: true, force: true })
  }
}
