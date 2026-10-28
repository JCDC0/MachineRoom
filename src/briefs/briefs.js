import { OWNER_ORDER } from '../harnesses/index.js'

const BRIEF_LINE = /^\*\*([A-Z]\d+[a-z]?)\. (.+?)\.\*\*\s*(.*)$/
const OWNER_TAIL = /^(.*?)\s*\(([^()]*)\)$/
const DONE_MARKER = /\b(merged as|built as|done)\b/i
const FILES_MARKER = /\bFiles:/g

function pathLike(value) {
  return /^[A-Za-z]:/.test(value) || value.includes('/') || value.includes('\\') || /\.[A-Za-z0-9]+$/.test(value)
}

export function parseBriefs(markdown) {
  const briefs = []
  let section = ''
  for (const line of String(markdown).replace(/\r\n/g, '\n').split('\n')) {
    const heading = /^##\s+(.*)$/.exec(line)
    if (heading) {
      section = heading[1].trim()
      continue
    }
    const found = BRIEF_LINE.exec(line)
    if (!found) continue
    const [, id, head, text] = found
    const split = OWNER_TAIL.exec(head)
    const title = split ? split[1] : head
    const ownerText = split ? split[2] : ''
    const lower = ownerText.toLowerCase()
    briefs.push({
      id,
      title,
      ownerText,
      owners: OWNER_ORDER.filter((name) => new RegExp(`\\b${name}\\b`).test(lower)),
      done: DONE_MARKER.test(ownerText),
      section,
      text: text.trim(),
    })
  }
  return briefs
}

export function briefFileList(text) {
  const source = String(text ?? '')
  const marker = [...source.matchAll(FILES_MARKER)].pop()
  if (!marker) return []
  const rest = source.slice(marker.index + marker[0].length).replace(/\([^()]*\)/g, ' ')
  const files = []
  for (const part of rest.split(/,|;|\band\b/i)) {
    const first = part.trim().split(/\s+/)[0] ?? ''
    const entry = first.replace(/^`+/, '').replace(/[`.,;:]+$/, '')
    if (!entry || !pathLike(entry) || files.includes(entry)) continue
    files.push(entry)
  }
  return files
}

export function parseRules(markdown) {
  const parts = { about: '', rules: [], report: '' }
  let current = ''
  for (const line of String(markdown).replace(/\r\n/g, '\n').split('\n')) {
    const heading = /^##\s+(.*)$/.exec(line)
    if (heading) {
      current = heading[1].trim().toLowerCase()
      continue
    }
    if (current === 'rules' && line.startsWith('- ')) parts.rules.push(line.slice(2).trim())
    else if (current === 'about' && line.trim()) parts.about += `${parts.about ? ' ' : ''}${line.trim()}`
    else if (current === 'report' && line.trim()) parts.report += `${parts.report ? ' ' : ''}${line.trim()}`
  }
  return parts
}

export function nextVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version).trim())
  if (!match) throw new Error('The version must look like 0.1.35.')
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`
}

export function branchFor(brief) {
  const words = brief.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 3)
    .join('-')
  return `feat/${brief.id.toLowerCase()}-${words}`
}

export function modelFor(lane, briefId) {
  return lane.models?.[briefId] ?? lane.model
}

export function buildPrompt({ briefs, laneKey, lanes, rules, version }) {
  const lane = Object.hasOwn(lanes, laneKey) ? lanes[laneKey] : null
  if (!lane) throw new Error(`There is no lane named ${laneKey}.`)
  if (!Array.isArray(briefs) || briefs.length === 0) throw new Error('Choose at least one brief.')
  const prefix = nextVersion(version)
  const header = modelFor(lane, briefs[0].id)
  const hint = lane.modelHint && header === lane.model ? ` (${lane.modelHint})` : ''
  const reasoning = lane.reasoning ? `, reasoning ${lane.reasoning}` : ''
  const lines = []
  lines.push(`Model to select in ${lane.harness}: ${header}${hint}${reasoning}.`)
  lines.push('')
  lines.push(`You are ${lane.name}, one of the coding agents building MachineRoom in parallel. ${lane.role}`)
  lines.push(`Your worktree is ${lane.worktree}. Run: git switch -c ${branchFor(briefs[0])} refs/heads/main`)
  lines.push('')
  lines.push(rules.about)
  lines.push('')
  lines.push('House rules:')
  for (const rule of rules.rules) lines.push(`- ${rule}`)
  for (const note of lane.notes ?? []) lines.push(`- ${note}`)
  if (lane.forbidden.length) lines.push(`- Do not touch these paths: ${lane.forbidden.join(', ')}. If you need a change there, stop and say so in your report.`)
  lines.push('')
  lines.push('Read first, in this order: AGENTS.md (it points to the real guide), docs/agents/ARCHITECTURE.md, then the brief below in docs/agents/TASKS.md.')
  for (const brief of briefs) {
    const model = modelFor(lane, brief.id)
    lines.push('')
    lines.push(`Task ${brief.id}: ${brief.title}${model !== header ? ` (select ${model} for this task)` : ''}.`)
    lines.push(brief.text)
  }
  lines.push('')
  if (briefs.length === 1) {
    lines.push(`Commit with the prefix ${prefix} and one plain sentence. Do not push.`)
  } else {
    lines.push(`Do the tasks in order. Run npm test and npm run build after each one and commit after each one, with the prefix ${prefix} and one plain sentence. Do not push. Report once, at the end.`)
  }
  lines.push('')
  lines.push(`Report: ${rules.report}`)
  return lines.join('\n')
}
