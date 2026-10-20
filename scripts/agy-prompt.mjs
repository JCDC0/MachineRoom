import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPrompt, parseBriefs, parseRules } from '../src/briefs/briefs.js'
import { briefProblems } from '../src/briefs/run.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const docs = join(root, 'docs', 'agents')
const read = (name) => readFileSync(join(docs, name), 'utf8')

const id = process.argv[2]
if (!id) {
  console.log('Usage: node scripts/agy-prompt.mjs BRIEF_ID [--clean]')
  process.exit(1)
}

const briefs = parseBriefs(read('TASKS.md'))
const lanes = JSON.parse(read('lanes.json'))
const branchExists = (name) =>
  spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], { cwd: root, windowsHide: true }).status === 0
const problems = briefProblems({ briefs, ids: [id], laneKey: 'agy', branchExists, force: false })
if (problems.length > 0) {
  for (const sentence of problems) console.log(sentence)
  process.exit(1)
}

const brief = briefs.find((item) => item.id.toLowerCase() === id.toLowerCase())
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const prompt = buildPrompt({ briefs: [brief], laneKey: 'agy', lanes, rules: parseRules(read('HOUSE-RULES.md')), version })
const worktree = lanes.agy.worktree
if (process.argv.includes('--clean')) {
  for (const name of readdirSync(worktree)) {
    if (/^agy-.*-prompt\.txt$/.test(name)) rmSync(join(worktree, name))
  }
}
const file = join(worktree, `agy-${brief.id}-prompt.txt`)
writeFileSync(file, prompt)
console.log(`Wrote ${file} (${prompt.length} characters).`)
console.log(`When AGY is done: npm run hand-run -- agy ${brief.id} --minutes N`)
