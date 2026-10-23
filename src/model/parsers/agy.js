import { commandTouch, createLineReader, fileTouch, labelFor, looksFailed, parseJson, shorten, toolEnd, toolStart } from './common.js'

const TOOLS = {
  view_file: ['read', 'AbsolutePath'],
  write_to_file: ['write', 'TargetFile'],
  replace_file_content: ['edit', 'TargetFile'],
  multi_replace_file_content: ['edit', 'TargetFile'],
  run_command: ['shell', 'CommandLine'],
}

export function createAgyParser(ctx) {
  const out = []
  const started = new Set()
  const conversations = new Map()
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
    }
    out.push(credit(entry, toolStart({ time, id, tool, label, touches })))
  }

  function conversationFor(step, time) {
    const conversation = typeof step.conversation_id === 'string' && step.conversation_id ? step.conversation_id : null
    if (parentConversation === undefined) parentConversation = conversation
    if (parentConversation === null && conversation) parentConversation = conversation
    if (!conversation || conversation === parentConversation) return parent
    const known = conversations.get(conversation)
    if (known) return known
    const number = (children += 1)
    const raw = typeof step.name === 'string' ? step.name.trim() : ''
    const name = shorten(raw || `subagent ${number}`, 40)
    const child = { key: `${parentKey}~${number}`, doneAt: null, doneOk: true, ended: false }
    out.push({ time, type: 'agent.spawn', agent: parentKey, child: child.key, name, label: `subagent: ${name}` })
    conversations.set(conversation, child)
    return child
  }

  const reader = createLineReader((line, time) => {
    const json = parseJson(line)
    const step = json?.event === 'step_update' ? json.step_update : null
    if (!step) return
    const entry = conversationFor(step, time)
    if (!entry.key) {
      for (const child of conversations.values()) {
        if (child.ended || child.doneAt === null) continue
        child.ended = true
        out.push({ time: child.doneAt, type: 'agent.end', agent: child.key, ok: child.doneOk })
      }
    }
    if (step.state === 'DONE') {
      entry.doneAt = time
      entry.doneOk = !(step.tool_name === 'run_command' && looksFailed(step.tool_info?.output))
    } else {
      entry.doneAt = null
    }
    if (step.step_type !== 'tool') return
    const id = `${step.conversation_id}:${step.step_index}`
    begin(step, entry, time, id)
    if (step.state === 'DONE') {
      out.push(credit(entry, toolEnd({ time, id, ok: entry.doneOk })))
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
