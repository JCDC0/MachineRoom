import { OWNER_ORDER } from '../harnesses/index.js'
import { agentDepthLine } from '../model/hierarchy.js'

const BRIEF_LINE = /^\*\*([A-Z]\d+[a-z]?)\. (.+?)\.\*\*\s*(.*)$/
const OWNER_TAIL = /^(.*?)\s*\(([^()]*)\)$/
const DONE_MARKER = /\b(merged as|built as|done)\b/i
const FILES_MARKER = /\bFiles:/g
const FENCE_OPEN = /^[ \t]*(`{3,}|~{3,})(.*)$/
const FENCE_CLOSE = /^[ \t]*(`{3,}|~{3,})[ \t]*$/

function maskFencedBlocks(text) {
  const parts = text.split(/(\r?\n)/)
  for (let i = 0; i < parts.length; i += 2) {
    const open = FENCE_OPEN.exec(parts[i])
    if (!open) continue
    const [, fence, info] = open
    const char = fence[0]
    if (char === '`' && info.includes('`')) continue
    let closeIndex = -1
    for (let j = i + 2; j < parts.length; j += 2) {
      const close = FENCE_CLOSE.exec(parts[j])
      if (close && close[1][0] === char && close[1].length >= fence.length) {
        closeIndex = j
        break
      }
    }
    if (closeIndex === -1) continue
    for (let k = i; k <= closeIndex; k += 2) {
      parts[k] = parts[k].replace(/[^\r\n]/g, ' ')
    }
    i = closeIndex
  }
  return parts.join('')
}

function maskInlineCode(text) {
  const paragraphBreak = /\r?\n[ \t]*\r?\n/y
  const out = []
  let i = 0
  while (i < text.length) {
    const tick = text.indexOf('`', i)
    if (tick === -1) {
      out.push(text.slice(i))
      break
    }
    if (tick > i) out.push(text.slice(i, tick))
    let openEnd = tick
    while (text[openEnd] === '`') openEnd++
    const len = openEnd - tick
    let closeEnd = -1
    let j = openEnd
    while (j < text.length) {
      if (text[j] === '\r' || text[j] === '\n') {
        paragraphBreak.lastIndex = j
        if (paragraphBreak.test(text)) break
        j++
        continue
      }
      if (text[j] === '`') {
        let runEnd = j
        while (text[runEnd] === '`') runEnd++
        if (runEnd - j === len) {
          closeEnd = runEnd
          break
        }
        j = runEnd
        continue
      }
      j++
    }
    if (closeEnd === -1) {
      out.push(text.slice(tick, openEnd))
      i = openEnd
    } else {
      out.push(text.slice(tick, closeEnd).replace(/[^\r\n]/g, ' '))
      i = closeEnd
    }
  }
  return out.join('')
}

function maskCode(text) {
  return maskInlineCode(maskFencedBlocks(text))
}

function pathLike(value) {
  return /^[A-Za-z]:/.test(value) || value.includes('/') || value.includes('\\') || /\.[A-Za-z0-9]+$/.test(value)
}

export function parseBriefs(markdown) {
  const briefs = []
  let section = ''
  let open = null
  const close = () => {
    if (open === null) return
    const { lines, ...brief } = open
    briefs.push({ ...brief, text: lines.join('\n').trim() })
    open = null
  }
  for (const line of String(markdown).replace(/\r\n/g, '\n').split('\n')) {
    const heading = /^##\s+(.*)$/.exec(line)
    if (heading) {
      close()
      section = heading[1].trim()
      continue
    }
    const found = BRIEF_LINE.exec(line)
    if (found) {
      close()
      const [, id, head, text] = found
      const split = OWNER_TAIL.exec(head)
      const title = split ? split[1] : head
      const ownerText = split ? split[2] : ''
      const lower = ownerText.toLowerCase()
      open = {
        id,
        title,
        ownerText,
        owners: OWNER_ORDER.filter((name) => new RegExp(`\\b${name}\\b`).test(lower)),
        done: DONE_MARKER.test(ownerText),
        section,
        lines: [text],
      }
      continue
    }
    if (/^#{1,6}\s/.test(line)) {
      close()
      continue
    }
    if (open !== null) open.lines.push(line)
  }
  close()
  return briefs
}

export function briefFileList(text) {
  const source = String(text ?? '')
  const marker = [...maskCode(source).matchAll(FILES_MARKER)].pop()
  if (!marker) return []
  const span = source.slice(marker.index + marker[0].length).split(/\r?\n\s*\r?\n/)[0] ?? ''
  const rest = span.replace(/\([^()]*\)/g, ' ')
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

export function buildPrompt({ briefs, laneKey, lanes, rules, version, agentDepth = 2, branchSuffix = '' }) {
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
  lines.push(`Your worktree is ${lane.worktree}. Run: git switch -c ${branchFor(briefs[0])}${branchSuffix} refs/heads/main`)
  lines.push('')
  lines.push(rules.about)
  lines.push('')
  lines.push('House rules:')
  for (const rule of rules.rules) lines.push(`- ${rule}`)
  for (const note of lane.notes ?? []) lines.push(`- ${note}`)
  if (lane.forbidden.length) lines.push(`- Do not touch these paths: ${lane.forbidden.join(', ')}. If you need a change there, stop and say so in your report.`)
  lines.push('')
  lines.push(agentDepthLine(agentDepth))
  lines.push('')
  lines.push('Read first, in this order: AGENTS.md (it points to the real guide), docs/agents/ARCHITECTURE.md, then the brief below in docs/agents/TASKS.md. ARCHITECTURE.md is the short core; after it, read only the detail file under docs/agents/architecture/ that your work touches.')
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
    lines.push(`Do the tasks in order. Run the tests for what you changed and npm run build after each one and commit after each one, with the prefix ${prefix} and one plain sentence. Do not push. Report once, at the end.`)
  }
  lines.push('')
  lines.push(`Report: ${rules.report}`)
  return lines.join('\n')
}
