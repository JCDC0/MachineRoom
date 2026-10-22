import { normalise } from './paths.js'

const WRITE_OPERATOR = /(>>|(?<![>=-])>(?![&=])|\bSet-Content\b|\bAdd-Content\b|\bOut-File\b|\btee\b|\bsed\s+-i\b)/
const MUTATOR = /^\s*(?:sudo\s+|npx\s+)?(?:git\s+)?(?:mv|rm|cp|del|erase|move|ren|rename|copy|Remove-Item|Rename-Item|Move-Item|Copy-Item|New-Item)\b/i
const LISTER = /\b(ls|dir|Get-ChildItem|gci|find|tree|cd|Set-Location|Test-Path)\b/
const MESSAGE_FLAG = /(?:^|[\s;|&(])(?:--message|--data-raw|--data-binary|--data|-m|-d)(?:[ \t]*=[ \t]*|[ \t]+)/g
const HERE_STRING = /(?<![\w'"@])@(['"])/g
const COMMAND_STRING = /^\s*(?:[^\s;&|]*\/)?(?:sudo\s+)?(?:powershell|pwsh|bash|sh|cmd)(?:\.exe)?\b[^;&|]*?(?<!-)(?:-Command|-[A-Za-z]*c|\/c)\s*$/i

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

function outsideQuotedText(text) {
  let out = ''
  let cursor = 0
  while (cursor < text.length) {
    const quote = text[cursor]
    if (quote !== '"' && quote !== "'") {
      out += quote
      cursor += 1
      continue
    }
    const end = quotedValueEnd(text, cursor)
    const before = text.slice(0, cursor)
    out += COMMAND_STRING.test(before) ? text.slice(cursor, end) : ' '.repeat(end - cursor)
    cursor = end
  }
  return out
}

function tokenSpans(segment, token, folder = false) {
  if (!token || !segment.includes(token)) return []
  const tail = folder ? '(?![\\w-])(?!/[\\w.-])' : '(?![\\w-])'
  const spans = []
  const pattern = new RegExp(`(?<![\\w.-])${escape(token)}${tail}`, 'g')
  let found
  while ((found = pattern.exec(segment))) {
    spans.push({ at: found.index, end: found.index + token.length })
    pattern.lastIndex = found.index + token.length
  }
  return spans
}

function withoutNested(spans) {
  return spans.filter(
    (span) =>
      !spans.some(
        (other) =>
          other !== span &&
          other.at <= span.at &&
          span.end <= other.end &&
          other.end - other.at > span.end - span.at
      )
  )
}

function firstSpans(spans) {
  const first = new Map()
  for (const span of spans) {
    const held = first.get(span.path)
    if (!held || span.at < held.at) first.set(span.path, span)
  }
  return first
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
    const operator = WRITE_OPERATOR.exec(outsideQuotedText(segment))
    const mutator = MUTATOR.exec(segment)
    const fileSpans = []
    for (const file of files) {
      for (const span of tokenSpans(segment, file)) fileSpans.push({ path: file, ...span })
    }
    const firstFiles = firstSpans(withoutNested(fileSpans))
    for (const file of files) {
      const span = firstFiles.get(file)
      if (!span) continue
      const mode = mutator || (operator && operator.index < span.at) ? 'write' : 'read'
      add({ path: file, mode, kind: 'file' })
    }
    const lister = LISTER.exec(segment)
    if (!lister) continue
    const dirSpans = []
    for (const dir of dirs) {
      if (dir === '') continue
      for (const span of tokenSpans(segment, dir, true)) dirSpans.push({ path: dir, ...span })
    }
    const firstDirs = firstSpans(withoutNested(dirSpans))
    let named = false
    for (const dir of dirs) {
      if (dir === '') continue
      const span = firstDirs.get(dir)
      if (span && span.at > lister.index) {
        add({ path: dir, mode: 'list', kind: 'dir' })
        named = true
      }
    }
    if (!named && firstFiles.size === 0) {
      add({ path: '', mode: 'list', kind: 'dir' })
    }
  }
  return touches
}
