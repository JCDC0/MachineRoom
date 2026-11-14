import { commandTouch, createLineReader, fileTouch, labelFor, looksFailed, parseJson, shorten, toolEnd, toolStart } from './common.js'

const PLAIN_SHELL = /^\s*(?:Executing shell command|Executing command|Running command|Executing|Running|shell|\$)\s*[:(]?\s*(.+?)\s*\)?$/i
const PLAIN_READ = /^\s*(?:Reading file|Viewing file|Reading|read)\s*[:(]?\s*(.+?)\s*\)?$/i
const PLAIN_WRITE = /^\s*(?:Writing file|Creating file|Writing|write)\s*[:(]?\s*(.+?)\s*\)?$/i
const PLAIN_EDIT = /^\s*(?:Editing file|Patching file|Editing|edit|patch)\s*[:(]?\s*(.+?)\s*\)?$/i
const PLAIN_WEB = /^\s*(?:Searching the web for|Searching web|Fetching URL|web_search|web_fetch)\s*[:(]?\s*(.+?)\s*\)?$/i
const PLAIN_START = /^\s*(?:Session|Run|Copilot)\s+(?:started|began)/i
const PLAIN_END = /^\s*(?:Session|Run|Copilot)\s+(?:completed|finished|ended)/i

function parseArgs(raw) {
  if (raw && typeof raw === 'object') return raw
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') return parsed
    } catch {}
  }
  return {}
}

export function createCopilotParser(ctx) {
  const out = []
  const calls = new Map()
  let counter = 0
  let runStarted = false
  let runEnded = false
  const parentKey = ctx?.agentKey ?? 'agent'

  function ensureRunStart(time) {
    if (runStarted) return
    runStarted = true
    out.push({ time, type: 'run.start', agent: parentKey })
  }

  function ensureRunEnd(time, ok = true) {
    if (!runStarted || runEnded) return
    runEnded = true
    out.push({ time, type: 'run.end', ok, agent: parentKey })
  }

  function startCall(id, tool, label, touches, time, outsidePath) {
    ensureRunStart(time)
    const call = { id, tool, label, touches, started: true }
    calls.set(id, call)
    out.push({ ...toolStart({ time, id, tool, label, touches, outsidePath }), agent: parentKey })
  }

  function endCall(id, ok, time) {
    calls.delete(id)
    out.push({ ...toolEnd({ time, id, ok }), agent: parentKey })
  }

  function fileCall(path, tool) {
    const touched = fileTouch(ctx, path, tool)
    return {
      tool,
      label: labelFor(tool, touched.relative, path),
      touches: touched.touches,
      outsidePath: touched.outsidePath,
    }
  }

  function classifyTool(name, rawArgs) {
    const args = parseArgs(rawArgs)
    const toolName = String(name ?? '').toLowerCase()
    if (/shell|terminal|bash|command/.test(toolName)) {
      const command = String(args.command ?? args.cmd ?? args.input ?? '')
      return {
        tool: 'shell',
        label: `$ ${shorten(command || 'command')}`,
        touches: commandTouch(ctx, command),
      }
    }
    if (/web_search|web_fetch|websearch|webfetch|web/.test(toolName)) {
      const query = String(args.query ?? args.url ?? args.input ?? '')
      return {
        tool: 'web',
        label: shorten(query || 'web search'),
        touches: [],
      }
    }
    if (/read|view/.test(toolName)) return fileCall(String(args.path ?? args.file ?? args.file_path ?? ''), 'read')
    if (/write|create/.test(toolName)) return fileCall(String(args.path ?? args.file ?? args.file_path ?? ''), 'write')
    if (/edit|patch|update/.test(toolName)) return fileCall(String(args.path ?? args.file ?? args.file_path ?? ''), 'edit')
    return {
      tool: 'other',
      label: shorten(name || 'tool'),
      touches: [],
    }
  }

  function handleJson(json, time) {
    const type = String(json.type ?? '')
    if (type === 'session.start' || type === 'run.start') {
      ensureRunStart(time)
      return
    }
    if (type === 'session.end' || type === 'session.completed' || type === 'session.task_complete' || type === 'run.end') {
      ensureRunEnd(time, !json.error)
      return
    }

    const isStart = type === 'tool.execution_start' || type === 'tool_call' || type === 'tool_use' || type === 'tool'
    const isComplete = type === 'tool.execution_complete' || type === 'tool_result' || type === 'tool_end'
    if (!isStart && !isComplete) return

    const id = String(json.toolCallId ?? json.id ?? `copilot-${(counter += 1)}`)
    if (isStart) {
      const name = json.toolName ?? json.name ?? json.tool
      const { tool, label, touches, outsidePath } = classifyTool(name, json.parameters ?? json.arguments ?? json.input)
      startCall(id, tool, label, touches, time, outsidePath)
    } else if (isComplete) {
      if (!calls.has(id)) {
        const name = json.toolName ?? json.name ?? json.tool
        const { tool, label, touches, outsidePath } = classifyTool(name, json.parameters ?? json.arguments ?? json.input)
        startCall(id, tool, label, touches, time, outsidePath)
      }
      const exitCode = json.exit_code
      let ok = true
      if (exitCode !== undefined && exitCode !== null && exitCode !== 0) ok = false
      else if (json.status === 'failed' || json.status === 'error') ok = false
      else if (json.error || looksFailed(json.output)) ok = false
      endCall(id, ok, time)
    }
  }

  function handlePlain(line, time) {
    if (PLAIN_START.test(line)) {
      ensureRunStart(time)
      return
    }
    if (PLAIN_END.test(line)) {
      ensureRunEnd(time, true)
      return
    }

    let match = PLAIN_SHELL.exec(line)
    if (match) {
      const command = match[1].trim()
      const id = `copilot-${(counter += 1)}`
      startCall(id, 'shell', `$ ${shorten(command || 'command')}`, commandTouch(ctx, command), time)
      endCall(id, !looksFailed(line), time)
      return
    }

    for (const [pattern, tool] of [[PLAIN_READ, 'read'], [PLAIN_WRITE, 'write'], [PLAIN_EDIT, 'edit']]) {
      match = pattern.exec(line)
      if (!match) continue
      const call = fileCall(match[1].trim(), tool)
      const id = `copilot-${(counter += 1)}`
      startCall(id, call.tool, call.label, call.touches, time, call.outsidePath)
      endCall(id, true, time)
      return
    }

    match = PLAIN_WEB.exec(line)
    if (match) {
      const query = match[1].trim()
      const id = `copilot-${(counter += 1)}`
      startCall(id, 'web', shorten(query || 'web search'), [], time)
      endCall(id, true, time)
    }
  }

  const reader = createLineReader((line, time) => {
    const json = parseJson(line)
    if (json && typeof json === 'object') {
      handleJson(json, time)
    } else {
      handlePlain(line, time)
    }
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
      for (const [id] of calls) {
        out.push({ ...toolEnd({ time, id, ok: true }), agent: parentKey })
      }
      calls.clear()
      ensureRunEnd(time, true)
      return [...out]
    },
  }
}
