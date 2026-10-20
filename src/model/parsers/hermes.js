import { basename, dirname, resolveKnown } from '../paths.js'
import { commandTouch, createLineReader, fileTouch, labelFor, shorten, toolEnd, toolStart } from './common.js'

export const LINE = /^\s*┊\s+\S+\s+(\$|[a-z_]+)\s+(.+?)\s+(\d+(?:\.\d+)?)s(?:\s+\[(exit (\d+)|error)\])?\s*$/u
const VERBS = { read: 'read', write: 'write', patch: 'edit', find: 'search', search: 'search', grep: 'search', $: 'shell' }

export function createHermesParser(ctx) {
  const out = []
  let counter = 0
  let near

  const reader = createLineReader((line, time) => {
    const found = LINE.exec(line)
    if (!found) return
    const [, verb, detail, seconds, mark, exit] = found
    const tool = VERBS[verb] ?? 'other'
    const id = `hermes-${(counter += 1)}`
    const startTime = time - Math.round(Number(seconds) * 1000)
    const ok = !mark || (exit !== undefined && Number(exit) === 0)
    let touches = []
    let label = `${verb} ${shorten(detail)}`
    if (tool === 'read' || tool === 'write' || tool === 'edit') {
      const bare = !/[\\/]/.test(detail)
      const named = resolveKnown(detail, ctx.files, bare ? near : undefined)
      const touched = fileTouch(ctx, named, tool)
      touches = touched.touches
      if (touched.relative && (ctx.files.includes(touched.relative) || dirname(touched.relative) !== '')) {
        near = dirname(touched.relative)
      }
      label = labelFor(tool, touched.relative, named)
    } else if (tool === 'shell') {
      const command = detail.replace(/\s+\+\s+\d+\s+commands?$/, '')
      touches = commandTouch(ctx, command)
      label = `$ ${shorten(command)}`
    } else if (tool === 'search') {
      label = `${verb} ${verb === 'grep' ? shorten(detail) : basename(detail)}`
    }
    out.push(toolStart({ time: startTime, id, tool, label, touches }))
    out.push(toolEnd({ time, id, ok }))
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
