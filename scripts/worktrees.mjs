#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gitPath } from '../server/programPath.js'

export const USAGE = 'Use: npm run worktrees -- --project FOLDER [--clean] [--json]'
export const GIT_TIMEOUT_MS = 30 * 1000
const BRANCH_PREFIX = 'refs/heads/'
const GIT_MAX_BUFFER = 8 * 1024 * 1024

export function runsFolder(env = process.env) {
  return join(env.TEMP || tmpdir(), 'machineroom-runs')
}

export function parseWorktreesArgs(argv) {
  const options = { project: '', clean: false, json: false, help: false }
  const args = (Array.isArray(argv) ? argv : []).map(String)
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--clean') {
      options.clean = true
      continue
    }
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg === '--project' || arg.startsWith('--project=')) {
      const value = arg === '--project' ? args[index + 1] : arg.slice('--project='.length)
      if (arg === '--project') index += 1
      if (typeof value !== 'string' || value.trim() === '') throw new Error('--project needs a folder.')
      options.project = value
      continue
    }
    if (arg.startsWith('-')) throw new Error(`Unknown option ${arg}.`)
    if (arg.trim() !== '') throw new Error(USAGE)
  }
  if (!options.help && !options.project) throw new Error('--project needs a folder.')
  return options
}

export function parseWorktreeList(text) {
  const entries = []
  let current = null
  const finish = () => {
    if (current && current.path !== '') entries.push(current)
    current = null
  }
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    if (raw.trim() === '') {
      finish()
      continue
    }
    if (!current) {
      current = {
        path: '',
        head: '',
        branch: '',
        detached: false,
        bare: false,
        locked: false,
        lockReason: '',
        prunable: false,
        prunableReason: '',
      }
    }
    const space = raw.indexOf(' ')
    const key = space === -1 ? raw : raw.slice(0, space)
    const value = space === -1 ? '' : raw.slice(space + 1)
    if (key === 'worktree') current.path = value
    else if (key === 'HEAD') current.head = value
    else if (key === 'branch') current.branch = value.startsWith(BRANCH_PREFIX) ? value.slice(BRANCH_PREFIX.length) : value
    else if (key === 'detached') current.detached = true
    else if (key === 'bare') current.bare = true
    else if (key === 'locked') {
      current.locked = true
      current.lockReason = value
    } else if (key === 'prunable') {
      current.prunable = true
      current.prunableReason = value
    }
  }
  finish()
  return entries
}

function folderName(value) {
  const text = String(value ?? '').trim().replace(/[\\/]+$/, '')
  const cut = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'))
  return cut === -1 ? text : text.slice(cut + 1)
}

export function worktreeLane(project, worktree, { platform = process.platform } = {}) {
  const name = folderName(project)
  const folder = folderName(worktree)
  if (!name || !folder) return ''
  const prefix = `${name}-mr-`
  const start = folder.slice(0, prefix.length)
  const matches = platform === 'win32' ? start.toLowerCase() === prefix.toLowerCase() : start === prefix
  if (!matches) return ''
  return folder.slice(prefix.length)
}

export function statusChanges(text) {
  return String(text ?? '').split(/\r?\n/).filter((line) => {
    if (!line.trim()) return false
    const name = line.slice(3).trim().replace(/^"|"$/g, '')
    return !(name === 'node_modules' || name.startsWith('node_modules/') || name.startsWith('node_modules\\'))
  })
}

export function lockHolder(text) {
  const match = /^\s*(\d+)\s*$/.exec(String(text ?? ''))
  if (!match) return null
  const pid = Number(match[1])
  return Number.isInteger(pid) && pid > 0 ? pid : null
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

export function cleanDecision({ dirty = false, ahead = 0, merged = true, running = false, locked = false, prunable = false } = {}) {
  if (running) return { remove: false, reason: 'the lane is running' }
  if (locked) return { remove: false, reason: 'the worktree is locked' }
  if (prunable) return { remove: false, reason: 'the worktree folder is gone' }
  if (dirty) return { remove: false, reason: 'it has uncommitted changes' }
  const count = Number.isFinite(ahead) && ahead > 0 ? Math.floor(ahead) : 0
  if (count > 0) return { remove: false, reason: `it has ${count} ${count === 1 ? 'commit' : 'commits'} not merged` }
  if (!merged) return { remove: false, reason: 'its commits are not merged' }
  return { remove: true, reason: '' }
}

export function worktreeLine(row) {
  const branch = row.branch || 'detached'
  const ahead = Number.isFinite(row.ahead) ? Math.max(0, Math.floor(row.ahead)) : 0
  const dirty = row.dirty ? 'uncommitted changes' : 'clean'
  const merged = row.merged ? 'merged' : 'not merged'
  const parts = [row.lane, row.path, branch, `${ahead} ahead`, dirty, merged]
  if (row.removed) parts.push('removed')
  else if (row.reason) parts.push(`left: ${row.reason}`)
  return parts.join(' | ')
}

function git(cwd, args) {
  const result = spawnSync(gitPath(), ['-c', 'core.fsmonitor=false', '-c', 'core.quotepath=off', ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  if (result.error) return { ok: false, stdout: '', stderr: String(result.error.message ?? result.error) }
  return {
    ok: result.status === 0,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? '').trim(),
  }
}

function readLock(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

function lastLine(text) {
  const lines = String(text ?? '').split(/\r?\n/).filter((line) => line.trim() !== '')
  return lines.length > 0 ? lines[lines.length - 1].trim() : ''
}

export function collectWorktrees({ project, runs = runsFolder(), platform = process.platform } = {}) {
  const folder = resolve(String(project ?? '').trim())
  const list = git(folder, ['worktree', 'list', '--porcelain'])
  if (!list.ok && /not a git repository/i.test(list.stderr)) throw new Error(`${folder} is not a git project.`)
  if (!list.ok) throw new Error(`Git could not list the worktrees of ${folder}: ${lastLine(list.stderr)}`)
  const branch = git(folder, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (!branch.ok) throw new Error(`${folder} is not a git project.`)
  const head = git(folder, ['rev-parse', 'HEAD'])
  if (!head.ok) throw new Error(`${folder} has no commit yet.`)
  const base = head.stdout.trim()
  const rows = []
  for (const entry of parseWorktreeList(list.stdout)) {
    const lane = worktreeLane(folder, entry.path, { platform })
    if (!lane) continue
    const status = git(entry.path, ['status', '--porcelain', '--untracked-files=all'])
    const dirty = !status.ok || statusChanges(status.stdout).length > 0
    const counted = entry.head === '' ? { ok: false, stdout: '' } : git(folder, ['rev-list', '--count', `${base}..${entry.head}`])
    const count = counted.ok ? Number.parseInt(counted.stdout.trim(), 10) : null
    const ahead = Number.isInteger(count) && count > 0 ? count : 0
    const merged = entry.head !== '' && counted.ok && git(folder, ['merge-base', '--is-ancestor', entry.head, base]).ok
    const holder = lockHolder(readLock(join(runs, `${lane}.lock`)))
    const running = holder !== null && processAlive(holder)
    rows.push({
      lane,
      path: resolve(entry.path),
      branch: entry.detached || entry.branch === '' ? 'detached' : entry.branch,
      ahead,
      dirty,
      merged,
      running,
      pid: running ? holder : null,
      locked: entry.locked,
      prunable: entry.prunable,
    })
  }
  rows.sort((left, right) => (left.lane < right.lane ? -1 : left.lane > right.lane ? 1 : 0))
  const current = branch.stdout.trim()
  return { project: folder, branch: current === 'HEAD' ? 'detached' : current, worktrees: rows }
}

function removalReason(row, decision) {
  if (row.running) return `the lane is running (process ${row.pid})`
  return decision.reason
}

export function runWorktrees({ argv = process.argv.slice(2), log = console.log, error = console.error, runs = runsFolder(), platform = process.platform } = {}) {
  let options
  try {
    options = parseWorktreesArgs(argv)
  } catch (problem) {
    error(problem.message)
    return 1
  }
  if (options.help) {
    log(USAGE)
    return 0
  }
  let listed
  try {
    listed = collectWorktrees({ project: options.project, runs, platform })
  } catch (problem) {
    error(problem.message)
    return 1
  }
  const rows = listed.worktrees
  if (options.clean) {
    for (const row of rows) {
      const decision = cleanDecision(row)
      if (!decision.remove) {
        row.reason = removalReason(row, decision)
        continue
      }
      const removed = git(listed.project, ['worktree', 'remove', row.path])
      if (removed.ok) row.removed = true
      else row.reason = `git could not remove it: ${lastLine(removed.stderr)}`
    }
  }
  if (options.json) {
    const removed = rows.filter((row) => row.removed).length
    log(JSON.stringify({ project: listed.project, branch: listed.branch, worktrees: rows, removed }, null, 2))
    return 0
  }
  if (rows.length === 0) {
    log(`No lane worktrees for ${listed.project}.`)
    return 0
  }
  log(`${listed.project} on ${listed.branch}: ${rows.length} lane ${rows.length === 1 ? 'worktree' : 'worktrees'}.`)
  for (const row of rows) log(worktreeLine(row))
  if (options.clean) log(`Removed ${rows.filter((row) => row.removed).length} of ${rows.length}.`)
  return 0
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = runWorktrees()
}
