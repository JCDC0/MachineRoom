function cleanText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function modelRows(value) {
  if (Array.isArray(value)) return value
  if (isObject(value) && Array.isArray(value.models)) return value.models
  return []
}

export function normalizeModelChoices(value) {
  const seen = new Set()
  const rows = []
  for (const entry of modelRows(value)) {
    const id = typeof entry === 'string' ? cleanText(entry) : cleanText(entry?.id)
    if (!id || seen.has(id)) continue
    const label = typeof entry === 'string' ? id : cleanText(entry?.label) || id
    seen.add(id)
    rows.push({ id, label })
  }
  return rows
}

export function mergeModelChoices(value, current) {
  const rows = normalizeModelChoices(value)
  const id = cleanText(current)
  if (!id || rows.some((row) => row.id === id)) return rows
  return [{ id, label: id }, ...rows]
}

export function groupModelChoices(value, current) {
  const rows = mergeModelChoices(value, current)
  const id = cleanText(current)
  const found = id ? rows.find((row) => row.id === id) ?? null : null
  return { current: found, rest: rows.filter((row) => row.id !== found?.id) }
}

export function filterModelChoices(value, query) {
  const rows = normalizeModelChoices(value)
  const text = cleanText(query).toLowerCase()
  if (!text) return rows
  return rows.filter(
    (row) => row.label.toLowerCase().includes(text) || row.id.toLowerCase().includes(text)
  )
}

export function modelChoiceText(choice) {
  const id = cleanText(choice?.id)
  const label = cleanText(choice?.label) || id
  return label && label !== id ? `${label} (${id})` : id
}

export function modelErrorText(value) {
  if (typeof value === 'string') return cleanText(value)
  if (value instanceof Error) return cleanText(value.message)
  return ''
}

export function modelAnswerError(answer) {
  return modelErrorText(answer?.error) || modelErrorText(answer?.message)
}

export async function loadHarnessModels(client, harness, { refresh = false } = {}) {
  const key = cleanText(harness)
  if (!key || typeof client?.harnessModels !== 'function') {
    return { models: null, error: '' }
  }
  try {
    const answer = await client.harnessModels({ harness: key, refresh: Boolean(refresh) })
    return {
      models: normalizeModelChoices(answer),
      error: modelAnswerError(answer),
    }
  } catch (error) {
    return {
      models: null,
      error: modelErrorText(error) || 'Could not refresh the models.',
    }
  }
}

export function withModelRows(value, rows, harness) {
  const key = cleanText(harness)
  const extra = normalizeModelChoices(rows).map((row) => ({ ...row, harness: key }))
  const base = modelRows(value).filter((row) => isObject(row))
  const seen = new Set()
  const merged = []
  for (const row of [...base, ...extra]) {
    const id = cleanText(row.id)
    if (!id) continue
    const owner = cleanText(row.harness)
    const mark = `${owner}\u0000${id}`
    if (seen.has(mark)) continue
    seen.add(mark)
    merged.push(row)
  }
  if (Array.isArray(value)) return merged
  return { ...(isObject(value) ? value : {}), models: merged }
}

export function withHarnessModels(value, harness, rows) {
  const key = cleanText(harness)
  if (!key) return value
  const list = Array.isArray(value) ? value : isObject(value) && Array.isArray(value.harnesses) ? value.harnesses : null
  if (!list) return value
  const models = normalizeModelChoices(rows)
  let found = false
  const next = list.map((row) => {
    if (!isObject(row) || cleanText(row.key) !== key) return row
    found = true
    return { ...row, models }
  })
  if (!found) return value
  return Array.isArray(value) ? next : { ...value, harnesses: next }
}
