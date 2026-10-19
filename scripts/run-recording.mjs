#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { agentsFile, framesFromRun, treeFile } from '../src/briefs/recording.js'
import { prepare } from '../src/model/source.js'

const root = resolve(fileURLToPath(import.meta.url), '..', '..')
const VARIABLE = /%([A-Za-z_][A-Za-z0-9_]*)%/g
const TIMEOUT = 120000

function refusal(message) {
  return new Error(message)
}

function runsFile() {
  return join(process.env.TEMP || tmpdir(), 'machineroom-runs', 'runs.jsonl')
}

function readRecords() {
  const path = runsFile()
  if (!existsSync(path)) return []
  const out = []
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line))
    } catch {
      continue
    }
  }
  return out
}

function position(argv) {
  const value = String(argv[0] ?? '')
  if (!/^\d+$/.test(value) || Number(value) < 1) throw refusal('Name a run by its position in the run list, for example 1.')
  return Number(value)
}

function expand(file, env) {
  return String(file ?? '').replace(VARIABLE, (whole, name) => {
    const value = env?.[name]
    if (typeof value !== 'string' || value === '') throw refusal(`The environment variable ${name} is not set.`)
    return value
  })
}

function laneOf(lanes, record) {
  const key = String(record.lane ?? '')
  const lane = lanes && Object.hasOwn(lanes, key) ? lanes[key] : null
  if (!lane) throw refusal(`There is no lane named ${key} in docs/agents/lanes.json.`)
  const harness = lane.cli?.harness
  if (harness !== 'hermes' && harness !== 'opencode') throw refusal(`The lane ${key} has no command line, so its run cannot be recorded.`)
  return { key, lane, harness }
}

function exportSession(file, sessionId) {
  const result = spawnSync(file, ['sessions', 'export', '--session-id', String(sessionId), '--format', 'jsonl', '-'], {
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    timeout: TIMEOUT,
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error || result.status !== 0) throw refusal('The session for that run could not be exported.')
  const text = String(result.stdout ?? '')
  if (!text.trim()) throw refusal('The session for that run could not be exported.')
  return text
}

function commitRef(record) {
  const first = Array.isArray(record.commits) ? String(record.commits[0] ?? '') : ''
  const word = first.trim().split(/\s+/)[0]
  const ref = word || String(record.branch ?? '').trim()
  if (!ref) throw refusal('The run record names no commit or branch, so its file list cannot be read.')
  if (!/^[A-Za-z0-9][\w./-]*$/.test(ref)) throw refusal(`The run record names ${ref} as its commit, which is not a plain commit or branch name.`)
  return ref
}

function gitFiles(worktree, ref) {
  const result = spawnSync('git', ['ls-tree', '-r', '--name-only', ref], {
    cwd: worktree,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    timeout: TIMEOUT,
  })
  if (result.error || result.status !== 0) throw refusal(`The file list of the run at ${ref} could not be read.`)
  return String(result.stdout ?? '')
    .split(/\r?\n/)
    .filter(Boolean)
}

function main() {
  const index = position(process.argv.slice(2))
  const list = readRecords()
  if (list.length === 0) throw refusal('No runs are recorded yet.')
  if (index > list.length) throw refusal(`There is no run at position ${index}. The list holds ${list.length}.`)
  const record = list[list.length - index]
  const lanes = JSON.parse(readFileSync(join(root, 'docs', 'agents', 'lanes.json'), 'utf8'))
  const { key, lane, harness } = laneOf(lanes, record)
  const logPath = String(record.log ?? '')
  if (!logPath || !existsSync(logPath)) throw refusal('The log for that run is gone.')
  const log = readFileSync(logPath, 'utf8')
  let session = ''
  if (harness === 'hermes') {
    const usagePath = logPath.replace(/\.log$/i, '.usage.json')
    if (!existsSync(usagePath)) throw refusal('The usage file for that run is gone.')
    let usage
    try {
      usage = JSON.parse(readFileSync(usagePath, 'utf8'))
    } catch {
      usage = null
    }
    const sessionId = usage?.session_id
    if (!sessionId) throw refusal('The usage file for that run names no session.')
    session = exportSession(expand(lane.cli?.bin, process.env), sessionId)
  }
  const worktree = String(lane.worktree ?? '')
  if (!worktree) throw refusal(`The lane ${key} has no worktree, so its file list cannot be read.`)
  const ref = commitRef(record)
  const files = gitFiles(worktree, ref)
  const frames = framesFromRun({ harness, log, session, record })
  const agents = agentsFile(key, lanes)
  const tree = treeFile(worktree, files)
  const { activities } = prepare({ frames, agentsFile: agents, treeFile: tree })
  const toolCalls = activities.filter((activity) => activity.type === 'tool.start').length
  const name = basename(logPath).replace(/\.log$/i, '')
  const folder = join(root, 'public', 'recordings')
  mkdirSync(folder, { recursive: true })
  const runPath = join(folder, `${name}-run.jsonl`)
  const agentsPath = join(folder, `${name}-agents.json`)
  const treePath = join(folder, `${name}-tree.json`)
  writeFileSync(runPath, `${frames.map((frame) => JSON.stringify(frame)).join('\n')}\n`)
  writeFileSync(agentsPath, `${JSON.stringify(agents, null, 2)}\n`)
  writeFileSync(treePath, `${JSON.stringify(tree, null, 2)}\n`)
  console.log(`recording: ${runPath}`)
  console.log(`agents: ${agentsPath}`)
  console.log(`tree: ${treePath}`)
  console.log(`frames: ${frames.length}`)
  console.log(`tool calls: ${toolCalls}`)
}

try {
  main()
} catch (error) {
  console.error(String(error?.message ?? error))
  process.exitCode = 1
}
