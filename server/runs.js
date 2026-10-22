import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseBriefs } from '../src/briefs/briefs.js'
import { SINCE_PROBLEM, dayStart, laneStats } from '../src/briefs/run.js'
import { outcomeTable } from './outcomes.js'
import { killTree, treeSpawnOptions } from './processTree.js'

export const RECENT_LIMIT = 20
export const LAST_LINE_LIMIT = 5
export const BRIEF_ID = /^[A-Z]\d+[a-z]?$/

export function runsFile() {
  return join(process.env.TEMP || tmpdir(), 'machineroom-runs', 'runs.jsonl')
}

export function outcomesFile() {
  return join(process.env.TEMP || tmpdir(), 'machineroom-runs', 'outcomes.jsonl')
}

function readJsonLines(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const records = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      records.push(JSON.parse(line))
    } catch {
      continue
    }
  }
  return records
}

export function readRunRecords(file) {
  return readAllRunRecords(file).slice(-RECENT_LIMIT).reverse()
}

export function readAllRunRecords(file) {
  return readJsonLines(file)
}

export function readOutcomeRecords(file) {
  return readJsonLines(file)
}

export function createRunsApi({ projectRoot = '', briefsDir = '', runnerCommand, sendJson, readJsonBody, notify = () => {} }) {
  const resolvedRoot = projectRoot ? resolve(projectRoot) : ''
  const resolvedBriefs = briefsDir ? resolve(briefsDir) : resolvedRoot ? join(resolvedRoot, 'docs', 'agents') : ''
  const command = runnerCommand ?? { file: process.execPath, args: ['scripts/run-lane.mjs'] }
  const running = new Map()
  let stopped = false

  function readText(name) {
    if (!resolvedBriefs) return null
    try {
      return readFileSync(join(resolvedBriefs, name), 'utf8')
    } catch {
      return null
    }
  }

  function snapshot(item) {
    return {
      lane: item.entry.lane,
      briefs: [...item.entry.briefs],
      startedAt: item.entry.startedAt,
      lastLines: [...item.entry.lastLines],
    }
  }

  function finish(item) {
    if (running.get(item.entry.lane) !== item) return
    const tail = item.tail.trim()
    if (tail) {
      item.entry.lastLines.push(tail)
      if (item.entry.lastLines.length > LAST_LINE_LIMIT) item.entry.lastLines.shift()
    }
    running.delete(item.entry.lane)
    if (stopped) return
    notify({ topic: 'runs' })
  }

  function startRun(lane, briefs) {
    const entry = { lane, briefs: [...briefs], startedAt: new Date().toISOString(), lastLines: [] }
    const item = { entry, tail: '' }
    const child = spawn(command.file, [...command.args, lane, ...briefs], {
      cwd: resolvedRoot || undefined,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...treeSpawnOptions(),
    })
    item.child = child
    running.set(lane, item)
    const take = (chunk) => {
      item.tail += chunk.toString('utf8')
      const parts = item.tail.split(/\r?\n/)
      item.tail = parts.pop() ?? ''
      for (const line of parts) {
        entry.lastLines.push(line)
        if (entry.lastLines.length > LAST_LINE_LIMIT) entry.lastLines.shift()
      }
    }
    child.stdout?.on('data', take)
    child.stderr?.on('data', take)
    child.on('error', () => finish(item))
    child.on('close', () => finish(item))
    return entry
  }

  function stopAll() {
    stopped = true
    for (const item of running.values()) {
      if (item.child?.pid) killTree(item.child)
    }
    running.clear()
  }

  async function handle(req, res, url) {
    const path = url.pathname
    const method = req.method ?? 'GET'
    if (path === '/api/control/runs/outcomes') {
      if (method !== 'GET') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      const records = readAllRunRecords(runsFile())
      const outcomes = readOutcomeRecords(outcomesFile())
      sendJson(req, res, 200, { rows: outcomeTable(records, outcomes) })
      return true
    }
    if (path === '/api/control/runs/stats') {
      if (method !== 'GET') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      const since = url.searchParams.get('since')
      if (since !== null && dayStart(since) === null) {
        sendJson(req, res, 400, { error: SINCE_PROBLEM })
        return true
      }
      const records = readAllRunRecords(runsFile())
      sendJson(req, res, 200, laneStats(records, since === null ? {} : { since }))
      return true
    }
    if (path !== '/api/control/runs') return false

    if (method === 'GET') {
      sendJson(req, res, 200, {
        running: [...running.values()].map(snapshot),
        recent: readRunRecords(runsFile()),
      })
      return true
    }

    if (method !== 'POST') {
      sendJson(req, res, 405, { error: 'Method not allowed.' })
      return true
    }

    const body = await readJsonBody(req, res)
    if (body === null) return true

    if (body.confirmed !== true) {
      sendJson(req, res, 400, { error: 'Confirm the run first.' })
      return true
    }

    const lanesText = readText('lanes.json')
    const tasksText = readText('TASKS.md')
    if (lanesText === null || tasksText === null) {
      sendJson(req, res, 404, { error: 'The brief files are missing.' })
      return true
    }

    let lanes
    try {
      lanes = JSON.parse(lanesText)
    } catch {
      lanes = null
    }
    if (!lanes || typeof lanes !== 'object' || Array.isArray(lanes)) {
      sendJson(req, res, 400, { error: 'The lane file is not valid.' })
      return true
    }

    const lane = typeof body.lane === 'string' ? body.lane : ''
    if (!Object.hasOwn(lanes, lane) || !lanes[lane] || typeof lanes[lane] !== 'object') {
      sendJson(req, res, 400, { error: 'Choose a lane from the list.' })
      return true
    }
    if (lanes[lane].retired === true) {
      sendJson(req, res, 400, { error: `The ${lane} lane is retired.` })
      return true
    }
    if (!Object.hasOwn(lanes[lane], 'cli') || !lanes[lane].cli || typeof lanes[lane].cli !== 'object') {
      sendJson(req, res, 400, { error: 'That lane has no command line.' })
      return true
    }

    const briefs = body.briefs
    if (!Array.isArray(briefs) || briefs.length < 1 || briefs.length > 5) {
      sendJson(req, res, 400, { error: 'Choose one to five briefs.' })
      return true
    }
    const known = new Set(parseBriefs(tasksText).map((brief) => brief.id))
    if (briefs.some((id) => typeof id !== 'string' || !BRIEF_ID.test(id) || !known.has(id))) {
      sendJson(req, res, 400, { error: 'Choose a brief from the list.' })
      return true
    }

    if (running.has(lane)) {
      sendJson(req, res, 409, { error: 'That lane is already running.' })
      return true
    }

    let entry
    try {
      entry = startRun(lane, briefs)
    } catch {
      sendJson(req, res, 500, { error: 'The bridge could not start that run.' })
      return true
    }
    notify({ topic: 'runs' })
    sendJson(req, res, 202, entry)
    return true
  }

  return { handle, stopAll }
}
