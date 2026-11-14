import { commandTouch, createLineReader, fileTouch, labelFor, looksFailed, parseJson, shorten, toolEnd, toolStart } from './common.js'

function isWrite(kind) {
  return /^(add|create|new|write)/i.test(String(kind ?? ''))
}

export function createCodexParser(ctx) {
  const out = []
  const calls = new Map()
  let counter = 0
  const parentKey = ctx?.agentKey ?? 'agent'

  function startCall(id, tool, label, touches, time, outsidePath) {
    const call = { id, tool, label, touches, started: true }
    calls.set(id, call)
    out.push({ ...toolStart({ time, id, tool, label, touches, outsidePath }), agent: parentKey })
  }

  function endCall(id, ok, time) {
    calls.delete(id)
    out.push({ ...toolEnd({ time, id, ok }), agent: parentKey })
  }

  function handleCommand(item, isComplete, time) {
    const id = String(item.id ?? `cmd-${(counter += 1)}`)
    const command = typeof item.command === 'string' ? item.command : ''
    if (!calls.has(id)) {
      const touches = commandTouch(ctx, command)
      const label = `$ ${shorten(command || 'command')}`
      startCall(id, 'shell', label, touches, time)
    }
    if (isComplete) {
      const exitCode = item.exit_code
      let ok = true
      if (exitCode !== undefined && exitCode !== null && exitCode !== 0) ok = false
      else if (item.status === 'failed' || item.status === 'error') ok = false
      else if (item.error || looksFailed(item.output)) ok = false
      endCall(id, ok, time)
    }
  }

  function handleFileChange(item, isComplete, time) {
    const id = String(item.id ?? `file-${(counter += 1)}`)
    const changes = Array.isArray(item.changes) ? item.changes : []
    if (changes.length === 0 && (item.path || item.file)) {
      changes.push({ path: item.path || item.file, kind: item.kind ?? 'update' })
    }
    if (!calls.has(id)) {
      const touches = []
      let firstRel = null
      let firstRaw = null
      let outsidePath
      let tool = 'edit'
      for (const change of changes) {
        const rawPath = change.path ?? change.file
        if (!rawPath) continue
        const changeTool = isWrite(change.kind) ? 'write' : 'edit'
        if (tool !== 'write' && changeTool === 'write') tool = 'write'
        const touched = fileTouch(ctx, rawPath, changeTool)
        touches.push(...touched.touches)
        if (!outsidePath && touched.outsidePath) outsidePath = touched.outsidePath
        if (firstRel === null) {
          firstRel = touched.relative
          firstRaw = rawPath
        }
      }
      const label = firstRaw ? labelFor(tool, firstRel, firstRaw) : 'edit file'
      startCall(id, tool, label, touches, time, outsidePath)
    }
    if (isComplete) {
      const ok = item.status !== 'failed' && item.status !== 'error' && !item.error
      endCall(id, ok, time)
    }
  }

  function handleWebSearch(item, isComplete, time) {
    const id = String(item.id ?? `web-${(counter += 1)}`)
    const query = typeof item.query === 'string' ? item.query : ''
    if (!calls.has(id)) {
      const label = shorten(query || 'web search')
      startCall(id, 'web', label, [], time)
    }
    if (isComplete) {
      const ok = item.status !== 'failed' && item.status !== 'error' && !item.error
      endCall(id, ok, time)
    }
  }

  const reader = createLineReader((line, time) => {
    const json = parseJson(line)
    if (!json || typeof json !== 'object') return
    const type = json.type
    const item = json.item
    if (!item || typeof item !== 'object') return

    const isStart = type === 'item.started'
    const isComplete = type === 'item.completed'
    if (!isStart && !isComplete) return

    const itemType = item.type
    if (itemType === 'command_execution') {
      handleCommand(item, isComplete, time)
    } else if (itemType === 'file_change') {
      handleFileChange(item, isComplete, time)
    } else if (itemType === 'web_search') {
      handleWebSearch(item, isComplete, time)
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
      return [...out]
    },
  }
}
