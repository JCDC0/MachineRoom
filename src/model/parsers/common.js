import { relativeTo } from '../paths.js'
import { touchesForCommand } from '../commands.js'

const FAILURE = /(^|\n)\s*(✖|×)\s|\bnot ok\b|\bFAIL(ED)?\b|\[exit [1-9]\d*\]|\bfatal:|Exception\b/

export function looksFailed(output) {
  return FAILURE.test(String(output ?? ''))
}

export function shorten(text, limit = 72) {
  const flat = String(text).replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit - 1)}~` : flat
}

export function createLineReader(onLine) {
  let buffer = ''
  return {
    push(chunk, time) {
      buffer += chunk
      const parts = buffer.split(/\r?\n/)
      buffer = parts.pop()
      for (const line of parts) if (line) onLine(line, time)
    },
    flush(time) {
      const rest = buffer
      buffer = ''
      if (rest) onLine(rest, time)
    },
  }
}

export function parseJson(line) {
  const start = line.indexOf('{')
  if (start === -1) return null
  try {
    return JSON.parse(line.slice(start))
  } catch {
    return null
  }
}

export function fileTouch(ctx, rawPath, tool) {
  const relative = relativeTo(ctx.rootName, rawPath)
  if (relative === null || relative === '') return { relative, touches: [] }
  const mode = tool === 'read' ? 'read' : 'write'
  return { relative, touches: [{ path: relative, mode, kind: 'file' }] }
}

export function commandTouch(ctx, command) {
  return touchesForCommand(command, ctx.files, ctx.dirs)
}

export function toolStart({ time, id, tool, label, touches }) {
  return { time, type: 'tool.start', id, tool, label, touches }
}

export function toolEnd({ time, id, ok, label, error }) {
  const activity = { time, type: 'tool.end', id, ok }
  if (label !== undefined) activity.label = label
  if (error !== undefined) activity.error = error
  return activity
}

export function labelFor(tool, relative, rawPath) {
  const shown = relative === null ? (String(rawPath).split(/[\\/]/).pop() ?? '') : relative || '.'
  return `${tool} ${shown}`
}
