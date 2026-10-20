import { RECORDING_NAME } from '../startup.js'
import { parseFrames, prepare } from './source.js'

const INDEX_LIMIT = 50
const READ_FAILED = 'The list of recordings could not be read.'

async function fetchOk(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response
}

export function replayFiles(recording = null) {
  if (!recording) return { run: 'fixtures/sandbox-run.jsonl', agents: 'fixtures/agents.json', tree: 'fixtures/sandbox-tree.json' }
  const stem = `recordings/${recording}`
  return { run: `${stem}-run.jsonl`, agents: `${stem}-agents.json`, tree: `${stem}-tree.json` }
}

export async function loadReplay({ base = import.meta.env.BASE_URL, recording = null } = {}) {
  const files = replayFiles(recording)
  try {
    const [run, agents, tree] = await Promise.all([
      fetchOk(`${base}${files.run}`).then((response) => response.text()),
      fetchOk(`${base}${files.agents}`).then((response) => response.json()),
      fetchOk(`${base}${files.tree}`).then((response) => response.json()),
    ])
    return prepare({ frames: parseFrames(run), agentsFile: agents, treeFile: tree })
  } catch (error) {
    if (!recording) throw error
    throw new Error(`The recording ${recording} could not be loaded. Make it with npm run run-recording -- <position>, then open the page again.`)
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
