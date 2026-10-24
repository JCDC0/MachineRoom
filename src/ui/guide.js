import { readStorage, store, writeStorage } from '../storage.js'

export const GUIDE_FLAG = 'machineroom.guide'
export const GUIDE_SEEN = '1'

export const GUIDE_STEPS = [
  {
    label: 'Your project',
    text: 'The middle is your project: its name sits under the ring, and the folder cards branch out from it.',
  },
  {
    label: 'Agents',
    text: 'Each shape on the ring is an agent, and its chip beside it shows the name and status.',
  },
  {
    label: 'The tunnel',
    text: 'A working agent sends a yellow tunnel to the file it is touching, and packets run along it.',
  },
  {
    label: 'Colours',
    text: 'White is a read or write, yellow is working, green is finished, red is a failure.',
  },
  {
    label: 'Get started',
    text: 'Press / or click ORCHESTRATOR to say what you want built, C opens the control drawer, and ? lists the keys.',
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
