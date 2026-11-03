import { commandTouch, createLineReader, fileTouch, labelFor, looksFailed, parseJson, shorten, toolEnd, toolStart } from './common.js'

const TOOLS = {
  view_file: ['read', 'AbsolutePath'],
  read_file: ['read', 'Path'],
  write_to_file: ['write', 'TargetFile'],
  write_file: ['write', 'Path'],
  replace_file_content: ['edit', 'TargetFile'],
  multi_replace_file_content: ['edit', 'TargetFile'],
  edit_file: ['edit', 'Path'],
  run_command: ['shell', 'CommandLine'],
  search_web: ['web', null],
  read_url_content: ['web', null],
}
const WEB_FIELDS = {
  search_web: ['query', 'Query'],
  read_url_content: ['url', 'Url', 'URL'],
}

function webLabel(name, value) {
  const verb = name === 'read_url_content' ? 'fetch' : 'search'
  return value ? `web ${verb} ${shorten(value)}` : `web ${verb}`
}

function subagentList(output) {
  const text = String(output ?? '')
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end <= start) return []
  try {
    const list = JSON.parse(text.slice(start, end + 1))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function createAgyParser(ctx) {
  const out = []
  const started = new Set()
  const calls = new Map()
  const conversations = new Map()
  const invoked = new Map()
  const pending = new Map()
  const parentKey = ctx.agentKey ?? 'agent'
  const parent = { key: null, doneAt: null, doneOk: true }
  let parentConversation
  let children = 0

  function credit(entry, activity) {
    return entry.key ? { ...activity, agent: entry.key } : activity
  }

  function begin(step, entry, time, id) {
    if (started.has(id)) return
    started.add(id)
    const [tool, field] = Object.hasOwn(TOOLS, step.tool_name) ? TOOLS[step.tool_name] : ['other', null]
    const value = field ? step.tool_info?.parameters?.[field] : null
    let touches = []
    let label = step.tool_name ?? 'tool'
    if (value && (tool === 'read' || tool === 'write' || tool === 'edit')) {
      const touched = fileTouch(ctx, value, tool)
      touches = touched.touches
      label = labelFor(tool, touched.relative, value)
    } else if (value && tool === 'shell') {
      touches = commandTouch(ctx, value)
      label = `$ ${shorten(value)}`
    } else if (tool === 'web') {
      const fields = WEB_FIELDS[step.tool_name] ?? []
      const shown = fields
        .map((name) => step.tool_info?.parameters?.[name])
        .find((item) => typeof item === 'string' && item.trim() !== '')
      label = webLabel(step.tool_name, shown ? shown.trim() : '')
    }
    const err = typeof step.tool_info?.error === 'string' ? step.tool_info.error.trim() : ''
    if (err) label = `${label}: ${shorten(err)}`
    calls.set(id, label)
    out.push(credit(entry, toolStart({ time, id, tool, label, touches })))
  }

  function newChild() {
    const number = (children += 1)
    return { key: `${parentKey}~${number}`, doneAt: null, doneOk: true, ended: false, spawned: false }
  }

  function spawnChild(child, name, label, time) {
    if (child.spawned) return
    child.spawned = true
    out.push({ time, type: 'agent.spawn', agent: parentKey, child: child.key, name: shorten(name, 40), label })
  }

  function endChild(child, time) {
    if (child.ended) return
    child.ended = true
    out.push({ time, type: 'agent.end', agent: child.key, ok: true })
  }

  function flushPending() {
    for (const held of pending.values()) {
      spawnChild(held.child, held.name, held.role || held.name, held.time)
    }
    pending.clear()
  }

  function conversationFor(step, time) {
    const conversation = typeof step.conversation_id === 'string' && step.conversation_id ? step.conversation_id : null
    if (parentConversation === undefined) parentConversation = conversation
    if (parentConversation === null && conversation) parentConversation = conversation
    if (!conversation || conversation === parentConversation) return parent
    const known = conversations.get(conversation)
    if (known) return known
    const raw = typeof step.name === 'string' ? step.name.trim() : ''
    const name = raw || `subagent ${children + 1}`
    const child = newChild()
    spawnChild(child, name, `subagent: ${name}`, time)
    conversations.set(conversation, child)
    return child
  }

  function beginInvoke(step, time, id) {
    const role = typeof step.tool_info?.parameters?.Role === 'string' ? step.tool_info.parameters.Role.trim() : ''
    const name = role || `subagent ${children + 1}`
    pending.set(id, { child: newChild(), name, role, time })
  }

  function finishInvoke(step, id) {
    const held = pending.get(id)
    if (!held) return
    pending.delete(id)
    const list = Array.isArray(step.subagent_info?.subagents) ? step.subagent_info.subagents : []
    const match = list.find((item) => item && String(item.role ?? '').trim() === held.role) ?? list[0] ?? null
    const prompt = typeof match?.initial_prompt === 'string' ? match.initial_prompt.trim() : ''
    spawnChild(held.child, held.name, prompt || held.role || held.name, held.time)
    const conversation = typeof match?.conversation_id === 'string' ? match.conversation_id : null
    if (conversation) {
      invoked.set(conversation, held.child)
      conversations.set(conversation, held.child)
    }
  }

  const reader = createLineReader((line, time) => {
    const json = parseJson(line)
    const step = json?.event === 'step_update' ? json.step_update : null
    if (!step) return
    const id = `${step.conversation_id}:${step.step_index}`
    for (const [key, held] of pending) {
      if (key === id) continue
      pending.delete(key)
      spawnChild(held.child, held.name, held.role || held.name, held.time)
    }
    const entry = conversationFor(step, time)
    if (!entry.key) {
      for (const child of conversations.values()) {
        if (child.ended || child.doneAt === null) continue
        endChild(child, child.doneAt)
      }
    }
    const isEnd = step.state === 'DONE' || step.state === 'ERROR'
    if (isEnd) {
      entry.doneAt = time
      const err = typeof step.tool_info?.error === 'string' ? step.tool_info.error.trim() : ''
      const failed = step.state === 'ERROR'
        || Boolean(err)
        || (step.tool_name === 'run_command' && looksFailed(step.tool_info?.output))
      entry.doneOk = !failed
      entry.error = err || (step.state === 'ERROR' ? 'error' : null)
    } else {
      entry.doneAt = null
      entry.error = null
    }
    if (step.step_type !== 'tool' && step.step_type !== 'subagent') return
    begin(step, entry, time, id)
    if (step.tool_name === 'invoke_subagent' && step.state === 'ACTIVE') beginInvoke(step, time, id)
    if (!isEnd) return
    const callLabel = calls.get(id) ?? step.tool_name ?? 'tool'
    const endLabel = entry.error && !callLabel.includes(entry.error) ? `${callLabel}: ${shorten(entry.error)}` : callLabel
    out.push(credit(entry, toolEnd({ time, id, ok: entry.doneOk, ...(entry.error ? { label: endLabel, error: entry.error } : {}) })))
    if (step.tool_name === 'invoke_subagent') finishInvoke(step, id)
    if (step.tool_name === 'manage_subagents' && step.tool_info?.parameters?.Action === 'list') {
      for (const item of subagentList(step.tool_info?.output)) {
        const conversation = typeof item?.conversationId === 'string' ? item.conversationId : null
        if (!conversation || item.state === 'running') continue
        const child = invoked.get(conversation)
        if (child) endChild(child, time)
      }
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
      flushPending()
      return [...out]
    },
  }
}
