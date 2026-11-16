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
  acp: ['plan', 'auto', 'bypass'],
}

const LINES = {
  acp: {
    auto: 'Allows reads and edits inside the project; refuses commands.',
  },
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
