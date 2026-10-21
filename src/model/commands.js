import { normalise } from './paths.js'

const WRITE_OPERATOR = /(>>|(?<![>=-])>(?![&=])|\bSet-Content\b|\bAdd-Content\b|\bOut-File\b|\btee\b|\bsed\s+-i\b)/
const MUTATOR = /^\s*(?:sudo\s+|npx\s+)?(?:git\s+)?(?:mv|rm|cp|del|erase|move|ren|rename|copy|Remove-Item|Rename-Item|Move-Item|Copy-Item|New-Item)\b/i
const LISTER = /\b(ls|dir|Get-ChildItem|gci|find|tree|cd|Set-Location|Test-Path)\b/
const MESSAGE_FLAG = /(?:^|[\s;|&(])(?:--message|--data-raw|--data-binary|--data|-m|-d)(?:[ \t]*=[ \t]*|[ \t]+)/g
const HERE_STRING = /(?<![\w'"@])@(['"])/g

function quotedValueEnd(text, at) {
  const quote = text.startsWith('\\"', at) ? '\\"' : text[at]
  if (quote !== '\\"' && quote !== '"' && quote !== "'") return -1
  let cursor = at + quote.length
  while (cursor < text.length) {
    if (text.startsWith(quote, cursor)) return cursor + quote.length
    cursor += quote === '"' && text[cursor] === '\\' ? 2 : 1
  }
  return text.length
}

function withoutMessageValues(command) {
  const text = String(command)
  let out = ''
  let copied = 0
  const flag = new RegExp(MESSAGE_FLAG.source, 'g')
  let match
  while ((match = flag.exec(text))) {
    const start = match.index + match[0].length
    const end = quotedValueEnd(text, start)
    if (end === -1) continue
    out += `${text.slice(copied, start)}""`
    copied = end
    flag.lastIndex = end
  }
  return out + text.slice(copied)
}

function withoutHereStrings(command) {
  const text = String(command)
  let out = ''
  let copied = 0
  const opener = new RegExp(HERE_STRING.source, 'g')
  let match
  while ((match = opener.exec(text))) {
    const start = match.index
    const close = text.indexOf(`${match[1]}@`, start + 2)
    const end = close === -1 ? text.length : close + 2
    out += `${text.slice(copied, start)}''`
    copied = end
    opener.lastIndex = end
  }
  return out + text.slice(copied)
}

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function tokenAt(segment, token, folder = false) {
  if (!segment.includes(token)) return -1
  const tail = folder ? '(?![\\w-])(?!/[\\w.-])' : '(?![\\w-])'
  const found = new RegExp(`(?<![\\w.-])${escape(token)}${tail}`).exec(segment)
  return found ? found.index : -1
}

export function touchesForCommand(command, files, dirs) {
  const touches = []
  const seen = new Set()
  const add = (touch) => {
    const key = `${touch.kind}:${touch.mode}:${touch.path}`
    if (seen.has(key)) return
    seen.add(key)
    touches.push(touch)
  }
  const segments = normalise(withoutHereStrings(withoutMessageValues(command))).split(/&&|;|\|\||\|/)
  for (const segment of segments) {
    const operator = WRITE_OPERATOR.exec(segment)
    const mutator = MUTATOR.exec(segment)
    for (const file of files) {
      const at = tokenAt(segment, file)
      if (at === -1) continue
      const mode = mutator || (operator && operator.index < at) ? 'write' : 'read'
      add({ path: file, mode, kind: 'file' })
    }
    const lister = LISTER.exec(segment)
    if (!lister) continue
    let named = false
    for (const dir of dirs) {
      if (dir === '') continue
      const at = tokenAt(segment, dir, true)
      if (at !== -1 && at > lister.index) {
        add({ path: dir, mode: 'list', kind: 'dir' })
        named = true
      }
    }
    if (!named && !files.some((file) => tokenAt(segment, file) !== -1)) {
      add({ path: '', mode: 'list', kind: 'dir' })
    }
  }
  return touches
}
