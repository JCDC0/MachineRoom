import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { indexFor } from '../src/model/fileIndex.js'
import { touchesForCommand } from '../src/model/commands.js'
import { makeTree, normalise } from '../src/model/paths.js'
import { parseFrames, prepare } from '../src/model/source.js'
import { makeScaleTree, random } from '../scripts/scale-probe.mjs'

const WRITE_OPERATOR = /(>>|(?<![>=-])>(?![&=])|\bSet-Content\b|\bAdd-Content\b|\bOut-File\b|\btee\b|\bsed\s+-i\b)/
const MUTATOR = /^\s*(?:sudo\s+|npx\s+)?(?:git\s+)?(?:mv|rm|cp|del|erase|move|ren|rename|copy|Remove-Item|Rename-Item|Move-Item|Copy-Item|New-Item)\b/i
const LISTER = /\b(ls|dir|Get-ChildItem|gci|find|tree|cd|Set-Location|Test-Path)\b/
const MESSAGE_FLAG = /(?:^|[\s;|&(])(?:--message|--data-raw|--data-binary|--data|-m|-d)(?:[ \t]*=[ \t]*|[ \t]+)/g
const HERE_STRING = /(?<![\w'"@])@(['"])/g
const COMMAND_STRING = /^\s*(?:[^\s;&|]*\/)?(?:sudo\s+)?(?:powershell|pwsh|bash|sh|cmd)(?:\.exe)?\b[^;&|]*?(?<!-)(?:-Command|-[A-Za-z]*c|\/c)\s*$/i

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURES = join(ROOT, 'public', 'fixtures')
const RECORDINGS = join(ROOT, 'public', 'recordings')

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

function referenceTouchesForCommand(command, files, dirs) {
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

function difference(command, files, dirs) {
  const wanted = referenceTouchesForCommand(command, files, dirs)
  const actual = touchesForCommand(command, files, dirs)
  if (JSON.stringify(wanted) === JSON.stringify(actual)) return null
  return { command, wanted, actual }
}

function runFiles(folder) {
  try {
    return readdirSync(folder)
      .filter((file) => file.endsWith('-run.jsonl'))
      .sort()
      .map((file) => ({ file, stem: file.slice(0, -'-run.jsonl'.length) }))
  } catch {
    return []
  }
}

function readFirst(folder, names) {
  for (const name of names) {
    if (existsSync(join(folder, name))) return JSON.parse(readFileSync(join(folder, name), 'utf8'))
  }
  return null
}

function shellCommands(folder) {
  const commands = []
  for (const { file, stem } of runFiles(folder)) {
    const frames = parseFrames(readFileSync(join(folder, file), 'utf8'))
    const agentsFile = readFirst(folder, [`${stem}-agents.json`, 'agents.json'])
    const treeFile = readFirst(folder, [`${stem}-tree.json`])
    if (!agentsFile || !treeFile) continue
    const plan = prepare({ frames, agentsFile, treeFile })
    for (const activity of plan.activities) {
      if (activity.type === 'tool.start' && activity.tool === 'shell') commands.push({ command: activity.label, tree: plan.tree })
    }
  }
  return commands
}

function scaleCommands() {
  const scale = makeScaleTree({ files: 400, folders: 40, seed: 17 })
  const extra = ['docs/a note.md', 'lib/with space/b.txt', 'src/deep/a.js']
  const files = [...new Set([...scale.files, ...extra])].sort()
  const tree = makeTree({ root: 'scale', files })
  const folders = tree.dirs.filter(Boolean)
  const spaceFile = 'docs/a note.md'
  const spaceFolder = 'lib/with space'
  const next = random(23)
  const pick = (list) => list[Math.floor(next() * list.length)]
  const commands = [
    `cat ${pick(files)}`,
    `ls ${pick(folders)}`,
    `ls ${spaceFolder}`,
    `cat "${spaceFile}"`,
    `cat src/deep/a.js`,
    `cat lib/${pick(files)}`,
    `cat ${pick(files)} && ls ${pick(folders)}`,
    pick(files),
    'cat not-in-tree/nope.js',
  ]
  for (let i = 0; i < 2000; i += 1) {
    const file = pick(files)
    const folder = pick(folders)
    const other = pick(files)
    const unknown = `not-in-tree/nope-${i}.js`
    switch (Math.floor(next() * 10)) {
      case 0:
        commands.push(`cat ${file}`)
        break
      case 1:
        commands.push(`ls ${folder}`)
        break
      case 2:
        commands.push(`cat "${spaceFile}"`)
        break
      case 3:
        commands.push(`cat lib/${file}`)
        break
      case 4:
        commands.push(`cat ${file} && ls ${dirname(file) || '.'}`)
        break
      case 5:
        commands.push(`git mv ${file} ${other}`)
        break
      case 6:
        commands.push(`rm ${file}`)
        break
      case 7:
        commands.push(`echo hi > ${file}`)
        break
      case 8:
        commands.push(`grep -n x ${file}`)
        break
      default:
        commands.push(`cat ${unknown}`)
        break
    }
  }
  return { commands, files: tree.files, dirs: tree.dirs }
}

describe('indexFor', () => {
  it('learns entries pushed into the same array', () => {
    const list = ['src/a.js', 'lib/b.js']
    const first = indexFor(list)
    expect(first.has('src/a.js')).toBe(true)
    expect(first.pathsWithBase('b.js')).toEqual(['lib/b.js'])
    list.push('src/a-longer.js', 'docs/b.js')
    const again = indexFor(list)
    expect(again).toBe(first)
    expect(again.has('src/a-longer.js')).toBe(true)
    expect(again.longest).toBe('src/a-longer.js'.length)
    expect(again.pathsWithBase('b.js')).toEqual(['lib/b.js', 'docs/b.js'])
  })

  it('builds itself again when the array got shorter', () => {
    const list = ['src/a.js', 'lib/b.js']
    indexFor(list)
    list.pop()
    const shorter = indexFor(list)
    expect(shorter.has('lib/b.js')).toBe(false)
    expect(shorter.paths).toEqual(['src/a.js'])
    list.push('docs/c.js')
    expect(indexFor(list).has('docs/c.js')).toBe(true)
  })

  it('builds a fresh index for a replaced array', () => {
    const first = ['src/a.js']
    indexFor(first)
    const second = ['lib/b.js']
    const replaced = indexFor(second)
    expect(replaced).not.toBe(indexFor(first))
    expect(replaced.has('src/a.js')).toBe(false)
    expect(replaced.has('lib/b.js')).toBe(true)
  })

  it('lists base name matches in list order', () => {
    const list = ['src/index.js', 'test/index.js', 'src/first.js']
    expect(indexFor(list).pathsWithBase('index.js')).toEqual(['src/index.js', 'test/index.js'])
    expect(indexFor(list).pathsWithBase('none.js')).toEqual([])
  })
})

describe('touchesForCommand with the file index', () => {
  it('matches the old walk on every shell command in the fixtures', () => {
    const commands = shellCommands(FIXTURES)
    expect(commands.length).toBeGreaterThan(0)
    const differences = commands
      .map(({ command, tree }) => difference(command, tree.files, tree.dirs))
      .filter(Boolean)
    expect(differences).toEqual([])
  })

  it('matches the old walk on every shell command in the recordings', () => {
    if (!existsSync(RECORDINGS)) return
    const commands = shellCommands(RECORDINGS)
    const differences = commands
      .map(({ command, tree }) => difference(command, tree.files, tree.dirs))
      .filter(Boolean)
    expect(differences).toEqual([])
  })

  it('matches the old walk on 2000 seeded scale commands', () => {
    const { commands, files, dirs } = scaleCommands()
    const differences = commands.map((command) => difference(command, files, dirs)).filter(Boolean)
    expect(differences).toEqual([])
  })
})
