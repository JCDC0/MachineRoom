import { makeTree } from './paths.js'

export const DEFAULTS = { files: 40000, folders: 4000, seed: 20261021, depth: 12, activities: 5000 }

export const WORDS = [
  'src', 'lib', 'core', 'util', 'utils', 'model', 'view', 'views', 'api', 'client', 'server', 'shared', 'common',
  'components', 'pages', 'hooks', 'store', 'state', 'config', 'tests', 'fixtures', 'docs', 'scripts', 'tools',
  'assets', 'images', 'styles', 'types', 'parsers', 'engine', 'render', 'layout', 'auth', 'users', 'billing',
  'reports', 'search', 'cache', 'queue', 'jobs', 'events', 'storage', 'network', 'session', 'admin', 'widgets',
]

export const EXTENSIONS = ['.js', '.ts', '.jsx', '.json', '.md', '.css', '.test.js', '.d.ts', '.py', '.go']

export const AGENTS = [
  { id: 'a1', key: 'claude', name: 'Claude', parser: 'claude' },
  { id: 'a2', key: 'hermes', name: 'Hermes', parser: 'hermes' },
  { id: 'a3', key: 'opencode', name: 'OpenCode', parser: 'opencode' },
]

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

export function uniqueName(taken, base) {
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

export function makeScaleTree({ root = 'scale', files = DEFAULTS.files, folders = DEFAULTS.folders, seed = DEFAULTS.seed, depth = DEFAULTS.depth } = {}) {
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
  return { root, folders: dirs.map((dir) => dir.path), files: paths }
}

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

export function createScaleReplay(n) {
  const scale = makeScaleTree({ files: n, folders: Math.floor(n / 10) })
  const tree = makeTree(scale)
  const activities = scaleActivities(tree)
  return { frames: [], agents: AGENTS, tree, activities }
}
