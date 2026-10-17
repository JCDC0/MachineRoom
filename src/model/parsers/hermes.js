import { basename, resolveKnown } from '../paths.js'
import { commandTouch, createLineReader, fileTouch, labelFor, shorten, toolEnd, toolStart } from './common.js'

const LINE = /^\s*┊\s+\S+\s+(\$|[a-z_]+)\s+(.+?)\s+(\d+(?:\.\d+)?)s(?:\s+\[exit (\d+)\])?\s*$/u
const VERBS = { read: 'read', write: 'write', patch: 'edit', find: 'search', search: 'search', $: 'shell' }

export function createHermesParser(ctx) {
  const out = []
  let counter = 0

  const reader = createLineReader((line, time) => {
    const found = LINE.exec(line)
    if (!found) return
    const [, verb, detail, seconds, exit] = found
    const tool = VERBS[verb] ?? 'other'
    const id = `hermes-${(counter += 1)}`
    const startTime = time - Math.round(Number(seconds) * 1000)
    let touches = []
    let label = `${verb} ${shorten(detail)}`
    if (tool === 'read' || tool === 'write' || tool === 'edit') {
      const named = resolveKnown(detail, ctx.files)
      const touched = fileTouch(ctx, named, tool)
      touches = touched.touches
      label = labelFor(tool, touched.relative, named)
    } else if (tool === 'shell') {
      const command = detail.replace(/\s+\+\s+\d+\s+commands?$/, '')
      touches = commandTouch(ctx, command)
      label = `$ ${shorten(command)}`
    } else if (tool === 'search') {
      label = `${verb} ${basename(detail)}`
    }
    out.push(toolStart({ time: startTime, id, tool, label, touches }))
    out.push(toolEnd({ time, id, ok: !exit || Number(exit) === 0 }))
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
