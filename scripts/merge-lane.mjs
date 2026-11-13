#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { newestRunFor, parseDiff, unreleasedRange } from '../src/briefs/review.js'
import { readAllRunRecords, runsFile } from '../server/runs.js'
import { killTree, treeSpawnOptions } from '../server/processTree.js'
import { gitPath } from '../server/programPath.js'
import { lanesFolder, readAllLanes, runsFolder } from '../server/lanes-source.js'
import { worktreeFor } from '../src/briefs/run.js'
import { processAlive, readLaneLock } from './lane-lock.mjs'
import { GRADES, recordOutcome } from './outcome.mjs'

export const USAGE = 'Use: npm run merge-lane -- LANE [--finish --subject TEXT --line TEXT --grade G --fixes N [--note TEXT] [--ids A,B] [--trailer TEXT]] | [--abort]'
export const GIT_TIMEOUT_MS = 60 * 1000
export const TEST_TIMEOUT_MS = 10 * 60 * 1000
export const BUILD_TIMEOUT_MS = 5 * 60 * 1000
export const PACK_CHECK_TIMEOUT_MS = 60 * 1000

const OUTPUT_LIMIT = 4 * 1024 * 1024

function samePath(a, b) {
  const left = resolve(a)
  const right = resolve(b)
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

export function parseMergeArgs(argv) {
  const args = Array.isArray(argv) ? argv.map(String) : []
  let abort = false
  let finish = false
  let subject = null
  let line = null
  let grade = null
  let fixes = null
  let note = null
  let ids = null
  let trailer = null
  const positional = []

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--abort') {
      abort = true
    } else if (arg === '--finish') {
      finish = true
    } else if (arg === '--subject' || arg === '--line' || arg === '--grade' || arg === '--fixes' || arg === '--note' || arg === '--ids' || arg === '--trailer') {
      const val = args[i + 1]
      if (val === undefined || val.startsWith('--')) return { error: USAGE }
      if (arg === '--subject') subject = val
      else if (arg === '--line') line = val
      else if (arg === '--grade') grade = val
      else if (arg === '--fixes') fixes = val
      else if (arg === '--note') note = val
      else if (arg === '--ids') ids = val
      else if (arg === '--trailer') trailer = val
      i += 1
    } else if (arg.startsWith('--')) {
      return { error: USAGE }
    } else {
      positional.push(arg.trim())
    }
  }

  if (abort) {
    if (finish || subject !== null || line !== null || grade !== null || fixes !== null) return { error: USAGE }
    return { abort: true, finish: false, lane: positional[0] ?? '' }
  }

  if (positional.length !== 1 || !positional[0]) {
    return { error: USAGE }
  }
  const lane = positional[0]

  if (finish) {
    if (subject === null || line === null || grade === null || fixes === null) {
      return { error: USAGE }
    }
    return {
      finish: true,
      abort: false,
      lane,
      subject,
      line,
      grade,
      fixes,
      note: note ?? '',
      ids: ids ? ids.split(',').map((s) => s.trim()).filter(Boolean) : [],
      trailer: trailer ?? '',
    }
  }

  if (subject !== null || line !== null || grade !== null || fixes !== null || note !== null || ids !== null || trailer !== null) {
    return { error: USAGE }
  }

  return { lane, finish: false, abort: false }
}

export function defaultGitRunner(cwd, args, { timeoutMs = GIT_TIMEOUT_MS, env = process.env } = {}) {
  const result = spawnSync(gitPath(), ['-c', 'core.fsmonitor=false', '-c', 'core.quotepath=off', '-c', 'user.name=MachineRoom', '-c', 'user.email=', ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_MERGE_AUTOEDIT: 'no', ...env },
  })
  const ok = !result.error && result.status === 0
  return {
    ok,
    code: result.status,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? result.error?.message ?? '').trim(),
  }
}

export function defaultRunCommand(command, { cwd, env = process.env, timeoutMs = 60000 } = {}) {
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

export function tailLines(output, count = 40) {
  return String(output ?? '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .slice(-count)
}

export function insertUnreleasedLine(text, line) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const unreleasedIndex = lines.findIndex((l) => /^##\s+Unreleased\s*$/i.test(l))
  if (unreleasedIndex === -1) {
    throw new Error('docs/agents/CHANGELOG.md has no ## Unreleased section.')
  }
  let insertAt = unreleasedIndex + 1
  if (insertAt < lines.length && lines[insertAt].trim() === '') {
    insertAt += 1
  }
  lines.splice(insertAt, 0, `- ${line}`)
  return lines.join(eol)
}

export function branchBroughtUnreleasedLine(root, branch, git = defaultGitRunner) {
  const baseRes = git(root, ['merge-base', 'refs/heads/main', branch])
  const base = (baseRes.stdout ?? '').trim()
  if (!base) return false
  const diffRes = git(root, ['diff', '-U0', base, branch, '--', 'docs/agents/CHANGELOG.md'])
  const diff = diffRes.stdout ?? ''
  if (!diff) return false
  const headRes = git(root, ['show', `${branch}:docs/agents/CHANGELOG.md`])
  const headText = headRes.stdout ?? ''
  const range = unreleasedRange(headText)
  if (!range) return false
  const files = parseDiff(diff)
  const added = files[0]?.added ?? []
  return added.some((item) => item.text.trim() !== '' && item.line >= range.from && item.line <= range.to)
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

function worktreeFromLane(root, lane, info) {
  if (typeof info?.worktree === 'string' && info.worktree.trim() !== '') return resolve(root, info.worktree)
  if (info?.custom === true) return worktreeFor(root, lane)
  return ''
}

export function checkPrerequisites({
  root,
  lane,
  git = defaultGitRunner,
  lanesPath = null,
  runsDir = null,
}) {
  const commonRes = git(root, ['rev-parse', '--git-common-dir'])
  if (!commonRes.ok) return { error: 'Not a git repository.' }
  const gitDirRes = git(root, ['rev-parse', '--git-dir'])
  if (!gitDirRes.ok) return { error: 'Not a git repository.' }
  const common = resolve(root, commonRes.stdout.trim())
  const gitDir = resolve(root, gitDirRes.stdout.trim())
  if (!samePath(common, gitDir) && !samePath(root, dirname(common))) {
    return { error: 'This command must run in the main checkout.' }
  }

  const branchRes = git(root, ['branch', '--show-current'])
  if (!branchRes.ok || branchRes.stdout.trim() !== 'main') {
    return { error: 'The main checkout must be on main.' }
  }

  const mergeHeadRes = git(root, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
  if (mergeHeadRes.ok && mergeHeadRes.stdout.trim() !== '') {
    return { error: 'A merge is already in progress.' }
  }

  const statusRes = git(root, ['status', '--porcelain', '--untracked-files=all'])
  if (!statusRes.ok || statusRes.stdout.trim() !== '') {
    return { error: 'The main checkout has uncommitted changes.' }
  }

  const lanesFile = lanesPath ?? join(lanesFolder(), 'lanes.json')
  let lanesJson = {}
  try {
    lanesJson = JSON.parse(readFileSync(lanesFile, 'utf8'))
  } catch {
    return { error: `${lanesFile} could not be read.` }
  }
  if (!lanesJson || typeof lanesJson !== 'object' || Array.isArray(lanesJson)) {
    return { error: `${lanesFile} could not be read.` }
  }
  const runsDirActual = runsDir ?? runsFolder()
  const lanes = readAllLanes({ lanesJson, runsFolder: runsDirActual })
  if (!Object.hasOwn(lanes, lane)) {
    return { error: `There is no lane named ${lane}.` }
  }

  const info = lanes[lane]
  const worktree = worktreeFromLane(root, lane, info)
  if (!worktree) {
    return { error: `The lane ${lane} has no worktree.` }
  }
  if (!existsSync(worktree)) {
    return { error: `The worktree ${worktree} does not exist.` }
  }
  if (samePath(worktree, root)) {
    return { error: 'The lane worktree is the main checkout.' }
  }

  const wtStatusRes = git(worktree, ['status', '--porcelain', '--untracked-files=all'])
  if (!wtStatusRes.ok || wtStatusRes.stdout.trim() !== '') {
    return { error: `The worktree for ${lane} has uncommitted changes.` }
  }

  const lockPath = join(runsDirActual, `${lane}.lock`)
  if (existsSync(lockPath)) {
    const holder = readLaneLock(lockPath)
    if (processAlive(holder.child) || processAlive(holder.pid)) {
      return { error: `The ${lane} lane has a live run.` }
    }
  }

  const wtBranchRes = git(worktree, ['branch', '--show-current'])
  const laneBranch = (wtBranchRes.stdout ?? '').trim()
  if (!laneBranch) {
    return { error: `The worktree for ${lane} is not on a branch.` }
  }
  if (laneBranch === 'main') {
    return { error: `The worktree for ${lane} is on main.` }
  }

  const headRes = git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${laneBranch}^{commit}`])
  if (!headRes.ok || !headRes.stdout.trim()) {
    return { error: `The branch ${laneBranch} is not in the repository.` }
  }
  const headSha = headRes.stdout.trim()

  const aheadRes = git(root, ['rev-list', '--count', `refs/heads/main..${headSha}`])
  const ahead = Number((aheadRes.stdout ?? '0').trim())
  if (!aheadRes.ok || ahead === 0) {
    return { error: `The branch ${laneBranch} has no commits ahead of main.` }
  }

  return { ok: true, worktree, branch: laneBranch, head: headSha, ahead }
}

export function prepareMerge({
  root,
  lane,
  git = defaultGitRunner,
  lanesPath = null,
  runsDir = null,
}) {
  const prereq = checkPrerequisites({ root, lane, git, lanesPath, runsDir })
  if (prereq.error) return { ok: false, error: prereq.error }

  const mergeRes = git(root, ['merge', '--no-ff', '--no-commit', prereq.head])
  if (!mergeRes.ok) {
    const diffRes = git(root, ['diff', '--name-only', '--diff-filter=U'])
    const conflicts = (diffRes.stdout ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    git(root, ['merge', '--abort'])
    return { ok: false, conflict: true, conflicts, error: 'Merge conflict.' }
  }

  const changedRes = git(root, ['diff', '--cached', '--name-only', '-z'])
  const changedFiles = (changedRes.stdout ?? '').split('\0').filter(Boolean)

  return {
    ok: true,
    lane,
    branch: prereq.branch,
    head: prereq.head,
    changedFiles,
  }
}

export async function runChecks({
  root,
  changedFiles,
  runCommand = defaultRunCommand,
  execPath = process.execPath,
  env = process.env,
  vitestPath = null,
  packCheckPath = null,
  briefsTestPath = null,
}) {
  const actualVitest = vitestPath ?? join(root, 'node_modules', 'vitest', 'vitest.mjs')
  const actualPackCheck = packCheckPath ?? join(root, 'scripts', 'pack-check.mjs')
  const actualBriefsTest = briefsTestPath ?? 'tests/briefs.test.js'
  const npmCli = npmCliPath(env, execPath)

  const checks = []
  const relatedFiles = changedFiles.map((file) => (file.startsWith('-') ? `./${file}` : file))

  checks.push({
    name: 'vitest related',
    command: [execPath, actualVitest, 'related', '--run', ...relatedFiles],
    timeoutMs: TEST_TIMEOUT_MS,
  })

  if (npmCli) {
    checks.push({
      name: 'build',
      command: [execPath, npmCli, 'run', 'build'],
      timeoutMs: BUILD_TIMEOUT_MS,
    })
  } else {
    checks.push({
      name: 'build',
      command: [execPath, join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'],
      timeoutMs: BUILD_TIMEOUT_MS,
    })
  }

  const touchesPack = changedFiles.some(
    (file) => file.startsWith('scripts/') || file.startsWith('bin/') || file.startsWith('server/') || file.startsWith('src/') || file === 'package.json'
  )
  if (touchesPack) {
    checks.push({
      name: 'pack-check',
      command: [execPath, actualPackCheck],
      timeoutMs: PACK_CHECK_TIMEOUT_MS,
    })
  }

  const touchesTasks = changedFiles.some((file) => file === 'docs/agents/TASKS.md')
  if (touchesTasks) {
    checks.push({
      name: 'briefs.test.js',
      command: [execPath, actualVitest, 'run', actualBriefsTest],
      timeoutMs: TEST_TIMEOUT_MS,
    })
  }

  const results = []
  for (const check of checks) {
    const result = await runCommand(check.command, { cwd: root, env, timeoutMs: check.timeoutMs })
    const output = result.output ?? ''
    const ranNothing = output.includes('No changed files found')
    const ok = result.ok && !ranNothing
    results.push({ name: check.name, ok, output })
    if (!ok) break
  }
  return results
}

export async function checkMerge({
  root,
  lane,
  branch,
  changedFiles,
  git = defaultGitRunner,
  runChecksFn = runChecks,
  runCommand = defaultRunCommand,
  runsPath = null,
  execPath = process.execPath,
  env = process.env,
  vitestPath = null,
  packCheckPath = null,
  briefsTestPath = null,
}) {
  const checkResults = await runChecksFn({
    root,
    changedFiles,
    runCommand,
    execPath,
    env,
    vitestPath,
    packCheckPath,
    briefsTestPath,
  })

  const failed = checkResults.find((c) => !c.ok)
  if (failed) {
    const tail = tailLines(failed.output, 40)
    git(root, ['merge', '--abort'])
    return {
      ok: false,
      failed: failed.name,
      tail,
    }
  }

  const records = readAllRunRecords(runsPath ?? runsFile())
  const record = newestRunFor(records, branch)
  const briefIds = Array.isArray(record?.briefs) ? record.briefs.map(String) : []

  const broughtUnreleased = branchBroughtUnreleasedLine(root, branch, git)

  return {
    ok: true,
    lane,
    branch,
    changedFiles,
    checkResults,
    briefIds,
    broughtUnreleased,
  }
}

export function finishMerge({
  root,
  lane,
  subject,
  line,
  grade,
  fixes,
  note = '',
  ids = [],
  trailer = '',
  git = defaultGitRunner,
  outcomesPath = null,
  runsPath = null,
  runsDir = null,
  changelogPath = null,
  packageJsonPath = null,
  lanesPath = null,
}) {
  const mergeHeadRes = git(root, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
  if (!mergeHeadRes.ok || !mergeHeadRes.stdout.trim()) {
    return { ok: false, error: 'No merge is in progress.' }
  }
  const mergeHead = mergeHeadRes.stdout.trim()

  const lanesFile = lanesPath ?? join(lanesFolder(), 'lanes.json')
  let lanesJson = {}
  try {
    lanesJson = JSON.parse(readFileSync(lanesFile, 'utf8'))
  } catch {
    return { ok: false, error: `${lanesFile} could not be read.` }
  }
  if (!lanesJson || typeof lanesJson !== 'object' || Array.isArray(lanesJson)) {
    return { ok: false, error: `${lanesFile} could not be read.` }
  }
  const agentsFolder = runsDir ?? (runsPath ? dirname(resolve(runsPath)) : runsFolder())
  const lanes = readAllLanes({ lanesJson, runsFolder: agentsFolder })
  const info = lanes[lane]
  const worktree = worktreeFromLane(root, lane, info)
  if (!worktree) {
    return { ok: false, error: `The lane ${lane} has no worktree.` }
  }
  const branchRes = git(worktree, ['branch', '--show-current'])
  const branch = (branchRes.stdout ?? '').trim()
  const headRes = git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`])
  const laneHead = (headRes.stdout ?? '').trim()

  if (mergeHead !== laneHead) {
    return { ok: false, error: `The merge in progress is not from ${lane}.` }
  }

  if (line.includes('\u2014') || /[\r\n]/.test(line)) {
    return { ok: false, error: 'The changelog line cannot contain an em dash or a line break.' }
  }

  if (!subject || !subject.trim()) {
    return { ok: false, error: 'A subject is required.' }
  }

  if (subject.includes('\u2014') || /[\r\n]/.test(subject)) {
    return { ok: false, error: 'The subject cannot contain an em dash or a line break.' }
  }

  if (trailer && (trailer.includes('\u2014') || /[\r\n]/.test(trailer))) {
    return { ok: false, error: 'The trailer cannot contain an em dash or a line break.' }
  }

  if (!GRADES.has(grade)) {
    return { ok: false, error: 'The grade must be A+, A, A-, B+, B, B-, C, D or F.' }
  }

  if (fixes === null || fixes === undefined || !/^\d+$/.test(String(fixes)) || Number(fixes) > 50) {
    return { ok: false, error: 'The fixes must be a whole number from 0 to 50.' }
  }

  if (note && (note.length > 200 || /[\r\n]/.test(note))) {
    return { ok: false, error: 'The note must be one line of 200 characters or less.' }
  }

  const clFile = changelogPath ?? join(root, 'docs', 'agents', 'CHANGELOG.md')
  let clText = ''
  try {
    clText = readFileSync(clFile, 'utf8')
  } catch {
    return { ok: false, error: 'docs/agents/CHANGELOG.md could not be read.' }
  }
  const updatedCl = insertUnreleasedLine(clText, line.trim())
  writeFileSync(clFile, updatedCl)

  git(root, ['add', '-u'])
  const docsAgents = join(root, 'docs', 'agents')
  if (existsSync(docsAgents)) {
    git(root, ['add', 'docs/agents/'])
  }

  const pkgFile = packageJsonPath ?? join(root, 'package.json')
  const version = JSON.parse(readFileSync(pkgFile, 'utf8')).version
  let idsList = Array.isArray(ids) ? ids : String(ids).split(',').map((s) => s.trim()).filter(Boolean)
  if (idsList.length === 0) {
    const record = newestRunFor(readAllRunRecords(runsPath ?? runsFile()), branch)
    idsList = Array.isArray(record?.briefs) ? record.briefs.map(String) : []
  }
  const idsText = idsList.join(', ')
  const commitSubject = idsText ? `${version}: Merge ${idsText}, ${subject.trim()}` : `${version}: Merge ${subject.trim()}`
  const commitMessage = trailer && trailer.trim() ? `${commitSubject}\n\n${trailer.trim()}\n` : `${commitSubject}\n`

  const commitRes = git(root, ['commit', '-m', commitMessage])
  if (!commitRes.ok) {
    return { ok: false, error: `Commit failed: ${commitRes.stderr}` }
  }

  recordOutcome({
    branch,
    outcome: 'merged',
    grade,
    fixes: Number(fixes),
    note: note ?? '',
    version,
    outcomesPath,
    runsPath,
    rootDir: root,
  })

  const statusRes = git(root, ['status', '--porcelain', '--untracked-files=all'])
  const isClean = !statusRes.stdout.trim()

  return {
    ok: true,
    branch,
    commitSubject,
    isClean,
  }
}

export function abortMerge({ root, git = defaultGitRunner }) {
  const mergeHeadRes = git(root, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
  if (!mergeHeadRes.ok || !mergeHeadRes.stdout.trim()) {
    return { ok: false, error: 'No merge is in progress.' }
  }
  const abortRes = git(root, ['merge', '--abort'])
  if (!abortRes.ok) {
    return { ok: false, error: `Abort failed: ${abortRes.stderr}` }
  }
  return { ok: true }
}

export async function main(argv, { root = process.cwd(), ...overrides } = {}) {
  const parsed = parseMergeArgs(argv)
  if (parsed.error) {
    console.error(parsed.error)
    return 1
  }

  if (parsed.abort) {
    const result = abortMerge({ root, ...overrides })
    if (!result.ok) {
      console.error(result.error)
      return 1
    }
    console.log('Aborted merge in progress.')
    return 0
  }

  if (parsed.finish) {
    const result = finishMerge({
      root,
      lane: parsed.lane,
      subject: parsed.subject,
      line: parsed.line,
      grade: parsed.grade,
      fixes: parsed.fixes,
      note: parsed.note,
      ids: parsed.ids,
      trailer: parsed.trailer,
      ...overrides,
    })
    if (!result.ok) {
      console.error(result.error)
      return 1
    }
    if (result.isClean) {
      console.log('The checkout is clean.')
    } else {
      console.log('The checkout has uncommitted changes.')
    }
    return 0
  }

  const prep = prepareMerge({ root, lane: parsed.lane, ...overrides })
  if (!prep.ok) {
    if (prep.conflict) {
      for (const file of prep.conflicts) console.error(file)
    } else {
      console.error(prep.error)
    }
    return 1
  }

  const check = await checkMerge({
    root,
    lane: prep.lane,
    branch: prep.branch,
    changedFiles: prep.changedFiles,
    ...overrides,
  })

  if (!check.ok) {
    for (const line of check.tail) console.error(line)
    return 1
  }

  console.log('Changed files:')
  for (const file of check.changedFiles) console.log(`  ${file}`)
  for (const c of check.checkResults) console.log(`PASS ${c.name}`)
  console.log(`Brief ids: ${check.briefIds.length > 0 ? check.briefIds.join(', ') : 'none'}`)
  console.log(`Brought line under ## Unreleased: ${check.broughtUnreleased ? 'yes' : 'no'}`)
  console.log(`Run next: npm run merge-lane -- ${parsed.lane} --finish --subject TEXT --line TEXT --grade G --fixes N`)
  return 0
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
