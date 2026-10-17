import { commandTouch, createLineReader, fileTouch, labelFor, looksFailed, parseJson, shorten, toolEnd, toolStart } from './common.js'

const KINDS = [
  [/^read/i, 'read'],
  [/^(edit|multiedit|notebookedit)/i, 'edit'],
  [/^(write|create)/i, 'write'],
  [/^(terminal|bash|shell)/i, 'shell'],
  [/^(glob|grep|search|find|ls|list)/i, 'search'],
]
const FILE_NAME = /^(Read|Edit|MultiEdit|NotebookEdit|Write)\s+(.+)$/i
const FILE_KINDS = new Set(['read', 'edit', 'write'])

function kindOf(name) {
  return KINDS.find(([pattern]) => pattern.test(name))?.[1] ?? 'other'
}

export function createClaudeParser(ctx) {
  const calls = new Map()
  const out = []

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
    }
    out.push(toolStart({ time, id: call.id, tool: call.kind, label, touches }))
  }

  function handle(json, time) {
    if (json?.type !== 'acpx.tool_call' || !json.toolCallId) return
    const name = json.name ?? ''
    let call = calls.get(json.toolCallId)
    if (!call) {
      call = { id: json.toolCallId, kind: kindOf(name), name, path: null, command: null, started: false }
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
      out.push(toolEnd({ time, id: call.id, ok: json.status === 'completed' && !looksFailed(output) }))
    }
  }

  const reader = createLineReader((line, time) => handle(parseJson(line), time))
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
