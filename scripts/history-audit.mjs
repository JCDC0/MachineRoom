import { spawn } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { countLeaks, findLeaks, LEAK_KINDS } from '../src/briefs/audit.js'
import { gitPath } from '../server/programPath.js'

const MAX_FILE_BYTES = 2 * 1024 * 1024
const TRACKED = '(tracked)'
const HISTORY_ARGS = ['log', '-p', '--no-color', '--no-ext-diff', '--no-textconv', 'refs/heads/main', '--tags']

export function parseAuditArgs(argv) {
  const options = { json: false, from: '' }
  const args = (Array.isArray(argv) ? argv : []).map(String)
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (arg === '--from') {
      const value = args[index + 1]
      if (value === undefined || value === '' || value.startsWith('-')) throw new Error('--from needs a commit.')
      options.from = value
      index += 1
      continue
    }
    if (arg.startsWith('--from=')) {
      options.from = arg.slice('--from='.length)
      if (options.from === '') throw new Error('--from needs a commit.')
      continue
    }
    throw new Error(`Unknown option: ${arg}`)
  }
  return options
}

export function historyArgsFrom(commit) {
  if (commit === '') return [...HISTORY_ARGS]
  return ['log', '-p', '--no-color', '--no-ext-diff', '--no-textconv', `${commit}..HEAD`]
}

function runGit(repo, args) {
  return new Promise((done, fail) => {
    const child = spawn(gitPath(), args, { cwd: repo, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks = []
    let error = ''
    child.stdout.on('data', (chunk) => chunks.push(chunk))
    child.stderr.on('data', (chunk) => { error += chunk })
    child.on('error', fail)
    child.on('close', (code) => done({ code, stdout: Buffer.concat(chunks), stderr: error }))
  })
}

function unquote(value) {
  const text = value.trim()
  if (text.startsWith('"') && text.endsWith('"')) return text.slice(1, -1).replace(/\\(.)/g, '$1')
  return text
}

function fileFromDiff(line) {
  const rest = line.slice('diff --git '.length)
  const cut = rest.lastIndexOf(' b/')
  return unquote(cut > 0 ? rest.slice(cut + 3) : rest)
}

function hunkStart(line) {
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
  if (!match) return { oldLine: 0, newLine: 0 }
  return { oldLine: Number(match[1]), newLine: Number(match[2]) }
}

async function readHistory(repo, args, profileName, findings, { removed = true } = {}) {
  const child = spawn(gitPath(), args, { cwd: repo, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let error = ''
  child.stderr.on('data', (chunk) => { error += chunk })
  const closed = new Promise((done) => {
    child.on('error', (problem) => done({ code: 1, stderr: String(problem?.message ?? problem) }))
    child.on('close', (code) => done({ code, stderr: error }))
  })
  const reader = createInterface({ input: child.stdout, crlfDelay: Infinity })
  let commit = null
  let file = null
  let oldLine = 0
  let newLine = 0
  let inHunk = false
  let messageLine = 0
  const add = (text, line, where) => {
    for (const hit of findLeaks(text, { profileName })) {
      findings.push({ kind: hit.kind, commit, file: where, line, sample: hit.sample })
    }
  }
  for await (const line of reader) {
    if (line.startsWith('diff --git ')) {
      inHunk = false
      messageLine = 0
      file = fileFromDiff(line)
      add(file, 1, '(path)')
      continue
    }
    if (line.startsWith('@@')) {
      const start = hunkStart(line)
      oldLine = start.oldLine
      newLine = start.newLine
      inHunk = true
      messageLine = 0
      continue
    }
    if (inHunk) {
      if (line.startsWith('+')) {
        add(line.slice(1), newLine, file)
        newLine += 1
        continue
      }
      if (line.startsWith('-')) {
        if (removed) add(line.slice(1), oldLine, file)
        oldLine += 1
        continue
      }
      if (line.startsWith('\\')) continue
      if (line.startsWith(' ') || line === '') {
        oldLine += 1
        newLine += 1
        continue
      }
      inHunk = false
    }
    if (line.startsWith('commit ')) {
      commit = line.slice('commit '.length).trim().split(/\s+/)[0] || null
      messageLine = 0
      continue
    }
    if (line.startsWith('Author: ')) {
      add(line.slice('Author: '.length), 1, '(author)')
      continue
    }
    if (line.startsWith('    ')) {
      messageLine += 1
      add(line.slice(4), messageLine, '(message)')
    }
  }
  return closed
}

function readTracked(repo, profileName, findings) {
  return runGit(repo, ['ls-files', '-z']).then((result) => {
    if (result.code !== 0) return result
    const names = result.stdout.toString('utf8').split('\0').filter((name) => name !== '')
    for (const name of names) {
      const full = join(repo, name)
      let size = 0
      try {
        size = statSync(full).size
      } catch {
        continue
      }
      if (size === 0 || size > MAX_FILE_BYTES) continue
      let text = ''
      try {
        text = readFileSync(full, 'utf8')
      } catch {
        continue
      }
      if (text.includes('\0')) continue
      for (const hit of findLeaks(text, { profileName })) {
        findings.push({ kind: hit.kind, commit: null, file: name, line: hit.line, sample: hit.sample })
      }
    }
    return result
  })
}

function textReport(repo, findings, counts, from) {
  const where = from === '' ? 'main and its tags' : `${from.slice(0, 7)}..HEAD`
  const lines = [`History audit of ${where} in ${repo}`, '']
  for (const kind of LEAK_KINDS) {
    const rows = findings.filter((finding) => finding.kind === kind)
    lines.push(kind)
    if (rows.length === 0) lines.push('  none')
    for (const row of rows) lines.push(`  ${row.commit ?? TRACKED} ${row.file}:${row.line}  ${row.sample}`)
    lines.push('')
  }
  lines.push('counts')
  for (const kind of LEAK_KINDS) lines.push(`  ${kind} ${counts[kind]}`)
  return lines.join('\n')
}

async function resolveCommit(repo, name) {
  const result = await runGit(repo, ['rev-parse', '--verify', '--quiet', `${name}^{commit}`])
  if (result.code !== 0) return ''
  return result.stdout.toString('utf8').trim()
}

async function main() {
  const repo = process.cwd()
  const profileName = userInfo().username
  let options
  try {
    options = parseAuditArgs(process.argv.slice(2))
  } catch (problem) {
    process.stderr.write(`${problem?.message ?? problem}\n`)
    process.exitCode = 1
    return
  }
  const findings = []
  let from = ''
  if (options.from !== '') {
    from = await resolveCommit(repo, options.from)
    if (from === '') {
      process.stderr.write(`The audit could not read the commit ${options.from}.\n`)
      process.exitCode = 1
      return
    }
  }
  const history = await readHistory(repo, historyArgsFrom(from), profileName, findings, { removed: from === '' })
  if (history.code !== 0) {
    process.stderr.write(`The history could not be read. ${history.stderr.trim() || 'git log failed.'}\n`)
    process.exitCode = 1
    return
  }
  if (from === '') {
    const tracked = await readTracked(repo, profileName, findings)
    if (tracked.code !== 0) {
      process.stderr.write(`The tracked files could not be listed. ${tracked.stderr.trim() || 'git ls-files failed.'}\n`)
      process.exitCode = 1
      return
    }
  }
  const counts = countLeaks(findings)
  if (options.json) process.stdout.write(`${JSON.stringify({ findings, counts }, null, 2)}\n`)
  else process.stdout.write(`${textReport(repo, findings, counts, from)}\n`)
  process.exitCode = findings.length > 0 ? 1 : 0
}

main().catch((problem) => {
  process.stderr.write(`The audit stopped. ${problem?.message ?? problem}\n`)
  process.exitCode = 1
})
