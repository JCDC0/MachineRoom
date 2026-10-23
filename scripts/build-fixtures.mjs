import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findLeaks } from '../src/briefs/audit.js'
import { gitPath } from '../server/programPath.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const SECRET = /eyJ[A-Za-z0-9_-]{40,}\.|Bearer [A-Za-z0-9._~+/=-]{16,}|xox[bp]-|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/

const ACCOUNT = userInfo().username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const ACCOUNT_PATHS = new RegExp(ACCOUNT, 'gi')
const EMAILS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g

function scrub(value) {
  if (typeof value === 'string') return value.replace(ACCOUNT_PATHS, 'user').replace(EMAILS, 'user')
  if (Array.isArray(value)) return value.map(scrub)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item)]))
  }
  return value
}

function gitList(sandbox, args) {
  return execFileSync(gitPath(), ['-C', sandbox, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

export function fixtureLeak(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    if (findLeaks(lines[index]).some((leak) => leak.kind === 'key')) return index + 1
  }
  return 0
}

export function fixtureNames(outName = 'sandbox') {
  const safeName = outName.replace(/[^A-Za-z0-9._-]/g, '-')
  return {
    run: `${safeName}-run.jsonl`,
    agents: safeName === 'sandbox' ? 'agents.json' : `${safeName}-agents.json`,
    tree: `${safeName}-tree.json`,
  }
}

export function sandboxFiles(sandbox) {
  const tracked = gitList(sandbox, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
  const files = tracked.split('\0').filter(Boolean).sort()
  const first = gitList(sandbox, ['rev-list', '--max-parents=0', 'HEAD']).trim()
  const baselineList = gitList(sandbox, ['ls-tree', '-r', '-z', '--name-only', first])
  const baseline = new Set(baselineList.split('\0').filter(Boolean))
  const created = files.filter((file) => !baseline.has(file))
  return { files, created }
}

function main(argv) {
  const [rawFile, sandbox, idsFile, outName = 'sandbox'] = argv

  if (!rawFile || !sandbox || !idsFile) {
    console.error('usage: npm run fixtures -- <frames-or-raw-events.jsonl> <sandbox-folder> <ids.json> [out-name]')
    return 1
  }

  const names = fixtureNames(outName)

  const frames = readFileSync(rawFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .map((entry) => (entry.kind === undefined ? entry : entry.kind === 'frame' ? JSON.parse(entry.data) : null))
    .filter(Boolean)
    .map(scrub)

  const lines = frames.map((frame) => JSON.stringify(frame))
  const leak = fixtureLeak(lines)
  if (leak !== 0) {
    console.error(`possible key in frame ${leak}; fixture not written`)
    return 2
  }
  const secret = lines.findIndex((line) => SECRET.test(line))
  if (secret !== -1) {
    console.error(`possible secret in frame ${secret + 1}; fixture not written`)
    return 2
  }
  writeFileSync(join(root, 'public', 'fixtures', names.run), lines.join('\n') + '\n')

  const ids = JSON.parse(readFileSync(idsFile, 'utf8').replace(/^\uFEFF/, ''))
  const adapters = { claude: 'claude_local', hermes: 'hermes_local', opencode: 'opencode_local', agy: 'process' }
  const labels = { claude: 'Claude Code', hermes: 'Hermes', opencode: 'OpenCode Go', agy: 'agy' }
  const agents = Object.entries(ids.agents).map(([key, id]) => ({
    id,
    key,
    name: labels[key],
    adapterType: adapters[key],
    parser: key,
  }))
  writeFileSync(join(root, 'public', 'fixtures', names.agents), JSON.stringify({ projectRoot: 'agent-sandbox', agents }, null, 2) + '\n')

  const { files, created } = sandboxFiles(sandbox)
  writeFileSync(join(root, 'public', 'fixtures', names.tree), JSON.stringify({ root: 'agent-sandbox', files, created }, null, 2) + '\n')

  console.log(`frames: ${frames.length}, agents: ${agents.length}, files: ${files.length}, created: ${created.length}`)
  return 0
}

const invoked = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false
if (invoked) process.exitCode = main(process.argv.slice(2))

