export const TASK_STATE_LIMIT = 20

function lines(list, line, mask) {
  if (!Array.isArray(list)) return 'unknown'
  const rows = list.map((item) => mask(String(line(item) ?? '').replace(/\s+/g, ' ').trim())).filter(Boolean)
  if (rows.length === 0) return 'none'
  const shown = rows.slice(0, TASK_STATE_LIMIT).map((row) => `- ${row}`)
  if (rows.length > TASK_STATE_LIMIT) shown.push(`- and ${rows.length - TASK_STATE_LIMIT} more`)
  return shown.join('\n')
}

const runningLine = (run) => {
  const what = Array.isArray(run?.briefs) && run.briefs.length > 0 ? run.briefs.join(', ') : String(run?.task ?? '').split('\n')[0]
  return [run?.lane, what, run?.branch].filter(Boolean).join(', ')
}

const reviewLine = (review) => [review?.lane, review?.branch].filter(Boolean).join(', ')

const scopeLine = (scope) => `${scope?.name ?? scope?.id ?? ''}: ${(scope?.folders ?? []).join(', ')}`

export function taskStateBlock({ running = null, reviews = null, scopes = null } = {}, mask = (text) => text) {
  const withFolders = Array.isArray(scopes) ? scopes.filter((scope) => scope?.folders?.length > 0) : scopes
  return [
    `Running lanes:\n${lines(running, runningLine, mask)}`,
    `Waiting for review:\n${lines(reviews, reviewLine, mask)}`,
    `Sub scopes:\n${lines(withFolders, scopeLine, mask)}`,
  ].join('\n\n')
}

export const TASK_STATE_WAIT_MS = 5000

export async function readTaskStateBlock(read, mask, waitMs = TASK_STATE_WAIT_MS) {
  let state = {}
  let timer
  try {
    const limit = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('slow')), waitMs)
    })
    state = (await Promise.race([Promise.resolve().then(read), limit])) ?? {}
  } catch {}
  clearTimeout(timer)
  return taskStateBlock(state, mask)
}
