const VARIABLE = /%([A-Za-z_][A-Za-z0-9_]*)%/g
const REPORT_LINES = 20

export function expandBin(bin, env) {
  return String(bin).replace(VARIABLE, (whole, name) => {
    const value = env?.[name]
    if (typeof value !== 'string' || value === '') throw new Error(`The environment variable ${name} is not set.`)
    return value
  })
}

export function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function headLines(text) {
  const report = String(text ?? '').replace(/\s+$/, '')
  if (!report) return []
  return report.split(/\r?\n/).slice(0, REPORT_LINES)
}

export function lastJsonLine(log, match) {
  let last = null
  for (const line of String(log ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue
    let item
    try {
      item = JSON.parse(line)
    } catch {
      continue
    }
    if (match(item)) last = item
  }
  return last
}

const TERMINAL_OSC = /\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g
const TERMINAL_CSI = /\u001B\[[0-9;?]*[ -/]*[@-~]/g

export function terminalText(text) {
  return String(text ?? '')
    .replace(TERMINAL_OSC, '')
    .replace(TERMINAL_CSI, '')
}

const BROAD_TOOL_PROSE = /^\s*(?:Running|Reading|Writing|Editing)(?!\s*(?:[:(]|\b(?:command|file)\b))/i

export function lastPlainBlock(text, createParser) {
  const clean = terminalText(text).replace(/\r\n?/g, '\n')
  const parser = createParser({ rootName: '', files: [], dirs: [] })
  const blocks = []
  let block = []
  const flush = () => {
    const value = block.join('\n').trim()
    if (value) blocks.push(value)
    block = []
  }
  for (const line of clean.split('\n')) {
    if (BROAD_TOOL_PROSE.test(line)) {
      block.push(line)
      continue
    }
    const activities = parser.push(`${line}\n`, 0)
    if (activities.some((activity) => activity.type === 'tool.start' || activity.type === 'tool.end')) {
      blocks.length = 0
      block = []
      continue
    }
    if (activities.some((activity) => activity.type === 'run.start' || activity.type === 'run.end')) {
      flush()
      continue
    }
    block.push(line)
  }
  flush()
  return blocks.length > 0 ? blocks[blocks.length - 1] : ''
}

export function tokenCount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export function sumTokens(values) {
  const known = values.map(tokenCount).filter((value) => value !== null)
  return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0)
}

export function jsonLineReader(createParser) {
  const parser = createParser({ rootName: '', files: [], dirs: [] })
  return function readLine(line, at = null) {
    const text = String(line ?? '')
    if (!text.trim()) return null
    let time = Number.isFinite(at) ? at : null
    if (time === null) {
      try {
        const item = JSON.parse(text)
        if (typeof item?.timestamp === 'number' && Number.isFinite(item.timestamp)) time = item.timestamp
      } catch {
        time = null
      }
    }
    const activities = parser.push(`${text}\n`, time ?? 0)
    return { chunk: `${text}\n`, at: time, read: activities.length > 0 }
  }
}

function unique(values) {
  return [...new Set(values)].sort()
}

export function summaryOf(harness, activities, head, usage = {}) {
  const { costUsd = null, inputTokens = null, outputTokens = null, peakTokens = null } = usage ?? {}
  const calls = activities.filter((activity) => activity.type === 'tool.start')
  const written = []
  const read = []
  for (const call of calls) {
    for (const touch of call.touches ?? []) {
      if (touch.kind !== 'file') continue
      if (touch.mode === 'write') written.push(touch.path)
      if (touch.mode === 'read') read.push(touch.path)
    }
  }
  return {
    harness,
    toolCalls: calls.length,
    failed: activities.filter((activity) => activity.type === 'tool.end' && activity.ok === false).length,
    written: unique(written),
    read: unique(read),
    head,
    costUsd,
    inputTokens,
    outputTokens,
    peakTokens,
  }
}
