import { indexFor } from './fileIndex.js'
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

function word(code) {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95
  )
}

function wordDash(code) {
  return word(code) || code === 45
}

function wordDotDash(code) {
  return wordDash(code) || code === 46
}

function afterAllowed(segment, at, folder) {
  if (at < segment.length && wordDash(segment.charCodeAt(at))) return false
  if (!folder || at >= segment.length) return true
  if (segment.charCodeAt(at) !== 47) return true
  return at + 1 >= segment.length || !wordDotDash(segment.charCodeAt(at + 1))
}

function namedSpans(segment, index, folder = false) {
  const spans = []
  const longest = index.longest
  if (!longest || !segment.length) return spans
  for (let at = 0; at < segment.length; at += 1) {
    if (at > 0 && wordDotDash(segment.charCodeAt(at - 1))) continue
    const most = Math.min(longest, segment.length - at)
    for (let size = 1; size <= most; size += 1) {
      const end = at + size
      if (!afterAllowed(segment, end, folder)) continue
      const token = segment.slice(at, end)
      if (index.has(token)) spans.push({ path: token, at, end })
    }
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
    const fileIndex = indexFor(files)
    const firstFiles = firstSpans(withoutNested(namedSpans(segment, fileIndex)))
    const namedFiles = [...firstFiles].sort((a, b) => fileIndex.rankOf(a[0]) - fileIndex.rankOf(b[0]))
    for (const [file, span] of namedFiles) {
      const mode = mutator || (operator && operator.index < span.at) ? 'write' : 'read'
      add({ path: file, mode, kind: 'file' })
    }
    const lister = LISTER.exec(segment)
    if (!lister) continue
    const dirIndex = indexFor(dirs)
    const firstDirs = firstSpans(withoutNested(namedSpans(segment, dirIndex, true)))
    const namedDirs = [...firstDirs]
      .filter(([dir, span]) => dir !== '' && span.at > lister.index)
      .sort((a, b) => dirIndex.rankOf(a[0]) - dirIndex.rankOf(b[0]))
    let named = false
    for (const [dir] of namedDirs) {
      add({ path: dir, mode: 'list', kind: 'dir' })
      named = true
    }
    if (!named && firstFiles.size === 0) {
      add({ path: '', mode: 'list', kind: 'dir' })
    }
  }
  return touches
}
