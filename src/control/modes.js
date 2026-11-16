export const ASK_READY = true

export const MODES = [
  { id: 'plan', label: 'Plan', line: 'Reads and plans. Makes no edits and runs no commands.' },
  { id: 'ask', label: 'Ask', line: 'Asks before every write or command. An outside write needs your Allow.' },
  { id: 'edits', label: 'Edits', line: 'Edits files. Writes stay in the project. Runs no commands.' },
  { id: 'auto', label: 'Auto', line: 'Edits files and runs commands. Writes stay in the project. The harness guards risky ones.' },
  { id: 'bypass', label: 'Bypass', line: 'Allows every edit and command. It can write anywhere.' },
]

const LISTS = {
  claude: ['plan', 'ask', 'edits', 'auto', 'bypass'],
  machineroom: ['plan', 'ask', 'edits', 'auto', 'bypass'],
  opencode: ['plan', 'edits', 'auto'],
  codex: ['plan', 'edits', 'auto', 'bypass'],
  agy: ['plan', 'edits', 'auto', 'bypass'],
}

const LINES = {
  codex: {
    edits: 'Edits files and can run commands inside its workspace sandbox. Codex has no edits-only mode.',
  },
}

const LEGACY = {
  claude: 'bypass',
  agy: 'bypass',
  machineroom: 'bypass',
  opencode: 'auto',
  codex: 'auto',
}

export function modesFor(harness) {
  const ids = Object.hasOwn(LISTS, harness) ? LISTS[harness] : []
  const lines = Object.hasOwn(LINES, harness) ? LINES[harness] : {}
  return MODES
    .filter((mode) => ids.includes(mode.id) && (ASK_READY || mode.id !== 'ask'))
    .map((mode) => (Object.hasOwn(lines, mode.id) ? { ...mode, line: lines[mode.id] } : mode))
}

export function laneModesFor(harness) {
  return modesFor(harness).filter((mode) => mode.id !== 'ask')
}

export function legacyMode(harness) {
  return Object.hasOwn(LEGACY, harness) ? LEGACY[harness] : null
}

export function defaultMode(harness) {
  return modesFor(harness).some((mode) => mode.id === 'auto') ? 'auto' : legacyMode(harness)
}
