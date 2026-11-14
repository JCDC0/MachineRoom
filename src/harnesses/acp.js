import { relativeTo } from '../model/paths.js'
import { commandTouch, createLineReader, fileTouch, labelFor, parseJson, shorten, toolEnd, toolStart } from '../model/parsers/common.js'
import { expandBin, headLines, jsonLineReader, sumTokens, terminalText } from './common.js'

const FILE_KINDS = new Set(['read', 'edit', 'delete', 'move'])
const DONE = new Set(['completed', 'failed'])
const TOOL_BY_KIND = {
  read: 'read',
  edit: 'edit',
  delete: 'write',
  move: 'write',
  search: 'search',
  execute: 'shell',
  think: 'other',
  fetch: 'other',
  switch_mode: 'other',
  other: 'other',
}

function updateOf(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  const params = item.method === 'session/update' && item.params && typeof item.params === 'object' ? item.params : item
  const update = params.update && typeof params.update === 'object'
    ? params.update
    : typeof params.sessionUpdate === 'string'
      ? params
      : null
  if (!update || typeof update.sessionUpdate !== 'string') return null
  return { sessionId: typeof params.sessionId === 'string' ? params.sessionId : null, update }
}

function childMeta(update) {
  const meta = update?._meta
  if (!meta || typeof meta !== 'object') return null
  for (const [key, value] of Object.entries(meta)) {
    if (!key.endsWith('child-session')) continue
    if (value && typeof value === 'object' && typeof value.id === 'string' && value.id) return value
  }
  return null
}

function locationPaths(update) {
  const found = []
  for (const location of Array.isArray(update.locations) ? update.locations : []) {
    const path = typeof location === 'string' ? location : location?.path
    if (typeof path === 'string' && path.trim() !== '') found.push(path)
  }
  if (found.length > 0) return [...new Set(found)]
  const input = update.rawInput && typeof update.rawInput === 'object' ? update.rawInput : {}
  for (const key of ['path', 'filePath', 'file_path', 'target', 'targetFile', 'source', 'destination']) {
    const value = input[key]
    if (typeof value === 'string' && value.trim() !== '') found.push(value)
  }
  return [...new Set(found)]
}

function commandOf(update) {
  const input = update.rawInput && typeof update.rawInput === 'object' ? update.rawInput : {}
  for (const key of ['command', 'cmd', 'commandLine']) {
    const value = input[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return ''
}

function kindOf(update, call) {
  const kind = typeof update.kind === 'string' && update.kind ? update.kind : call.kind
  return Object.hasOwn(TOOL_BY_KIND, kind) ? kind : 'other'
}

function folderTouch(ctx, raw) {
  const relative = relativeTo(ctx.rootName, raw)
  if (relative === null) return null
  return { path: relative, mode: 'list', kind: 'dir' }
}

function fileInfoFor(ctx, kind, update) {
  const mode = kind === 'read' ? 'read' : 'write'
  const touches = []
  let outsidePath
  for (const path of locationPaths(update)) {
    const touched = fileTouch(ctx, path, mode)
    touches.push(...touched.touches)
    if (!outsidePath && touched.outsidePath) outsidePath = touched.outsidePath
  }
  return { touches, outsidePath: touches.length > 0 ? undefined : outsidePath }
}

function touchesFor(ctx, kind, update) {
  if (kind === 'execute') return commandTouch(ctx, commandOf(update))
  if (kind === 'search') return locationPaths(update).map((path) => folderTouch(ctx, path)).filter(Boolean)
  if (!FILE_KINDS.has(kind)) return []
  return fileInfoFor(ctx, kind, update).touches
}

function titleOf(update, call) {
  const title = typeof update.title === 'string' ? update.title.trim() : ''
  if (title) return title
  const name = typeof update.name === 'string' ? update.name.trim() : ''
  return name || call.name || call.kind || 'tool'
}

function labelOf(ctx, call, update) {
  if (call.kind === 'execute') return `$ ${shorten(commandOf(update) || titleOf(update, call))}`
  if (call.kind === 'search') {
    const paths = locationPaths(update)
    const first = paths[0]
    const relative = first === undefined ? null : relativeTo(ctx.rootName, first)
    const shown = relative === null ? (first ? String(first).split(/[\\/]/).pop() : '.') : relative || '.'
    return `search ${shown}`
  }
  if (FILE_KINDS.has(call.kind)) {
    const paths = locationPaths(update)
    const first = paths[0]
    if (first === undefined) return `${call.tool} file`
    const touched = fileTouch(ctx, first, call.kind === 'read' ? 'read' : 'write')
    const label = labelFor(call.tool, touched.relative, first)
    return paths.length > 1 ? `${label} +${paths.length - 1}` : label
  }
  const description = update.rawInput?.description
  if (typeof description === 'string' && description.trim()) return `${titleOf(update, call)}: ${shorten(description)}`
  return titleOf(update, call)
}

export function createAcpParser(ctx) {
  const out = []
  const calls = new Map()
  const children = new Map()
  const childCounts = new Map()
  const parentKey = ctx.agentKey ?? 'agent'
  let parentSessionId = null

  function spawnChild(id, title, parentId, time) {
    const known = children.get(id)
    if (known) return known
    const holder = parentId && children.has(parentId) ? children.get(parentId) : null
    const parent = holder ? holder.key : parentKey
    const number = (childCounts.get(parent) ?? 0) + 1
    childCounts.set(parent, number)
    const name = shorten(String(title ?? '').trim() || `subagent ${number}`, 40)
    const child = { id, key: `${parent}~${number}`, name, title: String(title ?? '').trim(), ended: false }
    children.set(id, child)
    out.push({ time, type: 'agent.spawn', agent: parent, child: child.key, name, label: `subagent: ${name}` })
    return child
  }

  function childFor(update, sessionId, time) {
    const meta = childMeta(update)
    if (meta) return spawnChild(meta.id, meta.title ?? meta.name, meta.parentID, time)
    if (sessionId && parentSessionId && sessionId !== parentSessionId) {
      return spawnChild(sessionId, update._meta?.title, null, time)
    }
    const id = typeof update.toolCallId === 'string' ? update.toolCallId : ''
    for (const child of children.values()) {
      if (id.startsWith(`${child.id}:`)) return child
    }
    return null
  }

  function endChild(child, ok, time) {
    if (child.ended) return
    child.ended = true
    out.push({ time, type: 'agent.end', agent: child.key, ok })
  }

  function endForCall(call, ok, time) {
    const description = typeof call.input?.description === 'string' ? call.input.description.trim().toLowerCase() : ''
    const open = [...children.values()].filter((child) => !child.ended)
    if (open.length === 0) return
    const match = description ? open.find((child) => child.title.toLowerCase() === description) : null
    if (match) {
      endChild(match, ok, time)
      return
    }
    if (call.name === 'subagent') {
      for (const child of open) endChild(child, ok, time)
    }
  }

  function startCall(call, update, time) {
    if (call.started) return
    call.started = true
    const activity = toolStart({
      time,
      id: call.id,
      tool: call.tool,
      label: labelOf(ctx, call, update),
      touches: call.touches,
      outsidePath: call.outsidePath,
    })
    out.push(call.owner ? { ...activity, agent: call.owner.key } : activity)
  }

  function updateCall(update, sessionId, time) {
    const id = typeof update.toolCallId === 'string' ? update.toolCallId : ''
    if (!id) return
    const owner = childFor(update, sessionId, time)
    let call = calls.get(id)
    if (!call) {
      call = {
        id,
        owner,
        started: false,
        ended: false,
        kind: 'other',
        name: '',
        title: '',
        status: 'pending',
        input: {},
        tool: 'other',
        touches: [],
        outsidePath: undefined,
      }
      calls.set(id, call)
    }
    if (!call.owner && owner) call.owner = owner
    if (typeof update.name === 'string' && update.name) call.name = update.name
    if (typeof update.title === 'string' && update.title) call.title = update.title
    if (typeof update.status === 'string' && update.status) call.status = update.status
    if (update.rawInput && typeof update.rawInput === 'object') call.input = { ...call.input, ...update.rawInput }
    call.kind = kindOf(update, call)
    call.tool = TOOL_BY_KIND[call.kind]
    if (FILE_KINDS.has(call.kind)) {
      const info = fileInfoFor(ctx, call.kind, update)
      call.touches = info.touches
      call.outsidePath = info.outsidePath
    } else {
      call.touches = touchesFor(ctx, call.kind, update)
      call.outsidePath = undefined
    }
    const finished = DONE.has(call.status)
    const described = typeof call.input.description === 'string' && call.input.description.trim() !== ''
    const wantsDescription = call.name === 'subagent' && !described
    const ready = (!FILE_KINDS.has(call.kind) && !wantsDescription) || call.touches.length > 0 || Boolean(call.outsidePath) || finished
    if (ready) startCall(call, update, time)
    if (!finished || call.ended) return
    call.ended = true
    const ok = call.status === 'completed'
    out.push({ ...toolEnd({ time, id: call.id, ok }), ...(call.owner ? { agent: call.owner.key } : {}) })
    if (call.name === 'subagent' || call.kind === 'think') endForCall(call, ok, time)
  }

  const reader = createLineReader((line, time) => {
    const item = parseJson(line)
    if (!item) return
    if (item.type === 'acp_session' && typeof item.sessionId === 'string') {
      parentSessionId = item.sessionId
      return
    }
    const entry = updateOf(item)
    if (!entry) return
    const { sessionId, update } = entry
    if (!parentSessionId && sessionId) parentSessionId = sessionId
    if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
      updateCall(update, sessionId, time)
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
      for (const child of children.values()) endChild(child, true, time)
      return [...out]
    },
  }
}

function sessionOf(item) {
  if (item?.type === 'acp_session' && typeof item.sessionId === 'string') return item.sessionId
  return updateOf(item)?.sessionId ?? null
}

function parentSession(log) {
  let first = null
  for (const line of String(log ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue
    const item = parseJson(line)
    if (item?.type === 'acp_session' && typeof item.sessionId === 'string') return item.sessionId
    if (!first) first = sessionOf(item)
  }
  return first
}

function acpReply(log) {
  const parent = parentSession(log)
  const messages = new Map()
  for (const line of String(log ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue
    const item = parseJson(line)
    const entry = updateOf(item)
    if (!entry || entry.update.sessionUpdate !== 'agent_message_chunk') continue
    if (childMeta(entry.update)) continue
    if (parent && entry.sessionId && entry.sessionId !== parent) continue
    const text = entry.update.content?.text
    if (typeof text !== 'string') continue
    const id = typeof entry.update.messageId === 'string' ? entry.update.messageId : `message-${messages.size + 1}`
    messages.set(id, (messages.get(id) ?? '') + text)
  }
  const kept = [...messages.values()].filter((text) => text.trim() !== '')
  return terminalText(kept.length > 0 ? kept[kept.length - 1] : '')
}

function acpUsage(log) {
  let cost = null
  let result = null
  for (const line of String(log ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue
    const item = parseJson(line)
    if (item?.type === 'acp_result') result = item
    const entry = updateOf(item)
    if (entry?.update.sessionUpdate !== 'usage_update') continue
    const amount = entry.update.cost?.amount
    if (typeof amount === 'number' && Number.isFinite(amount)) cost = amount
  }
  const usage = result?.usage && typeof result.usage === 'object' ? result.usage : {}
  return {
    costUsd: cost === null ? null : Math.round(cost * 1e6) / 1e6,
    inputTokens: sumTokens([usage.inputTokens, usage.cachedReadTokens]),
    outputTokens: sumTokens([usage.outputTokens, usage.thoughtTokens]),
  }
}

function acpLineReader() {
  const read = jsonLineReader(createAcpParser)
  return function readLine(line, at = null) {
    const entry = read(line, at)
    if (!entry || entry.read) return entry
    const update = updateOf(parseJson(line))?.update
    if (!update) return entry
    if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') return { ...entry, read: true }
    return entry
  }
}

export const acpHarness = {
  key: 'acp',
  name: 'ACP',
  laneName: 'ACP',
  defaultProgram: 'acp',
  adapterType: 'acp_local',
  transport: 'acp',
  createParser: createAcpParser,
  command({ cli, env = {}, folder } = {}) {
    const args = Array.isArray(cli?.args) ? cli.args.map(String) : []
    return { file: expandBin(cli?.bin, env), args, cwd: folder, transport: 'acp' }
  },
  readLine() {
    return acpLineReader()
  },
  report(log) {
    return headLines(acpReply(log))
  },
  reply(log) {
    return acpReply(log)
  },
  usage(log) {
    return acpUsage(log)
  },
}
