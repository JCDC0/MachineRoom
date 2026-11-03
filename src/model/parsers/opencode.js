import { basename } from '../paths.js'
import { commandTouch, createLineReader, fileTouch, folderTouch, labelFor, looksFailed, mcpLabelOf, mcpPathOf, parseJson, shorten, toolEnd, toolStart } from './common.js'

const TOOLS = { shell: 'shell', bash: 'shell', read: 'read', write: 'write', edit: 'edit', glob: 'search', grep: 'search', list: 'search', websearch: 'web', webfetch: 'web' }
const MCP_TOOL = /^(mcp__|mcp_call_tool$|mcp_list_tools$)/
const OUTPUT_PATH = /(?:Created file successfully|Edited|Wrote|Updated|Written)[:\s]+(\S+)/i
const MASK = '***REDACTED***'
const BROKEN_TOOL = /"tool"\s*:\s*"(shell|read|write|edit)"/
const BROKEN_STATUS = /"status"\s*:\s*"(completed|error|running)"/
const BROKEN_ID = /"id"\s*:\s*"([^"\\]+)"/
const BROKEN_COMMAND = /"input"\s*:\s*\{\s*"command"\s*:\s*"/
const BROKEN_PATH = /"input"\s*:\s*\{\s*"(?:path|filePath)"\s*:\s*"([^"\\]*)"/

function unescape(text) {
  return text.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (all, code) => {
    if (code === 'n') return '\n'
    if (code === 'r') return '\r'
    if (code === 't') return '\t'
    if (code[0] === 'u') return String.fromCharCode(parseInt(code.slice(1), 16))
    return code
  })
}

export function recoverCall(line) {
  if (!/"type"\s*:\s*"tool_use"/.test(line) || !line.includes(MASK)) return null
  const maskAt = line.indexOf(MASK)
  const tool = BROKEN_TOOL.exec(line)
  if (!tool || tool.index > maskAt) return null
  const status = BROKEN_STATUS.exec(line)
  const id = BROKEN_ID.exec(line)
  const input = {}
  if (tool[1] === 'shell') {
    const at = BROKEN_COMMAND.exec(line)
    if (!at || at.index > maskAt) return null
    const raw = line.slice(at.index + at[0].length, maskAt)
    if (!raw.trim()) return null
    input.command = unescape(raw)
  } else {
    const found = BROKEN_PATH.exec(line)
    if (!found || !found[1]) return null
    input.path = unescape(found[1])
  }
  return { name: tool[1], input, status: status?.[1], id: id?.[1] }
}

export function createOpencodeParser(ctx) {
  const out = []
  let counter = 0
  let children = 0

  const reader = createLineReader((line, time) => {
    const json = parseJson(line)
    if (!json) {
      const recovered = recoverCall(line)
      if (recovered) report(recovered.name, recovered.input, recovered.status, '', recovered.id, time)
      return
    }
    if (json.type === 'error') {
      out.push({ time, type: 'error', text: shorten(json.error?.message ?? 'error', 140) })
      return
    }
    if (json.type !== 'tool_use') return
    const part = json.part ?? {}
    const state = part.state ?? {}
    report(part.tool, state.input ?? {}, state.status, state.output, part.id, time)
  })

  function report(name, input, status, output, id, time) {
    const lower = String(name ?? '').toLowerCase()
    const mcp = MCP_TOOL.test(lower)
    const tool = mcp ? 'mcp' : Object.hasOwn(TOOLS, lower) ? TOOLS[lower] : 'other'
    const callId = id ?? `opencode-${(counter += 1)}`
    let touches = []
    let label = `${name} ${shorten(JSON.stringify(input), 48)}`
    if (tool === 'mcp') {
      const shown = mcpLabelOf(lower, input)
      const raw = mcpPathOf(input)
      label = shown
      if (raw !== '') {
        const touched = fileTouch(ctx, raw, 'read')
        touches = touched.touches
        label = `${shown} ${touched.relative === null ? basename(raw) : touched.relative}`
      }
    } else if (tool === 'read' || tool === 'write' || tool === 'edit') {
      const raw = input.path ?? input.filePath ?? OUTPUT_PATH.exec(String(output ?? ''))?.[1]
      label = `${tool} file`
      if (raw) {
        const touched = fileTouch(ctx, raw, tool)
        touches = touched.touches
        label = labelFor(tool, touched.relative, raw)
      }
    } else if (tool === 'shell') {
      const command = input.command ?? ''
      touches = commandTouch(ctx, command)
      label = `$ ${shorten(command)}`
    } else if (tool === 'search') {
      const raw = typeof input.path === 'string' ? input.path : ''
      const touch = folderTouch(ctx, raw)
      if (touch) touches = [touch]
      label = `${name} ${touch ? touch.path || '.' : basename(raw) || '.'}`
    } else if (tool === 'web') {
      const shown = name === 'webfetch' ? input.url ?? '' : input.query ?? ''
      label = shown ? `web ${name === 'webfetch' ? 'fetch' : 'search'} ${shorten(shown)}` : `web ${name === 'webfetch' ? 'fetch' : 'search'}`
    } else if (name === 'subagent') {
      const description = shorten(typeof input.description === 'string' ? input.description : '')
      label = description ? `subagent: ${description}` : 'subagent'
    }
    const failed = status === 'error' || (tool === 'shell' && looksFailed(output))
    out.push(toolStart({ time: time - 300, id: callId, tool, label, touches }))
    out.push(toolEnd({ time, id: callId, ok: !failed }))
    if (name === 'subagent') {
      const parent = ctx.agentKey ?? 'agent'
      const child = `${parent}~${(children += 1)}`
      const description = typeof input.description === 'string' ? input.description : ''
      const spawned = shorten(description || 'subagent', 40)
      out.push({ time, type: 'agent.spawn', agent: parent, child, name: spawned, label })
      out.push({ time, type: 'agent.end', agent: child, ok: !failed })
    }
  }

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
