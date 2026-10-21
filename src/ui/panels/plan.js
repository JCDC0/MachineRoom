import { briefMarkdown } from '../../briefs/plan.js'
import { profileFromBrief } from '../../policy/profile.js'
import { OWNER_LABELS } from './briefs.js'

const GOAL_MAX = 2000

function textOf(value) {
  return typeof value === 'string' ? value : ''
}

function listOf(value) {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean)
  }
  return []
}

function briefsOf(answer) {
  const list = answer !== null && typeof answer === 'object' && Array.isArray(answer.briefs) ? answer.briefs : []
  return list.filter((brief) => brief && typeof brief === 'object' && textOf(brief.id).trim())
}

function laneName(owner, lanes) {
  const table = lanes !== null && typeof lanes === 'object' && !Array.isArray(lanes) ? lanes : null
  const entry = table && Object.hasOwn(table, owner) ? table[owner] : null
  if (typeof entry === 'string' && entry.trim()) return entry.trim()
  if (entry !== null && typeof entry === 'object' && typeof entry.name === 'string' && entry.name.trim()) {
    return entry.name.trim()
  }
  if (Object.hasOwn(OWNER_LABELS, owner)) return OWNER_LABELS[owner]
  return owner
}

function laneTable(answer, lanes) {
  const table = {}
  for (const brief of briefsOf(answer)) {
    const owner = textOf(brief.owner).trim()
    if (owner && !Object.hasOwn(table, owner)) table[owner] = { name: laneName(owner, lanes) }
  }
  return table
}

function profileText(brief, lanes) {
  const markdown = briefMarkdown(brief, lanes)
  const tests = listOf(brief.tests)
  if (tests.length === 0 || /\bTests in\b/.test(markdown)) return markdown
  return `${markdown} Tests in ${tests.map((test) => `\`${test}\``).join(', ')}.`
}

export function canAsk(goal) {
  const text = textOf(goal).trim()
  return text.length >= 1 && text.length <= GOAL_MAX
}

export function planRows(answer, lanes) {
  const table = laneTable(answer, lanes)
  return briefsOf(answer).map((brief) => {
    const id = textOf(brief.id).trim()
    const title = textOf(brief.title).trim()
    const owner = textOf(brief.owner).trim()
    const ownerName = laneName(owner, lanes)
    return {
      id,
      title,
      owner,
      ownerName,
      heading: `${id}. ${title} (${ownerName})`,
      size: textOf(brief.size).trim(),
      files: listOf(brief.files),
      tests: listOf(brief.tests),
      profile: profileFromBrief({
        text: profileText(brief, table),
        owners: owner ? [owner] : [],
      }),
    }
  })
}

export function copyText(answer, lanes) {
  const table = laneTable(answer, lanes)
  return briefsOf(answer)
    .map((brief) => briefMarkdown(brief, table))
    .filter(Boolean)
    .join('\n\n')
}

export function copyNote(count) {
  return `Copied ${count} briefs. Paste them into TASKS.md and run the brief tests.`
}
