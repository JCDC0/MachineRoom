#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { maskKeys } from '../src/briefs/audit.js'
import {
  CHANGELOG,
  briefCheck,
  changelogCheck,
  commitCheck,
  countStatuses,
  forbiddenHits,
  formatCounts,
  formatReport,
  newestRunFor,
  packageCheck,
  parseDiff,
  parseTestCounts,
  scanAdded,
  scanHeuristics,
  tasksCheck,
  worst,
} from '../src/briefs/review.js'
import { readAllRunRecords, runsFile } from '../server/runs.js'
import { killTree, treeSpawnOptions } from '../server/processTree.js'
import { gitPath } from '../server/programPath.js'
import { laneEnv } from './candidate.mjs'

export const USAGE = 'Use: npm run review-lane -- LANE [--json] [--keep]'
export const TEST_TIMEOUT_MS = 20 * 60 * 1000
export const BUILD_TIMEOUT_MS = 10 * 60 * 1000
const PLAIN_BRANCH = /^[A-Za-z0-9._][A-Za-z0-9._/-]*$/
const OUTPUT_LIMIT = 2 * 1024 * 1024
const TAIL_LINES = 15

export function parseReviewArgs(argv) {
  const options = { lane: '', json: false, keep: false }
  const positionals = []
  for (const arg of (Array.isArray(argv) ? argv : []).map(String)) {
    if (arg === '--json') options.json = true
    else if (arg === '--keep') options.keep = true
    else if (arg.startsWith('-')) throw new Error(USAGE)
    else if (arg.trim() !== '') positionals.push(arg.trim())
  }
  if (positionals.length !== 1) throw new Error(USAGE)
  options.lane = positionals[0]
  return options
}

function git(cwd, args, extra = {}) {
  const result = spawnSync(gitPath(), ['-c', 'core.fsmonitor=false', '-c', 'core.quotepath=off', ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_MERGE_AUTOEDIT: 'no', ...extra },
  })
  const ok = !result.error && result.status === 0
  return { ok, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? result.error?.message ?? '').trim() }
}

function gitText(cwd, args) {
  const result = git(cwd, args)
  return result.ok ? result.stdout : null
}

export function mainCheckout(from) {
  const common = gitText(from, ['rev-parse', '--git-common-dir'])
  return common ? dirname(resolve(from, common.trim())) : from
}

function samePath(a, b) {
  const left = resolve(a)
  const right = resolve(b)
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

function check(name, status, text, details = []) {
  return { name, status, text, details }
}

function fromResult(name, result) {
  return check(name, result.status, result.text, result.details ?? [])
}

function readOptional(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function npmCliPath(env, execPath) {
  const fromEnv = env.npm_execpath
  if (typeof fromEnv === 'string' && fromEnv.endsWith('.js') && existsSync(fromEnv)) return fromEnv
  const places = [
    join(dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]
  return places.find((place) => existsSync(place)) ?? null
}

function runCommand(command, { cwd, env, timeoutMs }) {
  return new Promise((settle) => {
    const child = spawn(command[0], command.slice(1), {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...treeSpawnOptions(),
    })
    let output = ''
    let timedOut = false
    let settled = false
    const collect = (chunk) => {
      output += chunk.toString('utf8')
      if (output.length > OUTPUT_LIMIT) output = output.slice(-OUTPUT_LIMIT)
    }
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      settle({ ...result, output })
    }
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, timeoutMs)
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.once('error', (error) => finish({ ok: false, code: null, timedOut, error }))
    child.once('close', (code) => finish({ ok: !timedOut && code === 0, code, timedOut, error: null }))
  })
}

function tailLines(output) {
  return maskKeys(output.replace(/\x1b\[[0-9;]*m/g, '')).text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .slice(-TAIL_LINES)
}

function removeLink(link) {
  let stat
  try {
    stat = lstatSync(link)
  } catch {
    return true
  }
  if (!stat.isSymbolicLink()) return false
  try {
    unlinkSync(link)
  } catch {
    return false
  }
  try {
    lstatSync(link)
    return false
  } catch {
    return true
  }
}

export function removeReviewTree({ root, temp, tree }) {
  if (!removeLink(join(tree, 'node_modules'))) return false
  git(tree, ['merge', '--abort'])
  git(root, ['worktree', 'remove', '--force', tree])
  rmSync(temp, { recursive: true, force: true })
  git(root, ['worktree', 'prune'])
  return !existsSync(temp)
}

async function mergedResult({ root, branch, keep, env, execPath, onStep, tempRoot = tmpdir() }) {
  const name = 'merged result'
  const modules = join(root, 'node_modules')
  if (!existsSync(modules)) return check(name, 'FAIL', 'The main checkout has no node_modules. Run npm install there first.')
  const npmCli = npmCliPath(env, execPath)
  if (!npmCli) return check(name, 'FAIL', 'npm-cli.js was not found beside Node, so npm test could not start.')
  const temp = mkdtempSync(join(tempRoot, 'machineroom-review-'))
  const hooks = join(temp, 'hooks')
  const tree = join(temp, 'main')
  mkdirSync(hooks)
  const quiet = ['-c', `core.hooksPath=${hooks.replace(/\\/g, '/')}`]
  let result
  try {
    const added = git(root, [...quiet, 'worktree', 'add', '--detach', tree, 'refs/heads/main'])
    if (!added.ok) {
      result = check(name, 'FAIL', `A worktree of main could not be made: ${added.stderr}`)
    } else {
      const merged = git(tree, [...quiet, '-c', 'user.name=review-lane', '-c', 'user.email=', 'merge', '--no-ff', '--no-commit', `refs/heads/${branch}`])
      if (!merged.ok) {
        const conflicts = (gitText(tree, ['diff', '--no-ext-diff', '--no-textconv', '--name-only', '--diff-filter=U']) ?? '').split('\n').filter(Boolean)
        const details = conflicts.map((file) => ({ status: 'FAIL', where: file, text: 'a merge conflict' }))
        result = check(name, 'FAIL', conflicts.length > 0 ? `${branch} does not merge cleanly into main.` : `The merge failed: ${merged.stderr}`, details)
      } else {
        symlinkSync(modules, join(tree, 'node_modules'), 'junction')
        const childEnv = laneEnv(env)
        onStep(`Running npm test in ${tree}`)
        const test = await runCommand([execPath, npmCli, 'test'], { cwd: tree, env: childEnv, timeoutMs: TEST_TIMEOUT_MS })
        onStep(`Running npm run build in ${tree}`)
        const build = await runCommand([execPath, npmCli, 'run', 'build'], { cwd: tree, env: childEnv, timeoutMs: BUILD_TIMEOUT_MS })
        const counts = parseTestCounts(test.output)
        const testWord = test.ok ? 'passed' : test.timedOut ? 'ran past its time limit' : 'failed'
        const buildWord = build.ok ? 'passed' : build.timedOut ? 'ran past its time limit' : 'failed'
        const details = []
        if (!test.ok) for (const line of tailLines(test.output)) details.push({ status: 'FAIL', where: 'npm test', text: line })
        if (!build.ok) for (const line of tailLines(build.output)) details.push({ status: 'FAIL', where: 'npm run build', text: line })
        result = check(name, test.ok && build.ok ? 'PASS' : 'FAIL', `npm test ${testWord} (${formatCounts(counts)}), npm run build ${buildWord}.`, details)
        result.counts = counts
      }
    }
  } catch (error) {
    result = check(name, 'FAIL', `The merge check stopped: ${error.message}`)
  }
  result.tree = tree
  if (keep) {
    result.details.push({ status: 'PASS', where: tree, text: 'kept (--keep); delete its node_modules link before you remove it' })
    result.kept = tree
  } else if (!removeReviewTree({ root, temp, tree })) {
    result.status = 'FAIL'
    result.details.push({ status: 'FAIL', where: tree, text: 'the temporary worktree could not be removed' })
  }
  return result
}

function commitList(root, range) {
  const text = gitText(root, ['log', '--no-merges', '--format=%H%x1f%s%x1f%b%x1e', range]) ?? ''
  return text
    .split('\x1e')
    .map((entry) => entry.replace(/^\s+/, ''))
    .filter(Boolean)
    .map((entry) => {
      const [sha, subject, body] = entry.split('\x1f')
      return { sha, subject: subject ?? '', body: (body ?? '').trim() }
    })
}

function branchProblem(branch) {
  if (!branch) return 'The lane worktree is not on a branch.'
  if (branch === 'main') return 'The lane worktree is on main.'
  if (!PLAIN_BRANCH.test(branch) || branch.includes('..')) return `The branch name ${branch} is not a plain ref.`
  return null
}

export async function reviewLane({ root, lane, keep = false, env = process.env, runsPath = runsFile(), execPath = process.execPath, onStep = () => {}, tempRoot = tmpdir() }) {
  const docs = join(root, 'docs', 'agents')
  let lanes
  try {
    lanes = JSON.parse(readFileSync(join(docs, 'lanes.json'), 'utf8'))
  } catch {
    return { error: 'docs/agents/lanes.json could not be read.' }
  }
  if (!lanes || typeof lanes !== 'object' || !Object.hasOwn(lanes, lane)) return { error: `There is no lane named ${lane}.` }
  const info = lanes[lane] ?? {}
  const report = { lane, branch: '', worktree: '', checks: [] }
  const stop = (text) => {
    report.checks.push(check('commits', 'FAIL', text))
    return report
  }
  if (typeof info.worktree !== 'string' || info.worktree.trim() === '') return stop(`The lane ${lane} has no worktree in lanes.json.`)
  const worktree = resolve(root, info.worktree)
  report.worktree = worktree
  if (!existsSync(worktree)) return stop(`The worktree ${worktree} does not exist.`)
  if (samePath(worktree, root)) return stop('The lane worktree is the main checkout.')
  const branch = (gitText(worktree, ['branch', '--show-current']) ?? '').trim()
  report.branch = branch
  const problem = branchProblem(branch)
  if (problem) return stop(problem)
  const head = `refs/heads/${branch}`
  if (!git(root, ['rev-parse', '--verify', '--quiet', head]).ok) return stop(`The branch ${branch} is not in the main checkout's repository.`)
  if (!git(root, ['rev-parse', '--verify', '--quiet', 'refs/heads/main']).ok) return stop('The repository has no main branch.')

  const ahead = Number((gitText(root, ['rev-list', '--count', `refs/heads/main..${head}`]) ?? '0').trim())
  const dirty = (gitText(worktree, ['status', '--porcelain', '--untracked-files=all']) ?? '').split('\n').filter((line) => line.trim() !== '')
  const commitDetails = dirty.map((line) => ({ status: 'FAIL', where: line.slice(3), text: 'not committed' }))
  if (ahead === 0) commitDetails.unshift({ status: 'FAIL', text: `${branch} has no commit ahead of main.` })
  report.checks.push(check('commits', worst(commitDetails), `${ahead} commit${ahead === 1 ? '' : 's'} ahead of main, ${dirty.length === 0 ? 'nothing uncommitted' : `${dirty.length} uncommitted`}.`, commitDetails))

  const base = (gitText(root, ['merge-base', 'refs/heads/main', head]) ?? '').trim()
  const diffArgs = ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames']
  const paths = (gitText(root, [...diffArgs, '--name-only', '-z', base, head]) ?? '').split('\0').filter(Boolean)

  const hits = forbiddenHits(paths, info.forbidden)
  report.checks.push(check(
    'paths',
    hits.length > 0 ? 'FAIL' : 'PASS',
    hits.length > 0 ? `${hits.length} changed file${hits.length === 1 ? '' : 's'} outside ${lane}'s paths.` : `${paths.length} changed file${paths.length === 1 ? '' : 's'}, none forbidden for ${lane}.`,
    hits.map((hit) => ({ status: 'FAIL', where: hit.path, text: hit.rule ? `forbidden by ${hit.rule}` : 'outside the project' })),
  ))

  const record = newestRunFor(readAllRunRecords(runsPath), branch)
  const brief = briefCheck({ record, branch, tasksText: readOptional(join(docs, 'TASKS.md')), paths })
  report.checks.push(fromResult('brief', brief))

  const files = parseDiff(gitText(root, [...diffArgs, '-U0', base, head]) ?? '')
  const added = scanAdded(files)
  const addedLines = files.reduce((sum, file) => sum + file.added.length, 0)
  report.checks.push(check(
    'added lines',
    worst(added),
    added.length === 0 ? `${addedLines} added lines, no em dash, key, user path, e-mail address, emoji or bold.` : `${added.length} to read in ${addedLines} added lines.`,
    added,
  ))

  const baseText = gitText(root, ['show', `${base}:package.json`])
  const headText = gitText(root, ['show', `${head}:package.json`])
  report.checks.push(fromResult('package.json', packageCheck(baseText, headText)))

  const risky = scanHeuristics(files)
  report.checks.push(check(
    'heuristics',
    worst(risky),
    risky.length === 0 ? 'No risky pattern in server/, scripts/ or src/. These are heuristics, so read the code anyway.' : `${risky.length} line${risky.length === 1 ? '' : 's'} to read. These are heuristics: each may be fine.`,
    risky,
  ))

  const changelog = files.find((file) => file.path.toLowerCase() === CHANGELOG.toLowerCase())
  report.checks.push(fromResult('changelog', changelogCheck({
    text: gitText(root, ['show', `${head}:${CHANGELOG}`]),
    added: changelog?.added ?? [],
    files: brief.files,
  })))

  report.checks.push(fromResult('commit messages', commitCheck(commitList(root, `refs/heads/main..${head}`))))
  report.checks.push(fromResult('TASKS.md', tasksCheck(gitText(root, ['show', `${head}:docs/agents/TASKS.md`]))))

  if (ahead === 0) report.checks.push(check('merged result', 'FAIL', 'Not run: there is nothing to merge.'))
  else report.checks.push(await mergedResult({ root, branch, keep, env, execPath, onStep, tempRoot }))
  return report
}

export async function main(argv, { root, log = console.log, error = console.error, env = process.env, runsPath = runsFile(), tempRoot = tmpdir() } = {}) {
  let options
  try {
    options = parseReviewArgs(argv)
  } catch (problem) {
    error(problem.message)
    return 1
  }
  const checkout = root ?? mainCheckout(resolve(dirname(fileURLToPath(import.meta.url)), '..'))
  const report = await reviewLane({ root: checkout, lane: options.lane, keep: options.keep, env, runsPath, tempRoot, onStep: options.json ? () => {} : (line) => error(line) })
  if (report.error) {
    error(report.error)
    return 1
  }
  const counts = countStatuses(report.checks)
  if (options.json) log(JSON.stringify({ ...report, counts }, null, 2))
  else log(formatReport(report))
  return counts.FAIL > 0 ? 1 : 0
}

const invoked = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false
if (invoked) process.exitCode = await main(process.argv.slice(2))
