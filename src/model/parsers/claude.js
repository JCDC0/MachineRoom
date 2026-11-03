import { basename, relativeTo } from '../paths.js'
import { commandTouch, createLineReader, fileTouch, labelFor, looksFailed, mcpLabelOf, mcpPathOf, parseJson, shorten, toolEnd, toolStart } from './common.js'

const KINDS = [
  [/^read/i, 'read'],
  [/^(edit|multiedit|notebookedit)/i, 'edit'],
  [/^(write|create)/i, 'write'],
  [/^(terminal|bash|shell)/i, 'shell'],
  [/^(glob|grep|search|find|ls|list)/i, 'search'],
  [/^(websearch|webfetch|web_search|web_fetch)/i, 'web'],
  [/^mcp/i, 'mcp'],
]
const FILE_NAME = /^(Read|Edit|MultiEdit|NotebookEdit|Write)\s+(.+)$/i
const FILE_KINDS = new Set(['read', 'edit', 'write'])
const STREAM_FILES = new Set(['read', 'write', 'edit', 'multiedit', 'notebookedit'])
const STREAM_FOLDERS = new Set(['glob', 'grep', 'ls'])
const STREAM_TASKS = new Set(['task', 'agent'])
const STREAM_WEB = new Set(['websearch', 'webfetch'])
const MCP_TOOL = /^(mcp__|mcp_call_tool$|mcp_list_tools$)/
const PROFILE_PATH = /(?:[A-Za-z]:[\\/]Users[\\/][^\\/\s"'<>|?*]+|\/(?:home|Users)\/[^/\s"'<>|?*]+)(?:[\\/][^\\/\s"'<>|?*]+)*/g
const PROFILE_QUOTED = /(["'])((?:[A-Za-z]:[\\/]Users[\\/]|\/(?:home|Users)\/)[^"']*)\1/g

function shortenProfile(text) {
  return String(text)
    .replace(PROFILE_QUOTED, (found, quote, inner) => `${quote}${basename(inner)}${quote}`)
    .replace(PROFILE_PATH, (found) => basename(found))
}

function commandLabel(command, fallback) {
  const text = typeof command === 'string' && command ? command : fallback
  return `$ ${shorten(shortenProfile(text))}`
}

function kindOf(name) {
  return KINDS.find(([pattern]) => pattern.test(name))?.[1] ?? 'other'
}

export function createClaudeParser(ctx) {
  const calls = new Map()
  const children = new Map()
  const heard = new Set()
  const childCounts = new Map()
  const out = []
  const parentKey = ctx.agentKey ?? 'agent'

  function start(call, time) {
    if (call.started) return
    call.started = true
    let touches = []
    let label = call.name
    if (FILE_KINDS.has(call.kind) && call.path) {
      const found = fileTouch(ctx, call.path, call.kind)
      touches = found.touches
      label = labelFor(call.kind, found.relative, call.path)
    } else if (call.kind === 'shell') {
      touches = commandTouch(ctx, call.command ?? '')
      label = `$ ${shorten(call.command ?? 'terminal')}`
    } else if (call.kind === 'mcp') {
      label = mcpLabelOf(String(call.name ?? '').toLowerCase(), call.input ?? {})
    }
    out.push({ ...toolStart({ time, id: call.id, tool: call.kind, label, touches }), agent: call.owner ?? parentKey })
  }

  function ownerOf(parentId) {
    if (typeof parentId !== 'string' || parentId === '') return parentKey
    const child = children.get(parentId)
    if (!child) return parentKey
    heard.add(child)
    return child
  }

  function folderTouch(raw) {
    const relative = raw === undefined || raw === null || raw === '' ? '' : relativeTo(ctx.rootName, raw)
    if (relative === null) return null
    return { path: relative, mode: 'list', kind: 'dir' }
  }

  function spawn(call, time, description) {
    const type = typeof call.input.subagent_type === 'string' ? call.input.subagent_type.trim() : ''
    const name = type || description || 'subagent'
    const label = description || name
    const number = (childCounts.get(call.owner) ?? 0) + 1
    childCounts.set(call.owner, number)
    const child = `${call.owner}~${number}`
    children.set(call.id, child)
    out.push({ time, type: 'agent.spawn', agent: call.owner, child, name: shorten(name, 40), label })
  }

  function streamStart(item, json, time) {
    const id = typeof item.id === 'string' ? item.id : ''
    if (!id || calls.has(id)) return
    const name = String(item.name ?? '')
    const lower = name.toLowerCase()
    const input = item.input && typeof item.input === 'object' && !Array.isArray(item.input) ? item.input : {}
    const owner = ownerOf(json.parent_tool_use_id)
    const call = { id, name, owner, input, kind: 'other', path: null, command: null, started: false, task: false, background: false }
    calls.set(id, call)
    let touches = []
    let label = name || 'tool'
    if (STREAM_FILES.has(lower)) {
      call.kind = lower === 'read' ? 'read' : lower === 'write' ? 'write' : 'edit'
      const raw = input.file_path ?? input.notebook_path
      if (typeof raw === 'string' && raw !== '') {
        const found = fileTouch(ctx, raw, call.kind)
        touches = found.touches
        label = labelFor(call.kind, found.relative, raw)
      } else {
        label = `${call.kind} file`
      }
    } else if (STREAM_FOLDERS.has(lower)) {
      call.kind = 'search'
      const raw = typeof input.path === 'string' ? input.path : ''
      const touch = folderTouch(raw)
      if (touch) touches = [touch]
      label = `${lower} ${touch ? touch.path || '.' : basename(raw) || '.'}`
    } else if (lower === 'bash') {
      call.kind = 'shell'
      call.command = typeof input.command === 'string' ? input.command : ''
      touches = commandTouch(ctx, call.command)
      label = commandLabel(call.command, 'bash')
    } else if (STREAM_WEB.has(lower)) {
      call.kind = 'web'
      const query = typeof input.query === 'string' ? input.query.trim() : ''
      const url = typeof input.url === 'string' ? input.url.trim() : ''
      const shown = lower === 'webfetch' ? url : query
      label = shown ? `web ${lower === 'webfetch' ? 'fetch' : 'search'} ${shorten(shown)}` : `web ${lower === 'webfetch' ? 'fetch' : 'search'}`
    } else if (MCP_TOOL.test(lower)) {
      call.kind = 'mcp'
      label = mcpLabelOf(lower, input)
      const raw = mcpPathOf(input)
      if (raw !== '') {
        const found = fileTouch(ctx, raw, 'read')
        touches = found.touches
        label = `${label} ${found.relative === null ? basename(raw) : found.relative}`
      }
    } else if (STREAM_TASKS.has(lower)) {
      const description = typeof input.description === 'string' ? input.description.trim() : ''
      if (input.run_in_background === true) call.background = true
      label = description ? `task: ${shorten(description)}` : 'task'
    }
    out.push({ ...toolStart({ time, id, tool: call.kind, label, touches }), agent: owner })
    if (STREAM_TASKS.has(lower)) {
      call.task = true
      const description = typeof input.description === 'string' ? input.description.trim() : ''
      spawn(call, time, description)
    }
  }

  function streamEnd(item, time) {
    const id = typeof item.tool_use_id === 'string' ? item.tool_use_id : ''
    const call = calls.get(id)
    if (!call || call.ended) return
    call.ended = true
    const ok = item.is_error !== true
    out.push({ ...toolEnd({ time, id, ok }), agent: call.owner })
    if (call.task) {
      const child = children.get(id)
      if (child && (!ok || (!call.background && (call.name.toLowerCase() === 'task' || heard.has(child))))) {
        out.push({ time, type: 'agent.end', agent: child, ok })
      }
    }
  }

  function hear(json) {
    const parentId = json?.parent_tool_use_id
    if (typeof parentId !== 'string' || parentId === '') return
    const child = children.get(parentId)
    if (child) heard.add(child)
  }

  function handleAcpx(json, time) {
    const name = json.name ?? ''
    let call = calls.get(json.toolCallId)
    if (!call) {
      call = { id: json.toolCallId, kind: kindOf(name), name, path: null, command: null, started: false, owner: parentKey }
      calls.set(json.toolCallId, call)
    }
    const fileName = FILE_NAME.exec(name)
    if (fileName && fileName[2] !== 'File' && !call.path) {
      call.kind = kindOf(fileName[1])
      call.path = fileName[2]
    } else if (call.kind === 'shell' && !call.command && !/^(terminal|tool call)/i.test(name)) {
      call.command = name
    }
    const finished = json.status === 'completed' || json.status === 'failed'
    const ready = FILE_KINDS.has(call.kind) ? Boolean(call.path) : call.kind === 'shell' ? Boolean(call.command) : true
    if (ready || finished) start(call, time)
    if (finished) {
      const output = call.kind === 'shell' ? json.text : ''
      out.push({ ...toolEnd({ time, id: call.id, ok: json.status === 'completed' && !looksFailed(output) }), agent: call.owner })
    }
  }

  function handleStream(json, time) {
    if (!json || (json.type !== 'assistant' && json.type !== 'user')) return
    const content = json.message?.content
    if (!Array.isArray(content)) return
    for (const item of content) {
      if (!item || typeof item !== 'object') continue
      if (json.type === 'assistant' && item.type === 'tool_use') streamStart(item, json, time)
      if (json.type === 'user' && item.type === 'tool_result') streamEnd(item, time)
    }
  }

  const reader = createLineReader((line, time) => {
    const json = parseJson(line)
    hear(json)
    if (json?.type === 'acpx.tool_call' && json.toolCallId) handleAcpx(json, time)
    else handleStream(json, time)
  })
  return {
    push(chunk, time) {
      out.length = 0
      reader.push(chunk, time)
      return [...out]
    },
    flush(time) {
      out.length = 0
      reader.flush(time)
      return [...out]
    },
  }
}
