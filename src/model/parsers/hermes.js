import { indexFor } from '../fileIndex.js'
import { basename, dirname, resolveKnown } from '../paths.js'
import { commandTouch, createLineReader, fileTouch, labelFor, parseJson, shorten, toolEnd, toolStart } from './common.js'

export const LINE = /^\s*┊\s+\S+\s+(\$|[a-z_]+)\s+(.+?)\s+(\d+(?:\.\d+)?)s(?:\s+\[(exit (\d+)|error)\])?\s*$/u
const VERBS = { read: 'read', write: 'write', patch: 'edit', find: 'search', search: 'web', grep: 'search', fetch: 'web', $: 'shell' }
const TOOLS = { read_file: 'read', write_file: 'write', patch: 'edit', terminal: 'shell', search_files: 'search' }
const WEB_TOOLS = { web_search: 'search', search_web: 'search', web_fetch: 'fetch', fetch_url: 'fetch' }
const WEB = /^web_/

function toolFor(name) {
  if (Object.hasOwn(TOOLS, name)) return TOOLS[name]
  if (Object.hasOwn(WEB_TOOLS, name) || WEB.test(name)) return 'web'
  return 'other'
}

function argObject(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw
  if (typeof raw !== 'string') return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function firstText(value, keys) {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return ''
  for (const key of keys) {
    if (typeof value[key] === 'string' && value[key].trim() !== '') return value[key].trim()
  }
  return ''
}

function delegateGoal(tasks) {
  let list = tasks
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list)
    } catch {
      return list.trim()
    }
  }
  return firstText(Array.isArray(list) ? list[0] : list, ['goal', 'description', 'task', 'prompt', 'name'])
}

export function createHermesParser(ctx) {
  const out = []
  const open = new Map()
  const children = new Map()
  let counter = 0
  let spawned = 0
  let near
  const parentKey = ctx.agentKey ?? 'agent'

  function childFor(json, time) {
    const marker = typeof json.agent === 'string' ? json.agent.trim() : ''
    if (marker === '') return ''
    const known = children.get(marker)
    if (known) return known
    const key = `${parentKey}~${(spawned += 1)}`
    children.set(marker, key)
    const raw = typeof json.agentName === 'string' ? json.agentName.trim() : ''
    const name = raw || `subagent ${spawned}`
    out.push({ time, type: 'agent.spawn', agent: parentKey, child: key, name: shorten(name, 40), label: name })
    return key
  }

  function startCall(json, time) {
    const name = typeof json.name === 'string' ? json.name : ''
    const args = argObject(json.args)
    const id = typeof json.id === 'string' && json.id !== '' ? json.id : `hermes-${(counter += 1)}`
    const owner = childFor(json, time)
    const tool = toolFor(name)
    let touches = []
    let outsidePath
    let label = name || 'tool'
    if (tool === 'read' || tool === 'write' || tool === 'edit') {
      const raw = typeof args.path === 'string' ? args.path : ''
      if (raw !== '') {
        const touched = fileTouch(ctx, raw, tool)
        touches = touched.touches
        outsidePath = touched.outsidePath
        label = labelFor(tool, touched.relative, raw)
      } else {
        label = `${tool} file`
      }
    } else if (tool === 'shell') {
      const command = typeof args.command === 'string' ? args.command : ''
      const workdir = typeof args.workdir === 'string' ? args.workdir : ''
      touches = commandTouch(ctx, command || workdir)
      label = `$ ${shorten(command || workdir || 'terminal')}`
    } else if (tool === 'search') {
      const pattern = typeof args.pattern === 'string' ? args.pattern.trim() : ''
      const folder = typeof args.path === 'string' ? args.path.trim() : ''
      const shown = shorten(pattern) || basename(folder) || ''
      label = shown ? `search ${shown}` : 'search'
    } else if (tool === 'web') {
      const verb = Object.hasOwn(WEB_TOOLS, name) ? WEB_TOOLS[name] : 'search'
      const value = verb === 'fetch' ? args.url ?? args.URL : args.query ?? args.q
      const shown = typeof value === 'string' ? shorten(value) : ''
      label = shown ? `web ${verb} ${shown}` : `web ${verb}`
    }
    const goal = name === 'delegate_task' ? delegateGoal(args.tasks) : ''
    if (name === 'delegate_task') label = goal ? `delegate ${shorten(goal)}` : 'delegate'
    const call = { owner, child: '' }
    open.set(id, call)
    out.push({ ...toolStart({ time, id, tool, label, touches, outsidePath }), ...(owner ? { agent: owner } : {}) })
    if (name === 'delegate_task') {
      call.child = `${parentKey}~${(spawned += 1)}`
      out.push({ time, type: 'agent.spawn', agent: parentKey, child: call.child, name: shorten(goal || 'delegate', 40), label })
    }
  }

  function endCall(json, time) {
    const id = typeof json.id === 'string' ? json.id : ''
    const call = open.get(id)
    if (!call) return
    open.delete(id)
    const ok = json.ok !== false
    out.push({ ...toolEnd({ time, id, ok }), ...(call.owner ? { agent: call.owner } : {}) })
    if (call.child) out.push({ time, type: 'agent.end', agent: call.child, ok })
  }

  const reader = createLineReader((line, time) => {
    const json = parseJson(line)
    if (json && typeof json === 'object' && typeof json.hermes === 'string') {
      if (json.hermes === 'call') startCall(json, time)
      else if (json.hermes === 'result') endCall(json, time)
      return
    }
    const found = LINE.exec(line)
    if (!found) return
    const [, verb, detail, seconds, mark, exit] = found
    const tool = Object.hasOwn(VERBS, verb) ? VERBS[verb] : 'other'
    const id = `hermes-${(counter += 1)}`
    const startTime = time - Math.round(Number(seconds) * 1000)
    const ok = !mark || (exit !== undefined && Number(exit) === 0)
    let touches = []
    let outsidePath
    let label = `${verb} ${shorten(detail)}`
    if (tool === 'read' || tool === 'write' || tool === 'edit') {
      const bare = !/[\\/]/.test(detail)
      const named = resolveKnown(detail, ctx.files, bare ? near : undefined)
      const touched = fileTouch(ctx, named, tool)
      touches = touched.touches
      outsidePath = touched.outsidePath
      if (touched.relative && (indexFor(ctx.files).has(touched.relative) || dirname(touched.relative) !== '')) {
        near = dirname(touched.relative)
      }
      label = labelFor(tool, touched.relative, named)
    } else if (tool === 'shell') {
      const command = detail.replace(/\s+\+\s+\d+\s+commands?$/, '')
      touches = commandTouch(ctx, command)
      label = `$ ${shorten(command)}`
    } else if (tool === 'search') {
      label = `${verb} ${verb === 'grep' ? shorten(detail) : basename(detail)}`
    } else if (tool === 'web') {
      label = `web ${verb === 'fetch' ? 'fetch' : 'search'} ${shorten(detail)}`
    }
    out.push(toolStart({ time: startTime, id, tool, label, touches, outsidePath }))
    out.push(toolEnd({ time, id, ok }))
    if (verb === 'delegate') {
      const child = `${parentKey}~${(spawned += 1)}`
      const goal = detail.replace(/^\d+x:\s*/i, '').replace(/(?:\.\.\.|…)\s*$/u, '')
      out.push({ time, type: 'agent.spawn', agent: parentKey, child, name: shorten(goal || 'delegate', 40), label })
      out.push({ time, type: 'agent.end', agent: child, ok })
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
      return [...out]
    },
  }
}
