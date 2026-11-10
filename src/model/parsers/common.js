import { relativeTo } from '../paths.js'
import { touchesForCommand } from '../commands.js'

const FAILURE = /(?:^|\n)\s*(?:[✖×]\s|not ok\b|FAIL(?:ED)?\b|\[exit [1-9]\d*\]|fatal:|\+?\s*CategoryInfo|Exception\b)/

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

const dirSets = new WeakMap()

export function dirSetFor(dirs) {
  if (dirs instanceof Set) return dirs
  if (!Array.isArray(dirs)) return null
  let held = dirSets.get(dirs)
  if (!held) {
    held = { set: new Set(), at: 0 }
    dirSets.set(dirs, held)
  }
  while (held.at < dirs.length) {
    held.set.add(dirs[held.at])
    held.at += 1
  }
  return held.set
}

export function fileTouch(ctx, rawPath, tool) {
  const relative = relativeTo(ctx.rootName, rawPath)
  if (relative === null || relative === '') return { relative, touches: [] }
  const isDir = Boolean(dirSetFor(ctx.dirs)?.has(relative))
  if (tool === 'read' && isDir) {
    return { relative, touches: [{ path: relative, mode: 'list', kind: 'dir' }] }
  }
  const mode = tool === 'read' ? 'read' : 'write'
  return { relative, touches: [{ path: relative, mode, kind: 'file' }] }
}

export function folderTouch(ctx, raw) {
  const relative = raw === undefined || raw === null || raw === '' ? '' : relativeTo(ctx.rootName, raw)
  if (relative === null) return null
  return { path: relative, mode: 'list', kind: 'dir' }
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

export function mcpPathOf(input) {
  const direct = input?.path ?? input?.file ?? input?.filePath ?? input?.file_path ?? input?.Path
  if (typeof direct === 'string' && direct !== '') return direct
  const nested = input?.arguments ?? input?.Arguments
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const value = nested.path ?? nested.file ?? nested.filePath ?? nested.file_path ?? nested.Path
    if (typeof value === 'string' && value !== '') return value
  }
  return ''
}

export function mcpLabelOf(name, input) {
  if (name === 'mcp_list_tools') {
    const server = typeof input?.server === 'string' ? input.server.trim() : typeof input?.ServerName === 'string' ? input.ServerName.trim() : ''
    return server === '' ? 'mcp list tools' : `mcp list tools ${server}`
  }
  let server = typeof input?.server === 'string' ? input.server.trim() : typeof input?.ServerName === 'string' ? input.ServerName.trim() : ''
  let tool = typeof input?.tool === 'string' ? input.tool.trim() : typeof input?.ToolName === 'string' ? input.ToolName.trim() : ''
  if (name.startsWith('mcp__')) {
    const parts = name.split('__')
    server = parts[1] ?? ''
    tool = parts.slice(2).join('__')
  }
  const shown = [server, tool].filter((part) => part !== '').join(' ')
  return shown === '' ? `mcp ${name}` : `mcp ${shown}`
}
