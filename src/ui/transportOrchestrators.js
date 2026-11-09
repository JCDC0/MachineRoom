export const OPEN_CHAT_EVENT = 'machineroom:open-chat'
export const TRANSPORT_CHIP_LIMIT = 4

export function chipTone(state) {
  if (state === 'working') return 'working'
  if (state === 'paused') return 'paused'
  if (state === 'failed' || state === 'error') return 'failed'
  return 'idle'
}

export function orchestratorAnswerList(answer) {
  const list = Array.isArray(answer)
    ? answer
    : answer && typeof answer === 'object' && Array.isArray(answer.orchestrators)
      ? answer.orchestrators
      : []
  return list.filter(
    (entry) => entry && typeof entry === 'object' && typeof entry.id === 'string' && entry.id
  )
}

export function hasWaitingApproval(entry) {
  return Boolean(entry && Array.isArray(entry.approvals) && entry.approvals.length > 0)
}

function chipName(entry) {
  const name = typeof entry.name === 'string' ? entry.name.trim() : ''
  return name || entry.id
}

export function orchestratorChips(list, limit = TRANSPORT_CHIP_LIMIT) {
  const size = Number.isInteger(limit) && limit >= 0 ? limit : TRANSPORT_CHIP_LIMIT
  const subs = orchestratorAnswerList(list).filter((entry) => entry.id !== 'orchestrator')
  const shown = subs.slice(0, size)
  return {
    chips: shown.map((entry) => ({
      id: entry.id,
      name: chipName(entry),
      tone: chipTone(entry.state),
      waiting: hasWaitingApproval(entry),
    })),
    more: subs.length - shown.length,
  }
}
