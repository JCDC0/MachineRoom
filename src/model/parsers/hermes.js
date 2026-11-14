import { indexFor } from '../fileIndex.js'
import { basename, dirname, resolveKnown } from '../paths.js'
import { commandTouch, createLineReader, fileTouch, labelFor, shorten, toolEnd, toolStart } from './common.js'

export const LINE = /^\s*┊\s+\S+\s+(\$|[a-z_]+)\s+(.+?)\s+(\d+(?:\.\d+)?)s(?:\s+\[(exit (\d+)|error)\])?\s*$/u
const VERBS = { read: 'read', write: 'write', patch: 'edit', find: 'search', search: 'web', grep: 'search', fetch: 'web', $: 'shell' }

export function createHermesParser(ctx) {
  const out = []
  let counter = 0
  let children = 0
  let near

  const reader = createLineReader((line, time) => {
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
      const parent = ctx.agentKey ?? 'agent'
      const child = `${parent}~${(children += 1)}`
      const goal = detail.replace(/^\d+x:\s*/i, '').replace(/(?:\.\.\.|…)\s*$/u, '')
      const spawned = shorten(goal || 'delegate', 40)
      out.push({ time, type: 'agent.spawn', agent: parent, child, name: spawned, label })
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
