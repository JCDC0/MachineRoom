export const HARNESS_STATE_COLORS = {
  ready: '#2aff80',
  'not-ready': '#ff2a2a',
  off: 'rgb(255 255 255 / 0.5)',
}

/**
 * Normalizes a bridge or check response into harness rows.
 */
export function harnessListFrom(answer) {
  const raw = Array.isArray(answer) ? answer : Array.isArray(answer?.harnesses) ? answer.harnesses : []
  return raw
    .filter((entry) => entry && typeof entry === 'object' && typeof entry.key === 'string' && entry.key)
    .map((entry) => ({
      key: entry.key,
      name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : entry.key,
      available: entry.available === true,
      ready: typeof entry.ready === 'boolean' ? entry.ready : entry.available === true,
      enabled: entry.enabled !== false,
      program: typeof entry.program === 'string' ? entry.program : '',
      version: typeof entry.version === 'string' ? entry.version : '',
      reason: typeof entry.reason === 'string' ? entry.reason : '',
    }))
}

/**
 * Returns the UI label for a harness entry.
 */
export function harnessDisplayName(entry) {
  if (!entry) return ''
  if (entry.key === 'machineroom') return 'Direct API'
  return typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : entry.key ?? ''
}

/**
 * Reports whether a harness row represents the built-in Direct API runner.
 */
export function isNativeHarness(entry) {
  return entry?.key === 'machineroom'
}

/**
 * Computes the display state, label, colour and reason for one harness row.
 */
export function harnessStatus(entry) {
  if (!entry || entry.enabled === false) {
    return {
      state: 'off',
      label: 'Off',
      color: HARNESS_STATE_COLORS.off,
      reason: '',
    }
  }
  if (entry.ready === true) {
    return {
      state: 'ready',
      label: 'Ready',
      color: HARNESS_STATE_COLORS.ready,
      reason: '',
    }
  }
  return {
    state: 'not-ready',
    label: 'Not ready',
    color: HARNESS_STATE_COLORS['not-ready'],
    reason: typeof entry.reason === 'string' ? entry.reason.trim() : '',
  }
}

/**
 * Builds editable program drafts keyed by harness key.
 */
export function programDraftsFrom(rows) {
  const next = {}
  for (const row of rows) {
    if (!row || !row.key || isNativeHarness(row)) continue
    next[row.key] = typeof row.program === 'string' ? row.program : ''
  }
  return next
}

/**
 * Counts array items returned from a bridge list call.
 */
export function countSavedItems(value, field) {
  if (Array.isArray(value)) return value.length
  if (value && typeof value === 'object') {
    if (Array.isArray(value[field])) return value[field].length
    if (Array.isArray(value.slots)) return value.slots.length
  }
  return 0
}

function pluralCount(count, singular) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`
}

/**
 * Formats the Direct API row note with saved key and endpoint counts.
 */
export function directApiSummary(counts) {
  if (!counts || typeof counts.keys !== 'number' || typeof counts.endpoints !== 'number') {
    return 'Keys and endpoints are added in Direct API below.'
  }
  return `${pluralCount(counts.keys, 'key')} and ${pluralCount(counts.endpoints, 'endpoint')} saved. Keys and endpoints are added in Direct API below.`
}

/**
 * Builds dialog copy for actions that ask for confirmation first.
 */
export function harnessConfirmSpec(action) {
  if (!action || !action.key) return null
  const name = action.name || action.key
  if (action.kind === 'disable') {
    return {
      kind: 'disable',
      key: action.key,
      name,
      label: `Turn off ${name}`,
      text: `Stop offering ${name} in task and run forms?`,
      confirmText: 'Turn off',
      danger: true,
    }
  }
  if (action.kind === 'program') {
    const program = typeof action.program === 'string' ? action.program.trim() : ''
    return {
      kind: 'program',
      key: action.key,
      name,
      program,
      label: `Save program for ${name}`,
      text: program ? `Set the program for ${name} to ${program}?` : `Clear the saved program for ${name}?`,
      confirmText: 'Save program',
      danger: false,
    }
  }
  return null
}
