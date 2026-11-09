export const ASK_READY = true

export const MODES = [
  { id: 'plan', label: 'Plan', line: 'Reads and plans. Makes no edits and runs no commands.' },
  { id: 'ask', label: 'Ask', line: 'Asks before every write or command.' },
  { id: 'edits', label: 'Edits', line: 'Edits files. Runs no commands.' },
  { id: 'auto', label: 'Auto', line: 'Edits files and runs commands. The harness guards risky ones.' },
  { id: 'bypass', label: 'Bypass', line: 'Allows every edit and command.' },
]

const LISTS = {
  claude: ['plan', 'ask', 'edits', 'auto', 'bypass'],
  machineroom: ['plan', 'ask', 'edits', 'auto', 'bypass'],
  opencode: ['plan', 'edits', 'auto'],
  agy: ['plan', 'edits', 'auto', 'bypass'],
}

const LEGACY = {
  claude: 'bypass',
  agy: 'bypass',
  machineroom: 'bypass',
  opencode: 'auto',
}

export function modesFor(harness) {
  const ids = Object.hasOwn(LISTS, harness) ? LISTS[harness] : []
  return MODES.filter((mode) => ids.includes(mode.id) && (ASK_READY || mode.id !== 'ask'))
}

export function legacyMode(harness) {
  return Object.hasOwn(LEGACY, harness) ? LEGACY[harness] : null
}

export function defaultMode(harness) {
  return modesFor(harness).some((mode) => mode.id === 'auto') ? 'auto' : legacyMode(harness)
}
