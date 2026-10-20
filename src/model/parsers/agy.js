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

  function begin(step, time, id) {
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
    out.push(toolStart({ time, id, tool, label, touches }))
    return tool
  }

  const reader = createLineReader((line, time) => {
    const json = parseJson(line)
    const step = json?.event === 'step_update' ? json.step_update : null
    if (!step || step.step_type !== 'tool') return
    const id = `${step.conversation_id}:${step.step_index}`
    begin(step, time, id)
    if (step.state === 'DONE') {
      const shell = step.tool_name === 'run_command'
      out.push(toolEnd({ time, id, ok: !(shell && looksFailed(step.tool_info?.output)) }))
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
