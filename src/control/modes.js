export const ASK_READY = true

export const MODES = [
  { id: 'plan', label: 'Plan', line: 'Reads and plans. No edits or commands.' },
  { id: 'ask', label: 'Ask', line: 'Asks before each edit or command.' },
  { id: 'edits', label: 'Edits', line: 'Edits in the project. No commands.' },
  { id: 'auto', label: 'Auto', line: 'Edits and runs commands in the project.' },
  { id: 'bypass', label: 'Bypass', line: 'Edits and runs anything, anywhere.' },
]

const LISTS = {
  claude: ['plan', 'ask', 'edits', 'auto', 'bypass'],
  machineroom: ['plan', 'ask', 'edits', 'auto', 'bypass'],
  opencode: ['plan', 'edits', 'auto'],
  codex: ['plan', 'edits', 'auto', 'bypass'],
  agy: ['plan', 'edits', 'auto', 'bypass'],
  acp: ['plan', 'auto', 'bypass'],
}

const LINES = {
  acp: {
    auto: 'Reads and edits in the project. No commands.',
  },
  codex: {
    edits: 'Edits and runs commands in its sandbox.',
  },
}

const LEGACY = {
  claude: 'bypass',
  agy: 'bypass',
  machineroom: 'bypass',
  opencode: 'auto',
  codex: 'auto',
  acp: 'bypass',
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

function normalizeHarness(harness) {
  const text = typeof harness === 'string' ? harness.trim().toLowerCase() : ''
  if (!text || text === 'not reported') return ''
  return text.replace(/_(local|remote|adapter)$/, '').replace(/-local$/, '')
}

function effectiveSandboxMode(harness, mode) {
  const clean = typeof mode === 'string' ? mode.trim().toLowerCase() : ''
  if (clean === 'choice') return defaultMode(harness) ?? legacyMode(harness) ?? ''
  if (clean) return clean
  return legacyMode(harness) ?? defaultMode(harness) ?? ''
}

export function sandboxSummary(harness, mode) {
  const key = normalizeHarness(harness)
  const effective = effectiveSandboxMode(key, mode)
  if (key === 'codex') {
    if (effective === 'plan') return 'Read-only OS sandbox'
    if (effective === 'bypass') return 'No sandbox'
    return 'OS sandbox, writes stay in the worktree'
  }
  if (key === 'claude') {
    if (effective === 'plan' || effective === 'ask' || effective === 'edits' || effective === 'auto') {
      return 'Permission checks, file edits stay in the project; shell commands are not sandboxed'
    }
    return 'No permission checks'
  }
  if (key === 'opencode') {
    if (effective === 'bypass') return 'No permission rules'
    return 'Permission rules, file edits stay in the project; no OS sandbox'
  }
  if (key === 'machineroom') return 'File tools stay in the project; shell commands are not sandboxed'
  if (key === 'agy') return 'No permission checks'
  if (key === 'acp') {
    if (effective === 'plan') return 'Allows reads only'
    if (effective === 'auto') return 'Allows reads and edits inside the project; refuses commands'
    return 'Approves every request the agent asks for'
  }
  return 'Unknown'
}
