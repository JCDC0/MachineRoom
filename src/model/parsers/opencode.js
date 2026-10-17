import { commandTouch, createLineReader, fileTouch, labelFor, looksFailed, parseJson, shorten, toolEnd, toolStart } from './common.js'

const TOOLS = { shell: 'shell', bash: 'shell', read: 'read', write: 'write', edit: 'edit', glob: 'search', grep: 'search', list: 'search' }
const OUTPUT_PATH = /(?:Created file successfully|Edited|Wrote|Updated|Written)[:\s]+(\S+)/i

export function createOpencodeParser(ctx) {
  const out = []
  let counter = 0

  const reader = createLineReader((line, time) => {
    const json = parseJson(line)
    if (!json) return
    if (json.type === 'error') {
      out.push({ time, type: 'error', text: shorten(json.error?.message ?? 'error', 140) })
      return
    }
    if (json.type !== 'tool_use') return
    const part = json.part ?? {}
    const state = part.state ?? {}
    const input = state.input ?? {}
    const tool = TOOLS[part.tool] ?? 'other'
    const id = part.id ?? `opencode-${(counter += 1)}`
    let touches = []
    let label = `${part.tool} ${shorten(JSON.stringify(input), 48)}`
    if (tool === 'read' || tool === 'write' || tool === 'edit') {
      const raw = input.path ?? input.filePath ?? OUTPUT_PATH.exec(String(state.output ?? ''))?.[1]
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
      label = `${part.tool} ${shorten(input.pattern ?? input.path ?? '')}`
    }
    const failed = state.status === 'error' || (tool === 'shell' && looksFailed(state.output))
    out.push(toolStart({ time: time - 300, id, tool, label, touches }))
    out.push(toolEnd({ time, id, ok: !failed }))
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
