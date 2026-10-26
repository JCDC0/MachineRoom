import { RECORDING_NAME } from '../startup.js'
import { recorderToReplay } from './sessionRecorder.js'
import { parseFrames, prepare } from './source.js'

const INDEX_LIMIT = 50
const READ_FAILED = 'The list of recordings could not be read.'
const FIXTURE_NAME = /^scenario-[a-z]$/
const SANDBOX_FIXTURE = 'sandbox'
const EXPLICIT_REPLAY = ['recording', 'fixture', 'tour', 'scale']

export const DEFAULT_FIXTURE = 'scenario-i'

export function recordedReplayRequested(params) {
  if (!params || typeof params.has !== 'function') return false
  return !EXPLICIT_REPLAY.some((key) => params.has(key))
}

export function recordedReplay(recorder, source = null) {
  const known = source !== null && typeof source === 'object' ? source : {}
  const agents = Array.isArray(known.agents) ? known.agents : []
  const tree = known.tree && Array.isArray(known.tree.files) ? known.tree : null
  const treeFile = tree
    ? { root: tree.rootName ?? tree.root ?? 'room', files: tree.files, created: tree.created ?? [] }
    : { root: 'room', files: [], created: [] }
  return recorderToReplay(recorder, { agentsFile: { agents }, treeFile })
}

async function fetchOk(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response
}

export function fixtureName(fixture) {
  if (fixture === SANDBOX_FIXTURE) return SANDBOX_FIXTURE
  return typeof fixture === 'string' && FIXTURE_NAME.test(fixture) ? fixture : null
}

function fixtureFiles(name) {
  if (name === SANDBOX_FIXTURE) {
    return { run: 'fixtures/sandbox-run.jsonl', agents: 'fixtures/agents.json', tree: 'fixtures/sandbox-tree.json' }
  }
  const stem = `fixtures/${name}`
  return { run: `${stem}-run.jsonl`, agents: `${stem}-agents.json`, tree: `${stem}-tree.json` }
}

export function replayFiles(recording = null, fixture = null) {
  if (!recording) return fixtureFiles(fixtureName(fixture) ?? DEFAULT_FIXTURE)
  const stem = `recordings/${recording}`
  return { run: `${stem}-run.jsonl`, agents: `${stem}-agents.json`, tree: `${stem}-tree.json` }
}

export async function loadReplay({ base = import.meta.env.BASE_URL, recording = null, fixture = null } = {}) {
  const files = replayFiles(recording, fixture)
  try {
    const [run, agents, tree] = await Promise.all([
      fetchOk(`${base}${files.run}`).then((response) => response.text()),
      fetchOk(`${base}${files.agents}`).then((response) => response.json()),
      fetchOk(`${base}${files.tree}`).then((response) => response.json()),
    ])
    const data = prepare({ frames: parseFrames(run), agentsFile: agents, treeFile: tree })
    return recording ? data : { ...data, fixture: fixtureName(fixture) ?? DEFAULT_FIXTURE }
  } catch {
    if (recording) throw new Error(`The recording ${recording} could not be loaded. Make it with npm run run-recording -- <position>, then open the page again.`)
    const chosen = fixtureName(fixture) ?? DEFAULT_FIXTURE
    throw new Error(`The fixture ${chosen} could not be loaded.`)
  }
}

function textOf(value) {
  return typeof value === 'string' ? value : ''
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function briefsOf(value) {
  if (!Array.isArray(value)) return []
  return value.filter((item) => typeof item === 'string')
}

function cleanEntry(item) {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) return null
  if (typeof item.name !== 'string' || !RECORDING_NAME.test(item.name)) return null
  return {
    name: item.name,
    lane: textOf(item.lane),
    briefs: briefsOf(item.briefs),
    model: textOf(item.model),
    start: textOf(item.start),
    minutes: numberOrNull(item.minutes),
    exitCode: numberOrNull(item.exitCode),
    frames: numberOrNull(item.frames),
    toolCalls: numberOrNull(item.toolCalls),
  }
}

export function parseRecordingIndex(raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const entries = []
  for (const item of raw) {
    const entry = cleanEntry(item)
    if (!entry || seen.has(entry.name)) continue
    seen.add(entry.name)
    entries.push(entry)
    if (entries.length >= INDEX_LIMIT) break
  }
  return entries
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function titleOf(lane, briefs) {
  if (!lane) return 'run'
  if (briefs.length === 0) return lane
  return [lane, ...briefs].join(' ')
}

function detailOf(minutes, toolCalls, exitCode) {
  const parts = []
  if (minutes !== null) parts.push(minutes < 1 ? 'under 1 min' : `${Math.round(minutes)} min`)
  if (toolCalls !== null) parts.push(toolCalls === 1 ? '1 tool call' : `${toolCalls} tool calls`)
  if (exitCode !== null) parts.push(exitCode === 0 ? 'finished' : 'failed')
  return parts.join(', ')
}

function whenOf(start) {
  if (!start) return ''
  const date = new Date(start)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

function objectOrEmpty(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export function describeRecording(entry) {
  const item = objectOrEmpty(entry)
  const lane = textOf(item.lane)
  return {
    name: textOf(item.name),
    title: titleOf(lane, briefsOf(item.briefs)),
    detail: detailOf(numberOrNull(item.minutes), numberOrNull(item.toolCalls), numberOrNull(item.exitCode)),
    when: whenOf(textOf(item.start)),
  }
}

export function filterRecordings(entries, options) {
  if (!Array.isArray(entries)) return []
  const { lane, text } = options !== null && typeof options === 'object' ? options : {}
  const wanted = typeof lane === 'string' ? lane : ''
  const needle = typeof text === 'string' ? text.trim().toLowerCase() : ''
  return entries.filter((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false
    if (wanted && textOf(entry.lane) !== wanted) return false
    if (needle) {
      const haystack = [textOf(entry.name), textOf(entry.lane), ...briefsOf(entry.briefs), textOf(entry.model)]
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(needle)) return false
    }
    return true
  })
}

function defaultBase() {
  try {
    const env = import.meta.env
    return env && typeof env.BASE_URL === 'string' ? env.BASE_URL : '/'
  } catch {
    return '/'
  }
}

export async function loadRecordingIndex({ base = defaultBase(), fetchImpl = fetch } = {}) {
  let response
  try {
    response = await fetchImpl(`${base}recordings/index.json`)
  } catch {
    throw new Error(READ_FAILED)
  }
  if (response && response.status === 404) return []
  if (!response || !response.ok) throw new Error(READ_FAILED)
  const type = response.headers?.get?.('content-type') ?? ''
  if (type.includes('text/html')) return []
  let body
  try {
    body = await response.json()
  } catch {
    throw new Error(READ_FAILED)
  }
  return parseRecordingIndex(body)
}
