import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname as folderOf, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'
import { gzip as gzipCallback } from 'node:zlib'
import { FOLDER_SHAPE, packTree, readTree, treeEvent } from '../server/index.js'
import { planFolderView } from '../src/model/folderView.js'
import { dirname, makeTree } from '../src/model/paths.js'
import { createPipeline } from '../src/model/pipeline.js'
import { parseFrames, prepare } from '../src/model/source.js'
import { apply, createState } from '../src/model/state.js'
import { cardPlan, cardSize, overviewSpheres, viewInput, viewKey } from '../src/engine/cards.js'
import { OVERVIEW, fitView, viewBasis } from '../src/engine/camera.js'
import { HUB_CENTER, HUB_RADIUS } from '../src/engine/hub.js'
import { layoutSphere } from '../src/engine/sphere.js'
import {
  AGENTS,
  DEFAULTS,
  EXTENSIONS,
  WORDS,
  makeScaleTree,
  random,
  scaleActivities,
  uniqueName,
} from '../src/model/scaleTree.js'

export {
  AGENTS,
  DEFAULTS,
  EXTENSIONS,
  WORDS,
  makeScaleTree,
  random,
  scaleActivities,
  uniqueName,
}

export const BUDGET = { frame: 16, load: 1000, event: 2 * 1024 * 1024, firstEvent: 1024 * 1024 }
const gzipAsync = promisify(gzipCallback)

export function fakeListDir(rootDir, files) {
  const listing = new Map([[rootDir, new Map()]])
  const entryOf = (name, isDir) => ({ name, isDirectory: () => isDir, isFile: () => !isDir })
  for (const file of files) {
    const parts = file.split('/')
    let at = rootDir
    for (let i = 0; i < parts.length; i += 1) {
      const last = i === parts.length - 1
      const entries = listing.get(at)
      if (!entries.has(parts[i])) entries.set(parts[i], entryOf(parts[i], !last))
      if (last) break
      at = join(at, parts[i])
      if (!listing.has(at)) listing.set(at, new Map())
    }
  }
  return (dir) => {
    const entries = listing.get(dir)
    if (!entries) throw Object.assign(new Error(`ENOENT: ${dir}`), { code: 'ENOENT' })
    return [...entries.values()]
  }
}

export function hermesFrames(tree, { count = 200, seed = DEFAULTS.seed, start = Date.UTC(2026, 9, 21) } = {}) {
  const next = random(seed + 2)
  const pick = (list) => list[Math.floor(next() * list.length)]
  const agentId = AGENTS[1].id
  const runId = 'hermes-scale'
  const at = (i) => new Date(start + i * 1000).toISOString()
  const frames = [{ id: 1, type: 'heartbeat.run.status', createdAt: at(0), payload: { agentId, runId, status: 'running' } }]
  for (let i = 0; i < count; i += 1) {
    const file = pick(tree.files)
    const lines = [`┊ - read  ${file.split('/').pop()}  0.4s`, `┊ - $  cat ${file} | head  0.6s`, `┊ - $  ls ${dirname(file) || '.'}  0.2s`]
    const line = lines[i % lines.length]
    frames.push({ id: i + 2, type: 'heartbeat.run.log', createdAt: at(i + 1), payload: { agentId, runId, stream: 'stdout', seq: i, chunk: `${line}\n` } })
  }
  return frames
}

function median(list) {
  const sorted = [...list].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

export function timeIt(fn, runs = 5) {
  fn()
  const times = []
  let result
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now()
    result = fn()
    times.push(performance.now() - started)
  }
  return { ms: median(times), result }
}

export async function timeItAsync(fn, runs = 5) {
  await fn()
  const times = []
  let result
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now()
    result = await fn()
    times.push(performance.now() - started)
  }
  return { ms: median(times), result }
}

export function perCall(items, fn) {
  let worst = 0
  const started = performance.now()
  for (const item of items) {
    const at = performance.now()
    fn(item)
    worst = Math.max(worst, performance.now() - at)
  }
  const total = performance.now() - started
  return { total, mean: total / Math.max(items.length, 1), worst }
}

export function topCovered(entries, placed, fit) {
  const { back, right, up } = viewBasis(OVERVIEW.yaw, OVERVIEW.pitch)
  const rects = []
  for (const entry of entries) {
    if (entry.path === '' || entry.path.includes('/')) continue
    const at = placed.get(entry.path)
    if (!at) continue
    const relative = { x: at.x - fit.target.x, y: at.y - fit.target.y, z: at.z - fit.target.z }
    const depth = fit.dist - relative.x * back.x - relative.y * back.y - relative.z * back.z
    if (!(depth > 0)) continue
    const scale = 1 / depth
    rects.push({
      x: (relative.x * right.x + relative.y * right.y + relative.z * right.z) * scale,
      y: (relative.x * up.x + relative.y * up.y + relative.z * up.z) * scale,
      width: entry.width * scale,
      height: entry.height * scale,
      depth,
    })
  }
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i]
      const b = rects[j]
      const behind = a.depth <= b.depth ? b : a
      const overlapX = Math.max(0, (a.width + b.width) / 2 - Math.abs(a.x - b.x))
      const overlapY = Math.max(0, (a.height + b.height) / 2 - Math.abs(a.y - b.y))
      const area = behind.width * behind.height
      if (area > 0 && (overlapX * overlapY) / area > 0.7) return true
    }
  }
  return false
}

export function sphereChain(activities, tree, agents = AGENTS, { alwaysDepth = 2 } = {}) {
  const state = createState(tree, agents)
  let homes = new Map()
  let key = ''
  let layouts = 0
  let covered = 0
  let tallest = 0
  const overview = []
  const hub = { x: HUB_CENTER.x, y: HUB_CENTER.y, z: HUB_CENTER.z, r: HUB_RADIUS + 160 }
  for (const activity of activities) {
    apply(state, activity)
    const next = viewKey(state)
    if (next === key) continue
    key = next
    const layout = cardPlan(state, { alwaysDepth, previous: homes })
    const entries = layout.entries
    const placed = layout.placed
    const sizes = new Map(entries.map((entry) => [entry.path, entry]))
    for (const [path, spot] of placed) {
      const size = sizes.get(path)
      homes.set(path, { x: spot.x, y: spot.y, z: spot.z, width: size?.width, height: size?.height })
    }
    layouts += 1
    const fitCards = entries.map((entry) => ({
      path: entry.path,
      home: placed.get(entry.path),
      view: layout.drawn.get(entry.path),
    }))
    const fit = fitView([hub, ...overviewSpheres(fitCards)], { aspect: 1.6 })
    overview.push(fit.dist)
    if (topCovered(entries, placed, fit)) covered += 1
    let low = Infinity
    let high = -Infinity
    for (const entry of entries) {
      const at = placed.get(entry.path)
      if (!at) continue
      low = Math.min(low, at.y - entry.height / 2)
      high = Math.max(high, at.y + entry.height / 2)
    }
    if (high > low) tallest = Math.max(tallest, high - low)
  }
  return {
    layouts,
    covered,
    tallest,
    overviewMedian: overview.length > 0 ? median(overview) : 0,
    overviewLargest: overview.length > 0 ? Math.max(...overview) : 0,
  }
}

export async function runProbe(options = {}) {
  const settings = { ...DEFAULTS, ...options }
  const rows = []
  const row = (stage, runsAt, ms, size = '') => rows.push({ stage, runsAt, ms, budget: runsAt === 'load' ? BUDGET.load : BUDGET.frame, size })

  const scale = makeScaleTree(settings)
  const rootDir = mkdtempSync(join(tmpdir(), `machineroom-scale-probe-${settings.seed}-`))
  let read
  try {
    const listDir = fakeListDir(resolve(rootDir), scale.files)
    read = await timeItAsync(() => readTree(rootDir, { listDir }), 3)
  } finally {
    rmSync(rootDir, { recursive: true, force: true })
  }
  row('readTree (fake listDir)', 'load', read.ms, `${read.result.files.length} files`)
  const sizeRow = (stage, text, budget = BUDGET.event) => {
    const bytes = Buffer.byteLength(text)
    rows.push({ stage, runsAt: 'change', ms: null, budget, size: `${bytes} bytes`, bytes })
  }
  const sizeRowBytes = (stage, bytes, budget = BUDGET.event) => {
    rows.push({ stage, runsAt: 'change', ms: null, budget, size: `${bytes} bytes`, bytes })
  }
  const packed = timeIt(() => packTree(read.result), 3)
  row('packTree', 'load', packed.ms, `${packed.result.folders.length} folders named`)
  sizeRow('tree event, first to a page', treeEvent(read.result, null, FOLDER_SHAPE), BUDGET.firstEvent)
  const folderAnswer = JSON.stringify({ ...packed.result, created: [], version: 1 })
  sizeRow('GET /api/tree, folder shape', folderAnswer, BUDGET.firstEvent)
  const compressed = await gzipAsync(Buffer.from(folderAnswer))
  sizeRowBytes('GET /api/tree, folder shape, gzip', compressed.length, BUDGET.firstEvent)
  const grownTree = { root: read.result.root, files: [...read.result.files, 'probe/new-file.js'].sort() }
  const delta = timeIt(() => treeEvent(grownTree, read.result.files), 3)
  sizeRow('tree event, first with since', delta.result, BUDGET.firstEvent)
  sizeRow('tree event, one new file', delta.result)

  const raw = { root: read.result.root, files: read.result.files, created: [] }
  const made = timeIt(() => makeTree(raw), 3)
  const tree = made.result
  row('makeTree', 'load', made.ms, `${tree.dirs.length} folders`)

  const created = timeIt(() => createState(tree, AGENTS), 3)
  row('createState', 'load', created.ms)

  const activities = scaleActivities(tree, { count: settings.activities, seed: settings.seed })
  const state = createState(tree, AGENTS)
  const applied = perCall(activities, (activity) => apply(state, activity))
  row(`apply ${activities.length} activities (total)`, 'load', applied.total)
  row('apply one activity (mean)', 'activity', applied.mean)
  row('apply one activity (worst)', 'activity', applied.worst)

  const input = timeIt(() => viewInput(state, []), 5)
  row('viewInput', 'frame', input.ms, `${input.result.focus.length} focus paths`)

  const cold = []
  for (let i = 0; i < 3; i += 1) {
    planFolderView({ files: [] })
    const started = performance.now()
    planFolderView(input.result)
    cold.push(performance.now() - started)
  }
  row('planFolderView, first call', 'load', median(cold))
  const plan = timeIt(() => planFolderView(input.result), 5)
  const views = plan.result
  row('planFolderView, 3 agents, same files', 'activity', plan.ms, `${views.length} cards`)
  const grown = Array.from({ length: 5 }, (_, i) => [...input.result.files, ...Array.from({ length: i + 1 }, (_, k) => `probe/new-${k}.js`)])
  planFolderView({ files: [] })
  planFolderView(input.result)
  const added = perCall(grown, (files) => planFolderView({ ...input.result, files }))
  row('planFolderView, one new file', 'activity', added.worst)
  planFolderView({ files: [] })
  planFolderView(input.result)
  let alwaysViews = []
  const addedAlways = perCall(grown, (files) => {
    alwaysViews = planFolderView({ ...input.result, files, alwaysDepth: 2 })
  })
  row('planFolderView, one new file with alwaysDepth 2', 'activity', addedAlways.worst, `${alwaysViews.length} cards, ${alwaysViews.filter((view) => view.pinned).length} pinned`)

  const folderSize = cardSize({ state: 'closed' })
  const sphereFolders = tree.dirs.filter((path) => path === '' || path.split('/').length <= 2)
  const sphereEntries = sphereFolders.map((path) => ({ path, ...folderSize }))
  const sphereCold = timeIt(() => layoutSphere(sphereEntries), 5)
  row('layoutSphere (cold)', 'activity', sphereCold.ms, `${sphereEntries.length} cards`)
  const sphereWarm = timeIt(() => layoutSphere(sphereEntries, { previous: sphereCold.result }), 5)
  row('layoutSphere (warm)', 'activity', sphereWarm.ms)

  const chain = sphereChain(activities.slice(0, 800), tree)
  rows.push({
    stage: 'layoutSphere, covered top cards',
    runsAt: 'chain',
    ms: chain.covered,
    budget: 0,
    size: `${chain.covered} of ${chain.layouts} layouts`,
  })
  rows.push({
    stage: 'layoutSphere, tallest layout',
    runsAt: 'chain',
    ms: chain.tallest,
    budget: null,
    size: `${Math.round(chain.tallest)} units`,
  })
  rows.push({
    stage: 'overview distance',
    runsAt: 'chain',
    ms: chain.overviewMedian,
    budget: null,
    size: `largest ${Math.round(chain.overviewLargest)} units`,
  })

  const frames = hermesFrames(tree, { seed: settings.seed })
  const pipeline = createPipeline({ agents: AGENTS, tree })
  const lines = perCall(frames, (frame) => pipeline.push(frame))
  row('pipeline, Hermes read or shell line (mean)', 'activity', lines.mean)
  row('pipeline, Hermes read or shell line (worst)', 'activity', lines.worst)

  return { settings, scale, rows, treeRoot: rootDir }
}

const PUBLIC_DIR = join(folderOf(fileURLToPath(import.meta.url)), '..', 'public')

export function replaySources(publicDir = PUBLIC_DIR) {
  const out = []
  const add = (name, folder, run, agents, tree) => {
    if ([run, agents, tree].every((file) => existsSync(join(folder, file)))) out.push({ name, folder, run, agents, tree })
  }
  const fixtures = join(publicDir, 'fixtures')
  add('fixtures/sandbox', fixtures, 'sandbox-run.jsonl', 'agents.json', 'sandbox-tree.json')
  const scenarios = existsSync(fixtures) ? readdirSync(fixtures).filter((file) => /^scenario-.+-run\.jsonl$/.test(file)).sort() : []
  for (const file of scenarios) {
    const stem = file.slice(0, -'-run.jsonl'.length)
    add(`fixtures/${stem}`, fixtures, file, `${stem}-agents.json`, `${stem}-tree.json`)
  }
  const recordings = join(publicDir, 'recordings')
  const runs = existsSync(recordings) ? readdirSync(recordings).filter((file) => file.endsWith('-run.jsonl')).sort() : []
  for (const file of runs) {
    const stem = file.slice(0, -'-run.jsonl'.length)
    add(`recordings/${stem}`, recordings, file, `${stem}-agents.json`, `${stem}-tree.json`)
  }
  return out
}

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)

export function replayDigest(source) {
  const read = (file) => readFileSync(join(source.folder, file), 'utf8')
  const { agents, tree, activities } = prepare({ frames: parseFrames(read(source.run)), agentsFile: JSON.parse(read(source.agents)), treeFile: JSON.parse(read(source.tree)) })
  const state = createState(tree, agents)
  const plans = []
  const layouts = []
  let homes = new Map()
  let key = ''
  for (const activity of activities) {
    apply(state, activity)
    const layout = cardPlan(state, { alwaysDepth: 2, previous: homes })
    plans.push(layout.plan)
    const next = viewKey(state)
    if (next === key) continue
    key = next
    const sizes = new Map(layout.entries.map((entry) => [entry.path, entry]))
    for (const [path, spot] of layout.placed) {
      const size = sizes.get(path)
      homes.set(path, { x: spot.x, y: spot.y, z: spot.z, width: size?.width, height: size?.height })
    }
    layouts.push([...layout.placed])
  }
  return {
    name: source.name,
    activities: activities.length,
    plans: plans.length,
    layouts: layouts.length,
    digest: { activities: digest(activities), plans: digest(plans), layouts: digest(layouts) },
  }
}

export function formatRows(rows) {
  const head = ['stage', 'runs per', 'time ms', 'budget', 'size', '']
  const body = rows.map((entry) => {
    const time = entry.ms === null ? '' : entry.ms.toFixed(2)
    const over = entry.ms === null ? entry.bytes > entry.budget : entry.budget !== null && entry.ms > entry.budget
    const budget = entry.ms === null ? `${entry.budget} bytes` : entry.budget === null ? 'info' : `${entry.budget} ms`
    return [entry.stage, entry.runsAt, time, budget, entry.size, over ? 'OVER' : 'ok']
  })
  const widths = head.map((_, i) => Math.max(...[head, ...body].map((line) => line[i].length)))
  return [head, ...body].map((line) => line.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd()).join('\n')
}

export function parseProbeArgs(argv) {
  const out = {}
  const names = { '--files': 'files', '--folders': 'folders', '--seed': 'seed' }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--replay') {
      out.replay = true
      continue
    }
    if (!Object.hasOwn(names, argv[i])) throw new Error(`Unknown option ${argv[i]}. Use --files N, --folders N, --seed N or --replay.`)
    const value = Number(argv[i + 1])
    if (!Number.isInteger(value) || value < 0) throw new Error(`${argv[i]} needs a whole number.`)
    out[names[argv[i]]] = value
    i += 1
  }
  return out
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  try {
    const options = parseProbeArgs(process.argv.slice(2))
    if (options.replay) {
      const results = replaySources().map(replayDigest)
      for (const result of results) console.log(`${result.name}  ${result.activities} activities  ${result.plans} plans  ${result.layouts} layouts  ${Object.entries(result.digest).map(([name, value]) => `${name} ${value}`).join('  ')}`)
      console.log(`${results.length} replays`)
    } else {
      const { settings, rows } = await runProbe(options)
      console.log(`scale probe: ${settings.files} files in ${settings.folders} folders, up to ${settings.depth} deep, seed ${settings.seed}`)
      console.log(formatRows(rows))
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
