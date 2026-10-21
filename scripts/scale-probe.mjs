import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname as folderOf, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { FOLDER_SHAPE, packTree, readTree, treeEvent } from '../server/index.js'
import { planCollapse } from '../src/model/collapse.js'
import { planFolderView } from '../src/model/folderView.js'
import { ancestors, dirname, makeTree } from '../src/model/paths.js'
import { createPipeline } from '../src/model/pipeline.js'
import { parseFrames, prepare } from '../src/model/source.js'
import { apply, createState } from '../src/model/state.js'
import { cardSize, viewInput } from '../src/engine/cards.js'
import { layoutCards } from '../src/engine/layout.js'

export const DEFAULTS = { files: 40000, folders: 4000, seed: 20261021, depth: 12, activities: 5000 }
export const BUDGET = { frame: 16, load: 1000, event: 2 * 1024 * 1024, firstEvent: 1024 * 1024 }

const WORDS = [
  'src', 'lib', 'core', 'util', 'utils', 'model', 'view', 'views', 'api', 'client', 'server', 'shared', 'common',
  'components', 'pages', 'hooks', 'store', 'state', 'config', 'tests', 'fixtures', 'docs', 'scripts', 'tools',
  'assets', 'images', 'styles', 'types', 'parsers', 'engine', 'render', 'layout', 'auth', 'users', 'billing',
  'reports', 'search', 'cache', 'queue', 'jobs', 'events', 'storage', 'network', 'session', 'admin', 'widgets',
]
const EXTENSIONS = ['.js', '.ts', '.jsx', '.json', '.md', '.css', '.test.js', '.d.ts', '.py', '.go']

export function random(seed) {
  let value = seed >>> 0
  return () => {
    value = (value + 0x6d2b79f5) >>> 0
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function uniqueName(taken, base) {
  if (!taken.has(base)) {
    taken.add(base)
    return base
  }
  for (let n = 2; ; n += 1) {
    const name = base.replace(/(\.[a-z.]+)?$/, (ext) => `-${n}${ext}`)
    if (!taken.has(name)) {
      taken.add(name)
      return name
    }
  }
}

export function makeScaleTree({ files = DEFAULTS.files, folders = DEFAULTS.folders, seed = DEFAULTS.seed, depth = DEFAULTS.depth } = {}) {
  const next = random(seed)
  const pick = (list) => list[Math.floor(next() * list.length)]
  const dirs = [{ path: '', depth: 0, names: new Set() }]
  const open = [dirs[0]]
  for (let i = 0; i < folders; i += 1) {
    const parent = pick(open)
    const name = uniqueName(parent.names, pick(WORDS))
    const dir = { path: parent.path ? `${parent.path}/${name}` : name, depth: parent.depth + 1, names: new Set() }
    dirs.push(dir)
    if (dir.depth < depth) open.push(dir)
  }
  const paths = []
  for (let i = 0; i < files; i += 1) {
    const dir = pick(dirs)
    const name = uniqueName(dir.names, `${pick(WORDS)}${pick(EXTENSIONS)}`)
    paths.push(dir.path ? `${dir.path}/${name}` : name)
  }
  return { folders: dirs.map((dir) => dir.path), files: paths }
}

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

const AGENTS = [
  { id: 'a1', key: 'claude', name: 'Claude', parser: 'claude' },
  { id: 'a2', key: 'hermes', name: 'Hermes', parser: 'hermes' },
  { id: 'a3', key: 'opencode', name: 'OpenCode', parser: 'opencode' },
]

export function scaleActivities(tree, { count = DEFAULTS.activities, seed = DEFAULTS.seed, start = Date.UTC(2026, 9, 21) } = {}) {
  const next = random(seed + 1)
  const pick = (list) => list[Math.floor(next() * list.length)]
  const out = []
  let time = start
  let order = 0
  const runs = new Map()
  const push = (agent, activity) => {
    time += 50 + Math.floor(next() * 400)
    out.push({ time, agent: agent.key, runId: runs.get(agent.key), order: (order += 1), ...activity })
  }
  for (const agent of AGENTS) {
    runs.set(agent.key, `${agent.key}-run-1`)
    push(agent, { type: 'run.start' })
  }
  let calls = 0
  while (out.length < count - AGENTS.length) {
    const agent = pick(AGENTS)
    const roll = next()
    if (roll < 0.02) {
      const ok = next() > 0.2
      push(agent, { type: 'run.end', ok, error: ok ? null : 'failed' })
      runs.set(agent.key, `${agent.key}-run-${out.length}`)
      push(agent, { type: 'run.start' })
      continue
    }
    const file = pick(tree.files)
    const mode = roll < 0.75 ? 'read' : 'write'
    const id = `call-${(calls += 1)}`
    push(agent, { type: 'tool.start', id, tool: mode, label: `${mode} ${file}`, touches: [{ path: file, mode, kind: 'file' }] })
    push(agent, { type: 'tool.end', id, ok: next() > 0.05 })
  }
  for (const agent of AGENTS) push(agent, { type: 'run.end', ok: true, error: null })
  return out
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

export function runProbe(options = {}) {
  const settings = { ...DEFAULTS, ...options }
  const rows = []
  const row = (stage, runsAt, ms, size = '') => rows.push({ stage, runsAt, ms, budget: runsAt === 'load' ? BUDGET.load : BUDGET.frame, size })

  const scale = makeScaleTree(settings)
  const rootDir = join(tmpdir(), `machineroom-scale-probe-${settings.seed}-not-there`)
  const listDir = fakeListDir(resolve(rootDir), scale.files)
  const read = timeIt(() => readTree(rootDir, { listDir }), 3)
  row('readTree (fake listDir)', 'load', read.ms, `${read.result.files.length} files`)
  const sizeRow = (stage, text, budget = BUDGET.event) => {
    const bytes = Buffer.byteLength(text)
    rows.push({ stage, runsAt: 'change', ms: null, budget, size: `${bytes} bytes`, bytes })
  }
  const packed = timeIt(() => packTree(read.result), 3)
  row('packTree', 'load', packed.ms, `${packed.result.folders.length} folders named`)
  sizeRow('tree event, first to a page', treeEvent(read.result, null, FOLDER_SHAPE), BUDGET.firstEvent)
  sizeRow('GET /api/tree, folder shape', JSON.stringify({ ...packed.result, created: [] }), BUDGET.firstEvent)
  const grownTree = { root: read.result.root, files: [...read.result.files, 'probe/new-file.js'].sort() }
  const delta = timeIt(() => treeEvent(grownTree, read.result.files), 3)
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
  const added = perCall(grown, (files) => planFolderView({ ...input.result, files }))
  row('planFolderView, one new file', 'activity', added.worst)

  const entries = views.map((view) => ({ path: view.path, ...cardSize(view) }))
  const first = timeIt(() => layoutCards(entries, null), 5)
  row('layoutCards (cold)', 'activity', first.ms, `${entries.length} cards`)
  const warm = timeIt(() => layoutCards(entries, first.result), 5)
  row('layoutCards (warm)', 'activity', warm.ms)

  const fileCounts = new Map()
  for (const file of tree.files) fileCounts.set(dirname(file), (fileCounts.get(dirname(file)) ?? 0) + 1)
  const hot = [...new Set([...state.agents.values()].flatMap((agent) => agent.focus).flatMap((path) => [...ancestors(path), dirname(path)]))]
  const collapse = timeIt(() => planCollapse({ folders: tree.dirs, fileCounts, hot }), 5)
  row('planCollapse', 'activity', collapse.ms, `${collapse.result.visible.length + collapse.result.collapsed.length} tiles`)

  const frames = hermesFrames(tree, { seed: settings.seed })
  const pipeline = createPipeline({ agents: AGENTS, tree })
  const lines = perCall(frames, (frame) => pipeline.push(frame))
  row('pipeline, Hermes read or shell line (mean)', 'activity', lines.mean)
  row('pipeline, Hermes read or shell line (worst)', 'activity', lines.worst)

  return { settings, scale, rows }
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
  const collapses = []
  let homes = new Map()
  let key = ''
  for (const activity of activities) {
    apply(state, activity)
    const input = viewInput(state, [])
    const views = planFolderView(input)
    plans.push(views)
    const next = `${input.files.length}|${input.focus.join('\n')}|${input.touched.join('\n')}`
    if (next === key) continue
    key = next
    const placed = layoutCards(views.map((view) => ({ path: view.path, ...cardSize(view) })), homes)
    homes = new Map([...homes, ...placed])
    layouts.push([...placed])
    const fileCounts = new Map()
    for (const file of state.files.values()) fileCounts.set(dirname(file.path), (fileCounts.get(dirname(file.path)) ?? 0) + 1)
    const hot = [...state.agents.values()].flatMap((agent) => agent.focus).map((path) => (state.files.has(path) ? dirname(path) : path))
    collapses.push(planCollapse({ folders: [...state.dirs.keys()], fileCounts, hot, maxTiles: 12 }))
  }
  return {
    name: source.name,
    activities: activities.length,
    plans: plans.length,
    layouts: layouts.length,
    digest: { activities: digest(activities), plans: digest(plans), layouts: digest(layouts), collapses: digest(collapses) },
  }
}

export function formatRows(rows) {
  const head = ['stage', 'runs per', 'time ms', 'budget', 'size', '']
  const body = rows.map((entry) => {
    const time = entry.ms === null ? '' : entry.ms.toFixed(2)
    const over = entry.ms === null ? entry.bytes > entry.budget : entry.ms > entry.budget
    const budget = entry.ms === null ? `${entry.budget} bytes` : `${entry.budget} ms`
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
      const { settings, rows } = runProbe(options)
      console.log(`scale probe: ${settings.files} files in ${settings.folders} folders, up to ${settings.depth} deep, seed ${settings.seed}`)
      console.log(formatRows(rows))
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
