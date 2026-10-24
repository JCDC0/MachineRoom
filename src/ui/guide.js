import { readStorage, store, writeStorage } from '../storage.js'

export const GUIDE_FLAG = 'machineroom.guide'
export const GUIDE_SEEN = '1'

export const GUIDE_STEPS = [
  {
    label: 'The lens',
    text: 'The room sits in the lens at the top: your project name is at its top left, and the hub, the folder cards and the agents fill it.',
  },
  {
    label: 'The dock',
    text: "The dock below has three columns: the agent list on the left, the selected agent's context in the middle, and the settings and costs on the right.",
  },
  {
    label: 'The tunnel',
    text: 'A working agent sends a yellow tunnel to the file it touches, and packets run along it; white is a read or write, green is finished and red is a failure.',
  },
  {
    label: 'The chat',
    text: 'The orchestrator chat sits at the bottom right: press / or click ORCHESTRATOR, Attach adds a sub orchestrator, and its tabs switch between them.',
  },
  {
    label: 'The keys',
    text: 'C opens the control drawer, L the event log, T an agent log, F follow mode, 0 the overview, and ? lists every key.',
  },
]

export const CONFIRM_SELECTOR =
  '.brief-confirm-card, .backup-confirm-card, .mr-orch-confirm, .mr-assistant-btn-confirm'

export function clampStep(value) {
  if (!Number.isInteger(value)) return 0
  return Math.min(Math.max(value, 0), GUIDE_STEPS.length - 1)
}

export function guideSeen(storage = store()) {
  try {
    return readStorage(GUIDE_FLAG, storage) === GUIDE_SEEN
  } catch {
    return false
  }
}

export function shouldShowGuide(storage = store()) {
  return !guideSeen(storage)
}

export function markGuideSeen(storage = store()) {
  try {
    return writeStorage(GUIDE_FLAG, GUIDE_SEEN, storage)
  } catch {
    return false
  }
}

export function confirmCardOpen(doc) {
  if (!doc || typeof doc.querySelector !== 'function') return false
  try {
    return Boolean(doc.querySelector(CONFIRM_SELECTOR))
  } catch {
    return false
  }
}

export function guideCanOpen(doc) {
  return !confirmCardOpen(doc)
}
