import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { agentsFile, framesFromRun, recordingIndex, treeFile } from '../src/briefs/recording.js'
import { prepare } from '../src/model/source.js'
import { RECORDING_NAME } from '../src/startup.js'
import { gitPath } from '../server/programPath.js'

const VARIABLE = /%([A-Za-z_][A-Za-z0-9_]*)%/g
const TIMEOUT = 120000
const INDEX_LIMIT = 50

function refusal(message) {
  return new Error(message)
}

function expand(file, env) {
  return String(file ?? '').replace(VARIABLE, (whole, name) => {
    const value = env?.[name]
    if (typeof value !== 'string' || value === '') throw refusal(`The environment variable ${name} is not set.`)
    return value
  })
}

function laneOf(lanes, record) {
  const key = String(record?.lane ?? '')
  const lane = lanes && Object.hasOwn(lanes, key) ? lanes[key] : null
  if (!lane) throw refusal(`There is no lane named ${key} in docs/agents/lanes.json.`)
  const harness = lane.cli?.harness
  if (harness !== 'hermes' && harness !== 'opencode') throw refusal(`The lane ${key} has no command line, so its run cannot be recorded.`)
  return { key, lane, harness }
}

function exportSessionText(file, sessionId) {
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
  const result = spawnSync(gitPath(), ['ls-tree', '-r', '--name-only', ref], {
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

function sessionFor({ lane, key, record, env, session, exportSession }) {
  if (typeof session === 'string' && session.trim() !== '') return session
  if (typeof exportSession === 'function') return String(exportSession({ lane, key, record }) ?? '')
  const logPath = String(record.log ?? '')
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
  return exportSessionText(expand(lane.cli?.bin, env), sessionId)
}

function readIndex(folder) {
  try {
    const list = JSON.parse(readFileSync(join(folder, 'index.json'), 'utf8'))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function keptIndex(folder, entries) {
  return entries.filter((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return true
    if (typeof item.name !== 'string' || !RECORDING_NAME.test(item.name)) return true
    return existsSync(join(folder, `${item.name}-run.jsonl`))
  })
}

function indexEntry({ name, record, frames, toolCalls }) {
  const minutes = Number(record.minutes)
  return {
    name,
    lane: String(record.lane ?? ''),
    briefs: Array.isArray(record.briefs) ? record.briefs.map(String) : [],
    model: String(record.model ?? ''),
    start: String(record.startedAt ?? ''),
    minutes: Number.isFinite(minutes) ? minutes : 0,
    exitCode: Number.isInteger(record.exitCode) ? record.exitCode : null,
    frames,
    toolCalls,
  }
}

function writeIndex(folder, entry) {
  const entries = keptIndex(folder, readIndex(folder))
  const next = recordingIndex(entries, entry, INDEX_LIMIT)
  const path = join(folder, 'index.json')
  const temp = join(folder, `.index-${process.pid}-${Date.now()}.json`)
  try {
    writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`)
    renameSync(temp, path)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
  return next
}

export function writeRecording({ record, lanes, root, env, session, exportSession } = {}) {
  if (!record || typeof record !== 'object') throw refusal('There is no run record to turn into a recording.')
  if (typeof root !== 'string' || root.trim() === '') throw refusal('The recording needs the project folder.')
  const { key, lane, harness } = laneOf(lanes, record)
  const logPath = String(record.log ?? '')
  if (!logPath || !existsSync(logPath)) throw refusal('The log for that run is gone.')
  const log = readFileSync(logPath, 'utf8')
  const exportText = harness === 'hermes' ? sessionFor({ lane, key, record, env, session, exportSession }) : ''
  const worktree = String(lane.worktree ?? '')
  if (!worktree) throw refusal(`The lane ${key} has no worktree, so its file list cannot be read.`)
  const ref = commitRef(record)
  const files = gitFiles(worktree, ref)
  const frames = framesFromRun({ harness, log, session: exportText, record })
  const agents = agentsFile(key, lanes)
  const tree = treeFile(worktree, files)
  const { activities } = prepare({ frames, agentsFile: agents, treeFile: tree })
  const toolCalls = activities.filter((activity) => activity.type === 'tool.start').length
  const name = basename(logPath).replace(/\.log$/i, '')
  if (!name) throw refusal('The log for that run has no name to give the recording.')
  const folder = join(root, 'public', 'recordings')
  const runPath = join(folder, `${name}-run.jsonl`)
  const agentsPath = join(folder, `${name}-agents.json`)
  const treePath = join(folder, `${name}-tree.json`)
  try {
    mkdirSync(folder, { recursive: true })
    writeFileSync(runPath, `${frames.map((frame) => JSON.stringify(frame)).join('\n')}\n`)
    writeFileSync(agentsPath, `${JSON.stringify(agents, null, 2)}\n`)
    writeFileSync(treePath, `${JSON.stringify(tree, null, 2)}\n`)
  } catch (error) {
    throw refusal(`The recording could not be written to ${folder}: ${String(error?.message ?? error)}`)
  }
  let indexError = null
  try {
    writeIndex(folder, indexEntry({ name, record, frames: frames.length, toolCalls }))
  } catch (error) {
    indexError = `The index of the recordings could not be written: ${String(error?.message ?? error)}`
  }
  return { name, runPath, agentsPath, treePath, frames: frames.length, toolCalls, indexError }
}
