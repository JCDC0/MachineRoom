import { findLeaks } from './audit.js'
import { parseBriefs } from './briefs.js'
import { pathAllowed } from './plan.js'

export const CHANGELOG = 'docs/agents/CHANGELOG.md'
export const STATUSES = ['PASS', 'WARN', 'FAIL']

const EM_DASH = '\u2014'
const EMOJI = /\p{Extended_Pictographic}/u
const FONT_WEIGHT = /font-?weight\s*:\s*['"]?\s*(bold(?:er)?|\d+)/gi
const FONT_SHORTHAND = /(?<![\w-])font\s*:[^;'"]*\bbold(?:er)?\b/i
const LEAK_FAILS = [['key', 'a key'], ['email', 'an e-mail address'], ['userpath', 'a Windows user path']]
const VERSION_PREFIX = /^\d+\.\d+\.\d+: \S/
const CODE_FILE = /\.(?:m?js|cjs|jsx|tsx?)$/i
const HEURISTIC_DIRS = ['server/', 'scripts/', 'src/']
const BARE_GIT = /\b(?:spawn|spawnSync|execFile|execFileSync)\s*\(\s*(['"`])git\1/
const MAIN_RANGE = /(?<![\w/.-])main\.{2,3}(?!\.)/
const MAIN_IN_ARRAY = /\[[^\]]*(['"`])main\1[^\]]*\]/
const GIT_WORD = /\bgit\b|gitPath|gitRead|gitText|\b(?:rev-parse|rev-list|merge-base|ls-tree|log|show|merge|checkout|switch|worktree|diff)\b/
const GIT_DIFF = /\bgit\s+diff\b|(['"`])diff\1/
const FETCH_CALL = /(?<![\w$])fetch\s*\(/
const LOOKUP = /([A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*)\[([^[\]]+)\]/g
const SOURCE_INDEX = /^(?:req|request|body|query|params|payload|json|parsed|record|input|frame|data|message|event|args|options|url|line|entry|item|row)(?:\?\.|\.)|searchParams\.get\(/
const NAME_INDEX = /^[A-Za-z_$][\w$]*?(?:name|key|type|kind|tool|lane|decision|action|topic|role|harness|adapter|provider|method|route)$/i
const LOOKUP_GUARD = /Object\.hasOwn|hasOwnProperty|\.has\(|\bin\s+[A-Za-z_$]/
const SKIP_OBJECTS = /^(?:process\.env|env|arguments|this)$/

function slash(path) {
  return String(path ?? '').replace(/\\/g, '/')
}

export function foldPath(path) {
  const parts = []
  for (const part of slash(path).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join('/')
}

export function forbiddenHits(paths, forbidden) {
  const rules = (Array.isArray(forbidden) ? forbidden : []).filter((entry) => typeof entry === 'string' && entry.trim() !== '')
  const hits = []
  for (const path of paths) {
    if (pathAllowed(path, rules)) continue
    hits.push({ path, rule: pathAllowed(path, []) ? rules.find((entry) => !pathAllowed(path, [entry])) : null })
  }
  return hits
}

export function briefFiles(text) {
  const found = /\bFiles:\s*(.*)$/s.exec(String(text ?? ''))
  if (!found) return null
  const files = []
  for (const match of found[1].matchAll(/`([^`]+)`/g)) {
    const value = match[1].trim()
    if (value.includes('/') || /\.\w+$/.test(value)) files.push(value)
  }
  return files
}

function globPattern(pattern) {
  const folded = foldPath(pattern.trim())
  if (folded === null) return null
  let source = ''
  for (let index = 0; index < folded.length; index += 1) {
    const char = folded[index]
    if (char === '*' && folded[index + 1] === '*') {
      source += '.*'
      index += 1
    } else if (char === '*') {
      source += '[^/]*'
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${source}$`, 'i')
}

export function unlistedFiles(paths, files) {
  const patterns = (Array.isArray(files) ? files : []).map(globPattern).filter(Boolean)
  return paths.filter((path) => {
    const folded = foldPath(path)
    if (folded === null) return true
    if (folded.toLowerCase() === CHANGELOG.toLowerCase()) return false
    return !patterns.some((pattern) => pattern.test(folded))
  })
}

export function newestRunFor(records, branch) {
  let newest = null
  for (const record of Array.isArray(records) ? records : []) {
    if (record && typeof record === 'object' && record.branch === branch) newest = record
  }
  return newest
}

export function briefCheck({ record, branch, tasksText, paths }) {
  if (!record) {
    return { status: 'WARN', text: `No run record names ${branch}, so the brief's Files: list was not checked.`, details: [], files: null }
  }
  const ids = Array.isArray(record.briefs) ? record.briefs.map(String) : []
  if (ids.length === 0) return { status: 'WARN', text: `The run record for ${branch} names no brief.`, details: [], files: null }
  const briefs = parseBriefs(tasksText ?? '')
  const details = []
  let files = []
  for (const id of ids) {
    const brief = briefs.find((item) => item.id === id)
    if (!brief) {
      details.push({ status: 'WARN', text: `The brief ${id} is not in TASKS.md.` })
      files = null
      continue
    }
    const listed = briefFiles(brief.text)
    if (listed === null) {
      details.push({ status: 'WARN', text: `The brief ${id} has no Files: list.` })
      files = null
      continue
    }
    if (files !== null) files.push(...listed)
  }
  if (files !== null) {
    for (const path of unlistedFiles(paths, files)) details.push({ status: 'WARN', where: path, text: 'not named in the brief' })
  }
  const label = ids.join(' ')
  const status = worst(details)
  const text = status === 'PASS' ? `Every changed file is named in ${label}.` : `Brief ${label}: ${details.length} to read.`
  return { status, text, details, files }
}

export function parseDiff(text) {
  const files = []
  let file = null
  let newLine = 0
  let inHunk = false
  for (const line of String(text ?? '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      file = { path: '', added: [], binary: false }
      files.push(file)
      inHunk = false
      continue
    }
    if (!file) continue
    if (!inHunk && line.startsWith('+++ ')) {
      const target = line.slice(4).replace(/\r$/, '')
      file.path = target === '/dev/null' ? '' : unquote(target).replace(/^b\//, '')
      continue
    }
    if (!inHunk && line.startsWith('--- ')) {
      const source = line.slice(4).replace(/\r$/, '')
      if (source !== '/dev/null' && !file.path) file.oldPath = unquote(source).replace(/^a\//, '')
      continue
    }
    if (!inHunk && line.startsWith('Binary files ')) {
      file.binary = true
      continue
    }
    if (line.startsWith('@@')) {
      const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      newLine = match ? Number(match[1]) : 0
      inHunk = true
      continue
    }
    if (!inHunk) continue
    if (line.startsWith('+')) {
      file.added.push({ line: newLine, text: line.slice(1).replace(/\r$/, '') })
      newLine += 1
    } else if (line.startsWith(' ')) {
      newLine += 1
    }
  }
  return files.filter((item) => item.path !== '' && !item.binary)
}

function unquote(value) {
  const text = value.trim()
  if (!(text.startsWith('"') && text.endsWith('"'))) return text
  const bytes = []
  const body = text.slice(1, -1)
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]
    if (char !== '\\') {
      bytes.push(...Buffer.from(char, 'utf8'))
      continue
    }
    const next = body[index + 1]
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(body.slice(index + 1, index + 4), 8))
      index += 3
      continue
    }
    bytes.push(...Buffer.from({ n: '\n', t: '\t', '"': '"', '\\': '\\' }[next] ?? next, 'utf8'))
    index += 1
  }
  return Buffer.from(bytes).toString('utf8')
}

function heavyWeight(text) {
  for (const match of text.matchAll(FONT_WEIGHT)) {
    const value = match[1].toLowerCase()
    if (value.startsWith('bold') || Number(value) > 500) return true
  }
  return FONT_SHORTHAND.test(text)
}

export function scanAdded(files) {
  const details = []
  for (const file of files) {
    for (const { line, text } of file.added) {
      const where = `${file.path}:${line}`
      if (text.includes(EM_DASH)) details.push({ status: 'FAIL', where, text: 'an em dash' })
      const kinds = new Set(findLeaks(text).map((hit) => hit.kind))
      for (const [kind, label] of LEAK_FAILS) {
        if (kinds.has(kind)) details.push({ status: 'FAIL', where, text: label })
      }
      if (EMOJI.test(text)) details.push({ status: 'WARN', where, text: 'an emoji' })
      if (heavyWeight(text)) details.push({ status: 'WARN', where, text: 'a font weight above 500 or bold' })
    }
  }
  return details
}

function near(added, index, before, after) {
  const center = added[index].line
  return added
    .filter((item) => item.line >= center - before && item.line <= center + after)
    .map((item) => item.text)
    .join('\n')
}

function riskyLookup(text) {
  for (const match of text.matchAll(LOOKUP)) {
    const object = match[1]
    const index = match[2].trim()
    if (SKIP_OBJECTS.test(object)) continue
    if (/^['"`\d-]/.test(index)) continue
    if (SOURCE_INDEX.test(index) || NAME_INDEX.test(index)) return `${object}[${index}]`
  }
  return null
}

export function scanHeuristics(files) {
  const details = []
  for (const file of files) {
    const path = foldPath(file.path) ?? ''
    if (!HEURISTIC_DIRS.some((dir) => path.startsWith(dir))) continue
    if (!CODE_FILE.test(path)) continue
    const inServer = path.startsWith('server/')
    file.added.forEach(({ line, text }, index) => {
      const where = `${file.path}:${line}`
      if (BARE_GIT.test(text)) details.push({ status: 'WARN', where, text: "a bare 'git' passed to a spawn call; use gitPath()" })
      if (MAIN_RANGE.test(text)) details.push({ status: 'WARN', where, text: 'a range that starts at a bare main; use refs/heads/main' })
      if (MAIN_IN_ARRAY.test(text) && GIT_WORD.test(text)) details.push({ status: 'WARN', where, text: "a bare 'main' ref passed to git; use refs/heads/main" })
      if (GIT_DIFF.test(text)) {
        const around = near(file.added, index, 3, 3)
        if (!(around.includes('--no-ext-diff') && around.includes('--no-textconv'))) {
          details.push({ status: 'WARN', where, text: 'git diff without --no-ext-diff and --no-textconv' })
        }
      }
      if (inServer && FETCH_CALL.test(text) && !near(file.added, index, 0, 6).includes('signal')) {
        details.push({ status: 'WARN', where, text: 'a fetch without a signal' })
      }
      const lookup = riskyLookup(text)
      if (lookup && !LOOKUP_GUARD.test(near(file.added, index, 3, 0))) {
        details.push({ status: 'WARN', where, text: `${lookup} without Object.hasOwn` })
      }
    })
  }
  return details
}

function readPackage(text) {
  if (text === null || text === undefined) return {}
  const value = JSON.parse(text)
  return value && typeof value === 'object' ? value : {}
}

function newKeys(before, after, field) {
  const old = before[field] && typeof before[field] === 'object' ? before[field] : {}
  const now = after[field] && typeof after[field] === 'object' ? after[field] : {}
  return Object.keys(now).filter((name) => !Object.hasOwn(old, name))
}

export function packageCheck(baseText, headText) {
  if (baseText === headText) return { status: 'PASS', text: 'package.json is unchanged.', details: [] }
  let before
  let after
  try {
    before = readPackage(baseText)
    after = readPackage(headText)
  } catch {
    return { status: 'FAIL', text: 'package.json on the branch is not valid JSON.', details: [] }
  }
  const details = []
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const name of newKeys(before, after, field)) details.push({ status: 'FAIL', where: name, text: `a new ${field === 'dependencies' ? 'dependency' : field.replace(/ies$/, 'y').replace(/D/, ' d')}` })
  }
  for (const name of newKeys(before, after, 'devDependencies')) details.push({ status: 'WARN', where: name, text: 'a new dev dependency' })
  const status = worst(details)
  return { status, text: status === 'PASS' ? 'package.json adds no dependency.' : `package.json adds ${details.length}.`, details }
}

export function unreleasedRange(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const start = lines.findIndex((line) => /^##\s+Unreleased\s*$/i.test(line))
  if (start < 0) return null
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s/.test(lines[index])) {
      end = index
      break
    }
  }
  return { from: start + 2, to: end }
}

export function changelogCheck({ text, added, files }) {
  const listed = Array.isArray(files) ? files.some((file) => foldPath(file)?.toLowerCase() === CHANGELOG.toLowerCase()) : true
  const range = unreleasedRange(text)
  const inside = range ? (added ?? []).filter((item) => item.text.trim() !== '' && item.line >= range.from && item.line <= range.to) : []
  if (inside.length > 0) return { status: 'PASS', text: `${inside.length} line${inside.length === 1 ? '' : 's'} added under Unreleased.`, details: [] }
  if (!listed) return { status: 'PASS', text: 'The brief does not list the changelog, and none was added.', details: [] }
  return { status: 'FAIL', text: `No line added under ## Unreleased in ${CHANGELOG}.`, details: [] }
}

export function commitCheck(commits) {
  const details = []
  for (const commit of commits) {
    const short = String(commit.sha ?? '').slice(0, 8)
    if (!VERSION_PREFIX.test(commit.subject ?? '')) details.push({ status: 'FAIL', where: short, text: 'no version prefix such as 0.1.101:' })
    if (`${commit.subject ?? ''}\n${commit.body ?? ''}`.includes(EM_DASH)) details.push({ status: 'FAIL', where: short, text: 'an em dash in the message' })
  }
  const status = worst(details)
  const count = `${commits.length} commit${commits.length === 1 ? '' : 's'}`
  return { status, text: status === 'PASS' ? `${count}, each with a version prefix.` : `${count}, ${details.length} problem${details.length === 1 ? '' : 's'}.`, details }
}

export function tasksCheck(text) {
  if (text === null || text === undefined) return { status: 'FAIL', text: 'TASKS.md is missing on the branch.', details: [] }
  const briefs = parseBriefs(text)
  if (briefs.length === 0) return { status: 'FAIL', text: 'TASKS.md holds no brief that parses.', details: [] }
  const seen = new Set()
  const repeated = new Set()
  for (const brief of briefs) {
    if (seen.has(brief.id)) repeated.add(brief.id)
    seen.add(brief.id)
  }
  if (repeated.size > 0) {
    return { status: 'FAIL', text: `TASKS.md repeats ${[...repeated].join(', ')}.`, details: [...repeated].map((id) => ({ status: 'FAIL', where: id, text: 'a repeated brief id' })) }
  }
  return { status: 'PASS', text: `TASKS.md parses: ${briefs.length} briefs, every id unique.`, details: [] }
}

export function parseTestCounts(output) {
  const clean = String(output ?? '').replace(/\x1b\[[0-9;]*m/g, '')
  let last = null
  for (const match of clean.matchAll(/^\s*Tests\s+(.+?)\s+\((\d+)\)\s*$/gm)) last = match
  if (!last) return null
  const counts = { passed: 0, failed: 0, skipped: 0, todo: 0, total: Number(last[2]) }
  for (const part of last[1].split('|')) {
    const found = /(\d+)\s+(passed|failed|skipped|todo)/.exec(part)
    if (found) counts[found[2]] = Number(found[1])
  }
  return counts
}

export function formatCounts(counts) {
  if (!counts) return 'no test counts in the output'
  const parts = [`${counts.passed} passed`]
  if (counts.failed) parts.push(`${counts.failed} failed`)
  if (counts.skipped) parts.push(`${counts.skipped} skipped`)
  if (counts.todo) parts.push(`${counts.todo} todo`)
  return `${parts.join(', ')} of ${counts.total}`
}

export function worst(details) {
  let rank = 0
  for (const detail of details ?? []) rank = Math.max(rank, STATUSES.indexOf(detail.status))
  return STATUSES[rank]
}

export function countStatuses(checks) {
  const counts = { PASS: 0, WARN: 0, FAIL: 0 }
  for (const check of checks) {
    if (Object.hasOwn(counts, check.status)) counts[check.status] += 1
  }
  return counts
}

export function formatReport({ lane, branch, checks }) {
  const width = Math.max(...checks.map((check) => check.name.length))
  const lines = []
  for (const check of checks) {
    lines.push(`${check.status.padEnd(4)}  ${check.name.padEnd(width)}  ${check.text}`)
    for (const detail of check.details ?? []) {
      lines.push(`        ${detail.status}  ${detail.where ? `${detail.where}  ` : ''}${detail.text}`)
    }
  }
  const counts = countStatuses(checks)
  lines.push(`${lane} ${branch || '(no branch)'}: ${counts.PASS} PASS, ${counts.WARN} WARN, ${counts.FAIL} FAIL. A PASS is not a review: read the diff yourself.`)
  return lines.join('\n')
}
