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

  function startCall(id, tool, label, touches, time) {
    ensureRunStart(time)
    const call = { id, tool, label, touches, started: true }
    calls.set(id, call)
    out.push({ ...toolStart({ time, id, tool, label, touches }), agent: parentKey })
  }

  function endCall(id, ok, time) {
    calls.delete(id)
    out.push({ ...toolEnd({ time, id, ok }), agent: parentKey })
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
    if (/read|view/.test(toolName)) {
      const path = String(args.path ?? args.file ?? args.file_path ?? '')
      const touched = fileTouch(ctx, path, 'read')
      return {
        tool: 'read',
        label: labelFor('read', touched.relative, path),
        touches: touched.touches,
      }
    }
    if (/write|create/.test(toolName)) {
      const path = String(args.path ?? args.file ?? args.file_path ?? '')
      const touched = fileTouch(ctx, path, 'write')
      return {
        tool: 'write',
        label: labelFor('write', touched.relative, path),
        touches: touched.touches,
      }
    }
    if (/edit|patch|update/.test(toolName)) {
      const path = String(args.path ?? args.file ?? args.file_path ?? '')
      const touched = fileTouch(ctx, path, 'edit')
      return {
        tool: 'edit',
        label: labelFor('edit', touched.relative, path),
        touches: touched.touches,
      }
    }
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
      const { tool, label, touches } = classifyTool(name, json.parameters ?? json.arguments ?? json.input)
      startCall(id, tool, label, touches, time)
    } else if (isComplete) {
      if (!calls.has(id)) {
        const name = json.toolName ?? json.name ?? json.tool
        const { tool, label, touches } = classifyTool(name, json.parameters ?? json.arguments ?? json.input)
        startCall(id, tool, label, touches, time)
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

    match = PLAIN_READ.exec(line)
    if (match) {
      const path = match[1].trim()
      const touched = fileTouch(ctx, path, 'read')
      const id = `copilot-${(counter += 1)}`
      startCall(id, 'read', labelFor('read', touched.relative, path), touched.touches, time)
      endCall(id, true, time)
      return
    }

    match = PLAIN_WRITE.exec(line)
    if (match) {
      const path = match[1].trim()
      const touched = fileTouch(ctx, path, 'write')
      const id = `copilot-${(counter += 1)}`
      startCall(id, 'write', labelFor('write', touched.relative, path), touched.touches, time)
      endCall(id, true, time)
      return
    }

    match = PLAIN_EDIT.exec(line)
    if (match) {
      const path = match[1].trim()
      const touched = fileTouch(ctx, path, 'edit')
      const id = `copilot-${(counter += 1)}`
      startCall(id, 'edit', labelFor('edit', touched.relative, path), touched.touches, time)
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
