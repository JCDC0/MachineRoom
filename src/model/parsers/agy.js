import { commandTouch, createLineReader, fileTouch, labelFor, looksFailed, mcpLabelOf, mcpPathOf, parseJson, shorten, toolEnd, toolStart } from './common.js'

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
  call_mcp_tool: ['mcp', null],
  manage_task: ['plan', null],
  schedule: ['wait', null],
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
  const pending = new Map()
  const parentKey = ctx.agentKey ?? 'agent'
  const childPrefix = ctx.runToken ? `${parentKey}~${ctx.runToken}` : parentKey
  const parent = { key: null }
  let parentConversation
  let children = 0

  function credit(entry, activity) {
    return entry.key ? { ...activity, agent: entry.key } : activity
  }

  function begin(step, entry, time, id) {
    if (started.has(id)) return
    started.add(id)
    if (entry.key) entry.ended = false
    const [tool, field] = Object.hasOwn(TOOLS, step.tool_name) ? TOOLS[step.tool_name] : ['other', null]
    const value = field ? step.tool_info?.parameters?.[field] : null
    let touches = []
    let outsidePath
    let label = step.tool_name ?? 'tool'
    if (value && (tool === 'read' || tool === 'write' || tool === 'edit')) {
      const touched = fileTouch(ctx, value, tool)
      touches = touched.touches
      outsidePath = touched.outsidePath
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
    } else if (tool === 'mcp') {
      const params = step.tool_info?.parameters ?? {}
      label = mcpLabelOf(step.tool_name, params)
      const raw = mcpPathOf(params)
      if (raw) {
        const touched = fileTouch(ctx, raw, 'read')
        touches = touched.touches
        const shown = touched.relative === null ? (String(raw).split(/[\\/]/).pop() ?? '') : touched.relative || '.'
        label = `${label} ${shown}`
      }
    } else if (tool === 'plan') {
      const action = typeof step.tool_info?.parameters?.Action === 'string' ? step.tool_info.parameters.Action.trim() : ''
      const taskId = typeof step.tool_info?.parameters?.TaskId === 'string' ? step.tool_info.parameters.TaskId.trim() : ''
      label = action && taskId ? `task ${action} ${taskId}` : action ? `task ${action}` : 'task'
    } else if (tool === 'wait') {
      const duration = step.tool_info?.parameters?.DurationSeconds
      const cron = typeof step.tool_info?.parameters?.CronExpression === 'string' ? step.tool_info.parameters.CronExpression.trim() : ''
      label = duration != null ? `wait ${duration}s` : cron ? `schedule ${cron}` : 'schedule'
    }
    const err = typeof step.tool_info?.error === 'string' ? step.tool_info.error.trim() : ''
    if (err) label = `${label}: ${shorten(err)}`
    calls.set(id, label)
    out.push(credit(entry, toolStart({ time, id, tool, label, touches, outsidePath, ...(ctx.trackCalls && step.tool_name && step.tool_info?.parameters ? { callKey: JSON.stringify([step.tool_name, step.tool_info.parameters]), callName: step.tool_name } : {}) })))
  }

  function newChild(owner) {
    const number = (children += 1)
    return { key: `${childPrefix}~${number}`, parent: owner.key ?? parentKey, ended: false, spawned: false }
  }

  function spawnChild(child, name, label, time) {
    if (child.spawned) return
    child.spawned = true
    out.push({ time, type: 'agent.spawn', agent: child.parent, child: child.key, name: shorten(name, 40), label })
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
    const top = typeof step.root_conversation_id === 'string' && step.root_conversation_id ? step.root_conversation_id : null
    if (top) parentConversation = top
    if (parentConversation === undefined) parentConversation = conversation
    if (parentConversation === null && conversation) parentConversation = conversation
    if (!conversation || conversation === parentConversation) return parent
    const known = conversations.get(conversation)
    if (known) return known
    const raw = typeof step.name === 'string' ? step.name.trim() : ''
    const name = raw || `subagent ${children + 1}`
    const child = newChild(parent)
    spawnChild(child, name, `subagent: ${name}`, time)
    conversations.set(conversation, child)
    return child
  }

  function beginInvoke(step, owner, time, id) {
    if (pending.has(id)) return
    const role = typeof step.tool_info?.parameters?.Role === 'string' ? step.tool_info.parameters.Role.trim() : ''
    const name = role || `subagent ${children + 1}`
    pending.set(id, { child: newChild(owner), name, role, time })
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
      held.child.linked = true
      conversations.set(conversation, held.child)
    }
  }

  function finishListedChildren(step, time) {
    for (const item of subagentList(step.tool_info?.output)) {
      if (typeof item?.conversationId !== 'string' || item.state !== 'idle') continue
      const child = conversations.get(item.conversationId)
      if (child) endChild(child, time)
    }
  }

  const reader = createLineReader((line, time) => {
    const json = parseJson(line)
    const step = json?.event === 'step_update' ? json.step_update : null
    if (!step) return
    const id = `${step.conversation_id}:${step.step_index}`
    for (const [key, held] of pending) {
      if (key === id) continue
      spawnChild(held.child, held.name, held.role || held.name, held.time)
    }
    const isEnd = step.state === 'DONE' || step.state === 'ERROR'
    const isList = isEnd && step.tool_name === 'manage_subagents' && step.tool_info?.parameters?.Action === 'list'
    if (isList && step.root_conversation_id && String(step.step_index).startsWith('end.')) {
      finishListedChildren(step, time)
      return
    }
    const entry = conversationFor(step, time)
    if (step.step_type !== 'tool' && step.step_type !== 'subagent') {
      if (entry.key && !step.root_conversation_id && !entry.linked && step.step_type === 'agent_response' && step.state === 'DONE') {
        endChild(entry, time)
      }
      return
    }
    begin(step, entry, time, id)
    if (step.tool_name === 'invoke_subagent' && step.state === 'ACTIVE') beginInvoke(step, entry, time, id)
    if (!isEnd) return
    const err = typeof step.tool_info?.error === 'string' ? step.tool_info.error.trim() : ''
    const ok = step.state !== 'ERROR' && !err && !(step.tool_name === 'run_command' && looksFailed(step.tool_info?.output))
    const error = err || (step.state === 'ERROR' ? 'error' : null)
    const callLabel = calls.get(id) ?? step.tool_name ?? 'tool'
    const endLabel = error && !callLabel.includes(error) ? `${callLabel}: ${shorten(error)}` : callLabel
    out.push(credit(entry, toolEnd({ time, id, ok, ...(error ? { label: endLabel, error } : {}) })))
    calls.delete(id)
    started.delete(id)
    if (step.tool_name === 'invoke_subagent') finishInvoke(step, id)
    if (isList) finishListedChildren(step, time)
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
