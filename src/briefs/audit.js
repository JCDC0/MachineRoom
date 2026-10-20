export const LEAK_KINDS = ['key', 'email', 'userpath', 'profile', 'graded']

export const SAMPLE_WIDTH = 80

const SK_TOKEN = /(?<![A-Za-z0-9_-])sk-(?:or-v1-)?\w{20,}/g
const GITHUB_TOKEN = /(?<![A-Za-z0-9_])(?:ghp_|gho_|github_pat_)\w{20,}/g
const AWS_TOKEN = /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}/g
const KEY_SETTING = /(?<![A-Za-z0-9_])(OPENROUTER_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY)(?![A-Za-z0-9_])\s*(?::|=)(?![=>])\s*(['"]?)([^\s'"]*)\2/g
const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g
const USER_PATH = /[A-Za-z]:[\\/]Users[\\/][^\s\\/"'`,;:<>|?*)\]}]+/gi
const GRADED_PATH = /(?<![A-Za-z0-9])coursework(?![A-Za-z0-9])/gi

const PLACEHOLDER = /^(?:your[-_ ]?(?:key|token|api[-_ ]?key).*|your[-_ ]?api.*|x{3,}|changeme|change[-_ ]?me|placeholder|redacted|example.*|todo|none|null|secret|key|\*+|\$\{.*\}|\$[A-Za-z_][A-Za-z0-9_]*)$/i

const ALLOWED_EMAILS = new Set(['noreply@anthropic.com'])
const ALLOWED_EMAIL_DOMAIN = '@users.noreply.github.com'

function isPlaceholder(value) {
  if (value === '') return true
  if (value.startsWith('<')) return true
  if (value.includes('...') || value.includes('…')) return true
  return PLACEHOLDER.test(value)
}

function mask(secret) {
  return `${secret.slice(0, 4)}… (${secret.length} characters)`
}

function windowAround(line, index, length, width = SAMPLE_WIDTH) {
  if (line.length <= width) return line
  const room = Math.max(1, width - Math.min(length, width))
  const want = index - Math.floor(room / 2)
  const start = Math.max(0, Math.min(line.length - width, want))
  const end = Math.min(line.length, start + width)
  let text = line.slice(start, end)
  if (start > 0) text = `…${text.slice(1)}`
  if (end < line.length) text = `${text.slice(0, -1)}…`
  return text
}

function escapeWord(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function eachMatch(re, line, visit) {
  re.lastIndex = 0
  let match
  let seen = 0
  while ((match = re.exec(line)) !== null) {
    if (match[0] === '') {
      re.lastIndex += 1
      continue
    }
    visit(match)
    seen += 1
    if (seen >= 200) return
  }
}

function scanLine(line, profileName) {
  const found = []
  const values = []
  eachMatch(KEY_SETTING, line, (match) => {
    const value = match[3] ?? ''
    if (value === '') return
    const start = match.index + match[0].lastIndexOf(value)
    values.push([start, start + value.length])
    if (isPlaceholder(value)) return
    const masked = `${line.slice(0, start)}${mask(value)}${line.slice(start + value.length)}`
    found.push({ kind: 'key', index: match.index, sample: windowAround(masked, match.index, match[0].length) })
  })
  for (const re of [SK_TOKEN, GITHUB_TOKEN, AWS_TOKEN]) {
    eachMatch(re, line, (match) => {
      const inside = values.some(([start, end]) => match.index >= start && match.index < end)
      if (inside) return
      found.push({ kind: 'key', index: match.index, sample: mask(match[0]) })
    })
  }
  eachMatch(EMAIL, line, (match) => {
    const address = match[0].toLowerCase()
    if (ALLOWED_EMAILS.has(address)) return
    if (address.endsWith(ALLOWED_EMAIL_DOMAIN)) return
    found.push({ kind: 'email', index: match.index, sample: windowAround(line, match.index, match[0].length) })
  })
  eachMatch(USER_PATH, line, (match) => {
    found.push({ kind: 'userpath', index: match.index, sample: windowAround(line, match.index, match[0].length) })
  })
  if (profileName) {
    const profile = new RegExp(`(?<![A-Za-z0-9_])${escapeWord(profileName)}(?![A-Za-z0-9_])`, 'gi')
    eachMatch(profile, line, (match) => {
      found.push({ kind: 'profile', index: match.index, sample: windowAround(line, match.index, match[0].length) })
    })
  }
  eachMatch(GRADED_PATH, line, (match) => {
    found.push({ kind: 'graded', index: match.index, sample: windowAround(line, match.index, match[0].length) })
  })
  found.sort((a, b) => a.index - b.index || LEAK_KINDS.indexOf(a.kind) - LEAK_KINDS.indexOf(b.kind))
  return found
}

export function findLeaks(text, { profileName } = {}) {
  if (typeof text !== 'string' || text === '') return []
  const name = typeof profileName === 'string' ? profileName.trim() : ''
  const lines = text.split(/\r\n|\r|\n/)
  const findings = []
  lines.forEach((line, index) => {
    if (line === '') return
    for (const hit of scanLine(line, name)) findings.push({ kind: hit.kind, line: index + 1, sample: hit.sample })
  })
  return findings
}

export function countLeaks(findings) {
  const counts = {}
  for (const kind of LEAK_KINDS) counts[kind] = 0
  for (const finding of findings) {
    if (Object.hasOwn(counts, finding.kind)) counts[finding.kind] += 1
  }
  return counts
}
