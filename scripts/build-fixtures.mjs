import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const [rawFile, sandbox, idsFile] = process.argv.slice(2)

if (!rawFile || !sandbox || !idsFile) {
  console.error('usage: npm run fixtures -- <raw-events.jsonl> <sandbox-folder> <ids.json>')
  process.exit(1)
}

const SECRET = /eyJ[A-Za-z0-9_-]{40,}\.|\bsk-[A-Za-z0-9]{16,}|Bearer [A-Za-z0-9._~+/=-]{16,}|AIza[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|xox[bp]-|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/

const ACCOUNT = userInfo().username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const ACCOUNT_PATHS = new RegExp(ACCOUNT, 'gi')

function scrub(value) {
  if (typeof value === 'string') return value.replace(ACCOUNT_PATHS, 'user')
  if (Array.isArray(value)) return value.map(scrub)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item)]))
  }
  return value
}

const frames = readFileSync(rawFile, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .filter((entry) => entry.kind === 'frame')
  .map((entry) => scrub(JSON.parse(entry.data)))

const lines = frames.map((frame) => JSON.stringify(frame))
const leak = lines.findIndex((line) => SECRET.test(line))
if (leak !== -1) {
  console.error(`possible secret in frame ${leak + 1}; fixture not written`)
  process.exit(2)
}
writeFileSync(join(root, 'public', 'fixtures', 'sandbox-run.jsonl'), lines.join('\n') + '\n')

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
writeFileSync(join(root, 'public', 'fixtures', 'agents.json'), JSON.stringify({ projectRoot: 'agent-sandbox', agents }, null, 2) + '\n')

const tracked = execFileSync('git', ['-C', sandbox, 'ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
const files = tracked.split(/\r?\n/).filter(Boolean).sort()
const first = execFileSync('git', ['-C', sandbox, 'rev-list', '--max-parents=0', 'HEAD'], { encoding: 'utf8' }).trim()
const baselineList = execFileSync('git', ['-C', sandbox, 'ls-tree', '-r', '--name-only', first], { encoding: 'utf8' })
const baseline = new Set(baselineList.split(/\r?\n/).filter(Boolean))
const created = files.filter((file) => !baseline.has(file))
writeFileSync(join(root, 'public', 'fixtures', 'sandbox-tree.json'), JSON.stringify({ root: 'agent-sandbox', files, created }, null, 2) + '\n')

console.log(`frames: ${frames.length}, agents: ${agents.length}, files: ${files.length}, created: ${created.length}`)
