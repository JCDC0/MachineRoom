import { useEffect, useMemo, useRef, useState } from 'react'
import ModelRefresh from './ModelRefresh.jsx'
import { normalizeModelChoices } from './modelRefresh.js'
import { readStorage, writeStorage } from '../storage.js'

export const MODEL_SORT_STORAGE = 'machineroom.modelSort'
export const MODEL_SORTS = [
  { id: 'name-asc', label: 'Name A to Z' },
  { id: 'name-desc', label: 'Name Z to A' },
  { id: 'price-asc', label: 'Price low to high' },
  { id: 'price-desc', label: 'Price high to low' },
  { id: 'newest', label: 'Newest' },
  { id: 'context', label: 'Context largest' },
]

const PIN_LIMIT = 200
const PIN_LENGTH = 200

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function cleanPickerPins(value) {
  const pins = []
  const seen = new Set()
  for (const entry of Array.isArray(value) ? value : []) {
    const pin = cleanText(entry)
    if (!pin || pin.length > PIN_LENGTH || seen.has(pin)) continue
    seen.add(pin)
    pins.push(pin)
    if (pins.length >= PIN_LIMIT) break
  }
  return pins
}

export function modelDetailMap(value) {
  const map = new Map()
  for (const entry of Array.isArray(value) ? value : []) {
    if (!entry || typeof entry !== 'object') continue
    const id = cleanText(entry.id)
    if (!id) continue
    map.set(id, {
      id,
      name: cleanText(entry.name) || id,
      contextLength: finiteNumber(entry.contextLength),
      promptPrice: finiteNumber(entry.promptPrice),
      completionPrice: finiteNumber(entry.completionPrice),
      created: finiteNumber(entry.created),
    })
  }
  return map
}

export function endpointDetailMap(endpoints) {
  const map = new Map()
  for (const endpoint of Array.isArray(endpoints) ? endpoints : []) {
    const name = cleanText(endpoint?.name)
    for (const detail of modelDetailMap(endpoint?.modelDetails).values()) {
      if (name) map.set(`${name}/${detail.id}`, detail)
      if (!map.has(detail.id)) map.set(detail.id, detail)
    }
  }
  return map
}

export function pickerRows(value, details) {
  const map = details instanceof Map ? details : modelDetailMap(details)
  return normalizeModelChoices(value).map((row) => {
    const detail = map.get(row.id) ?? null
    return {
      id: row.id,
      name: detail ? detail.name : row.id,
      detail,
    }
  })
}

export function filterPickerRows(rows, query) {
  const text = cleanText(query).toLowerCase()
  const list = Array.isArray(rows) ? rows : []
  if (!text) return list
  return list.filter(
    (row) => row.name.toLowerCase().includes(text) || row.id.toLowerCase().includes(text)
  )
}

function nameCompare(a, b) {
  const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  if (byName !== 0) return byName
  return a.id.localeCompare(b.id, undefined, { sensitivity: 'base' })
}

function numberCompare(a, b, direction) {
  const left = finiteNumber(a)
  const right = finiteNumber(b)
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return direction === 'desc' ? right - left : left - right
}

function priceOf(row) {
  return row.detail ? row.detail.promptPrice : null
}

export function sortPickerRows(rows, sort = 'name-asc') {
  const list = [...(Array.isArray(rows) ? rows : [])]
  list.sort((a, b) => {
    let order = 0
    if (sort === 'name-desc') order = -nameCompare(a, b)
    else if (sort === 'price-asc') order = numberCompare(priceOf(a), priceOf(b), 'asc')
    else if (sort === 'price-desc') order = numberCompare(priceOf(a), priceOf(b), 'desc')
    else if (sort === 'newest') order = numberCompare(a.detail?.created, b.detail?.created, 'desc')
    else if (sort === 'context') order = numberCompare(a.detail?.contextLength, b.detail?.contextLength, 'desc')
    else order = nameCompare(a, b)
    return order !== 0 ? order : nameCompare(a, b)
  })
  return list
}

export function pickerSections(rows, { sort = 'name-asc', current = '', pins = [] } = {}) {
  const sorted = sortPickerRows(rows, sort)
  const pinned = new Set(cleanPickerPins(pins))
  const currentRow = cleanText(current) ? sorted.find((row) => row.id === current) ?? null : null
  const pinnedRows = sorted.filter((row) => row.id !== currentRow?.id && pinned.has(row.id))
  const rest = sorted.filter((row) => row.id !== currentRow?.id && !pinned.has(row.id))
  return [
    { label: 'Current', rows: currentRow ? [currentRow] : [] },
    { label: 'Pinned', rows: pinnedRows },
    { label: 'Models', rows: rest },
  ].filter((section) => section.rows.length > 0)
}

export function formatContext(value) {
  const number = finiteNumber(value)
  if (number === null || number <= 0) return ''
  if (number >= 1000000) {
    const millions = number / 1000000
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`
  }
  if (number >= 1000) return `${Math.round(number / 1000)}K`
  return String(Math.round(number))
}

function perMillion(value) {
  const number = finiteNumber(value)
  if (number === null) return ''
  return (number * 1000000).toFixed(2)
}

export function formatPrice(detail) {
  if (!detail) return ''
  const prompt = finiteNumber(detail.promptPrice)
  const completion = finiteNumber(detail.completionPrice)
  if (prompt === 0 && completion === 0) return 'free'
  if (prompt === null || completion === null) return ''
  return `$${perMillion(prompt)} / $${perMillion(completion)}`
}

export function formatCreated(value) {
  const number = finiteNumber(value)
  if (number === null) return ''
  const date = new Date(number * 1000)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 7)
}

export function modelRowParts(row) {
  const detail = row?.detail ?? null
  return {
    name: detail ? detail.name : row?.id ?? '',
    id: row?.id ?? '',
    hasDetail: Boolean(detail),
    context: detail ? formatContext(detail.contextLength) : '',
    price: detail ? formatPrice(detail) : '',
    date: detail ? formatCreated(detail.created) : '',
  }
}

function readSort() {
  const saved = readStorage(MODEL_SORT_STORAGE)
  return MODEL_SORTS.some((entry) => entry.id === saved) ? saved : 'name-asc'
}

function PinIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        d="M6 2h4l-.7 4.2 2.2 2.2H4.5l2.2-2.2L6 2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M8 8.4V14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

export default function ModelPicker({
  id = undefined,
  label = 'Model',
  ariaLabel = 'Model',
  value = '',
  choices = [],
  details = null,
  client = null,
  onChange = () => {},
  onRefresh = () => {},
  loading = false,
  error = '',
  disabled = false,
  canRefresh = true,
  placeholder = 'Choose a model',
  emptyText = 'No models listed for this harness.',
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState(readSort)
  const [pins, setPins] = useState([])
  const [pinError, setPinError] = useState('')
  const [loadedDetails, setLoadedDetails] = useState(() => new Map())
  const [active, setActive] = useState(0)
  const searchRef = useRef(null)
  const pinsRead = useRef(false)
  const pinsTouched = useRef(false)
  const hasDetails = Array.isArray(details) && details.length > 0

  const detailMap = useMemo(() => {
    const given = modelDetailMap(details)
    if (given.size === 0) return loadedDetails
    const merged = new Map(loadedDetails)
    for (const [key, detail] of given) merged.set(key, detail)
    return merged
  }, [details, loadedDetails])

  const rows = useMemo(() => pickerRows(choices, detailMap), [choices, detailMap])
  const shown = useMemo(() => rows.find((row) => row.id === value) ?? null, [rows, value])
  const filtered = useMemo(() => filterPickerRows(rows, query), [rows, query])
  const sections = useMemo(
    () => pickerSections(filtered, { sort, current: value, pins }),
    [filtered, sort, value, pins]
  )
  const flat = useMemo(() => sections.flatMap((section) => section.rows), [sections])
  const flatIndex = useMemo(() => new Map(flat.map((row, index) => [row.id, index])), [flat])

  useEffect(() => {
    setActive(0)
  }, [query, sort, open])

  useEffect(() => {
    if (active > flat.length - 1) setActive(Math.max(0, flat.length - 1))
  }, [active, flat.length])

  useEffect(() => {
    if (!open) return undefined
    let alive = true
    if (searchRef.current?.focus) searchRef.current.focus()
    if (typeof client?.modelPins === 'function' && !pinsRead.current) {
      pinsRead.current = true
      Promise.resolve()
        .then(() => client.modelPins())
        .then((list) => {
          if (alive && !pinsTouched.current) setPins(cleanPickerPins(list))
        })
        .catch(() => {})
    }
    return () => {
      alive = false
    }
  }, [open, client])

  useEffect(() => {
    if (!open || hasDetails || typeof client?.endpoints !== 'function') return undefined
    let alive = true
    Promise.resolve()
      .then(() => client.endpoints())
      .then((endpoints) => {
        if (alive) setLoadedDetails(endpointDetailMap(endpoints))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [open, client, hasDetails])

  function close() {
    setOpen(false)
    setQuery('')
    setPinError('')
  }

  function pick(row) {
    onChange(row.id)
    close()
  }

  function chooseSort(next) {
    setSort(next)
    writeStorage(MODEL_SORT_STORAGE, next)
  }

  function togglePin(row) {
    pinsTouched.current = true
    if (!pins.includes(row.id) && pins.length >= PIN_LIMIT) {
      setPinError('At most 200 models can be pinned.')
      return
    }
    const next = cleanPickerPins(
      pins.includes(row.id) ? pins.filter((pin) => pin !== row.id) : [...pins, row.id]
    )
    setPins(next)
    setPinError('')
    if (typeof client?.saveModelPins === 'function') {
      Promise.resolve()
        .then(() => client.saveModelPins({ pins: next }))
        .catch(() => setPinError('The pin could not be saved.'))
    }
  }

  function onSearchKey(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => Math.min(flat.length - 1, index + 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(0, index - 1))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const row = flat[active]
      if (row) pick(row)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  }

  function onRootKey(event) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    close()
  }

  const triggerText = shown ? shown.name : placeholder

  return (
    <div className="mr-picker mr-model-field" onKeyDown={onRootKey}>
      {label ? <span className="mr-side-field-label mono">{label}</span> : null}
      <div className="mr-model-row">
        <button
          type="button"
          id={id}
          className="mr-picker-trigger mono"
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          title={triggerText}
          disabled={disabled}
          onClick={() => (open ? close() : setOpen(true))}
        >
          <span className="mr-picker-value">{triggerText}</span>
          <span className="mr-picker-caret" aria-hidden="true">
            <svg viewBox="0 0 10 6" width="9" height="6">
              <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </span>
        </button>
        <ModelRefresh onRefresh={onRefresh} loading={loading} disabled={disabled || !canRefresh} />
      </div>
      {open ? (
        <div className="mr-picker-pop" role="dialog" aria-label={ariaLabel}>
          <div className="mr-picker-head">
            <input
              ref={searchRef}
              type="search"
              className="mr-picker-search"
              value={query}
              autoComplete="off"
              placeholder="Search models..."
              aria-label="Search models"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onSearchKey}
            />
            <select
              className="mr-picker-sort mono"
              aria-label="Sort models"
              value={sort}
              onChange={(event) => chooseSort(event.target.value)}
            >
              {MODEL_SORTS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>
          <div className="mr-picker-list" role="listbox" aria-label={ariaLabel}>
            {rows.length === 0 ? <p className="mr-picker-note mono">{emptyText}</p> : null}
            {rows.length > 0 && flat.length === 0 ? <p className="mr-picker-note mono">No models found.</p> : null}
            {sections.map((section) => (
              <div key={section.label}>
                <p className="mr-picker-group mono">{section.label}</p>
                {section.rows.map((row) => {
                  const parts = modelRowParts(row)
                  const index = flatIndex.get(row.id) ?? -1
                  const pinned = pins.includes(row.id)
                  return (
                    <div
                      key={row.id}
                      className={`mr-picker-row${index === active ? ' is-active' : ''}${row.id === value ? ' is-current' : ''}`}
                      role="option"
                      aria-selected={row.id === value}
                    >
                      <button
                        type="button"
                        className="mr-picker-pick"
                        title={parts.hasDetail ? `${parts.name} (${parts.id})` : parts.id}
                        onClick={() => pick(row)}
                      >
                        <span className="mr-picker-row-main">
                          <span className="mr-picker-name">{parts.name}</span>
                          {parts.hasDetail ? <span className="mr-picker-id mono">{parts.id}</span> : null}
                        </span>
                        {parts.hasDetail ? (
                          <span className="mr-picker-meta mono">
                            {parts.context ? <span>{parts.context}</span> : null}
                            {parts.price ? <span>{parts.price}</span> : null}
                            {parts.date ? <span>{parts.date}</span> : null}
                          </span>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        className={`mr-picker-pin${pinned ? ' is-on' : ''}`}
                        title={pinned ? `Unpin ${parts.name}` : `Pin ${parts.name}`}
                        aria-label={pinned ? `Unpin ${parts.name}` : `Pin ${parts.name}`}
                        aria-pressed={pinned}
                        onClick={() => togglePin(row)}
                      >
                        <PinIcon />
                      </button>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          {pinError ? (
            <p className="mr-model-error mono" role="alert">
              {pinError}
            </p>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="mr-model-error mono" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
