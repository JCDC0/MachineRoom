#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const USAGE = 'Use: npm run bump -- X.Y.Z'
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const ARCHITECTURE = join('docs', 'agents', 'ARCHITECTURE.md')
const ARCHITECTURE_LINE = /^Version (\d+\.\d+\.\d+)\./m

function parts(version) {
  const match = VERSION.exec(String(version ?? ''))
  return match ? match.slice(1).map(Number) : null
}

export function isHigher(next, current) {
  const a = parts(next)
  const b = parts(current)
  if (!a || !b) return false
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index]
  }
  return false
}

function versionSlots(text, count) {
  const slots = []
  const pattern = /("version"\s*:\s*")([^"]*)(")/g
  let match
  while (slots.length < count && (match = pattern.exec(text)) !== null) {
    slots.push({ start: match.index + match[1].length, end: match.index + match[1].length + match[2].length, value: match[2] })
  }
  return slots
}

function replaceSlots(text, slots, value) {
  let next = text
  for (const slot of [...slots].sort((a, b) => b.start - a.start)) next = `${next.slice(0, slot.start)}${value}${next.slice(slot.end)}`
  return next
}

export function bumpTexts({ pkg, lock, architecture }, version) {
  const wanted = String(version ?? '').trim()
  if (!VERSION.test(wanted)) throw new Error(`The version must be three whole numbers, such as 0.1.113. ${wanted || 'Nothing'} is not.`)
  let pkgJson
  let lockJson
  try {
    pkgJson = JSON.parse(pkg)
    lockJson = JSON.parse(lock)
  } catch {
    throw new Error('package.json or package-lock.json is not valid JSON.')
  }
  const current = pkgJson?.version
  if (!parts(current)) throw new Error(`package.json has no version of three whole numbers (${current}).`)
  if (!isHigher(wanted, current)) throw new Error(`The version must be higher than ${current}. ${wanted} is not.`)

  const [pkgSlot] = versionSlots(pkg, 1)
  const nextPkg = pkgSlot ? replaceSlots(pkg, [pkgSlot], wanted) : null
  if (!nextPkg || JSON.parse(nextPkg).version !== wanted || JSON.stringify({ ...JSON.parse(nextPkg), version: current }) !== JSON.stringify(pkgJson)) {
    throw new Error('package.json does not hold its version where it should. Nothing was changed.')
  }

  const lockSlots = versionSlots(lock, 2)
  const nextLock = lockSlots.length === 2 ? replaceSlots(lock, lockSlots, wanted) : null
  const expected = structuredClone(lockJson)
  expected.version = wanted
  if (expected.packages?.['']) expected.packages[''].version = wanted
  if (!nextLock || !expected.packages?.[''] || JSON.stringify(JSON.parse(nextLock)) !== JSON.stringify(expected)) {
    throw new Error('package-lock.json does not hold its two versions on its top lines. Nothing was changed.')
  }

  const line = ARCHITECTURE_LINE.exec(architecture)
  if (!line) throw new Error('ARCHITECTURE.md has no line that starts with Version X.Y.Z. Nothing was changed.')
  const nextArchitecture = `${architecture.slice(0, line.index)}Version ${wanted}.${architecture.slice(line.index + line[0].length)}`

  return {
    pkg: nextPkg,
    lock: nextLock,
    architecture: nextArchitecture,
    lines: [
      `package.json: version ${current} to ${wanted}`,
      `package-lock.json: version ${lockSlots[0].value} to ${wanted}`,
      `package-lock.json: packages[""].version ${lockSlots[1].value} to ${wanted}`,
      `docs/agents/ARCHITECTURE.md: Version ${line[1]}. to Version ${wanted}.`,
    ],
  }
}

export function bump(root, argv) {
  const args = (Array.isArray(argv) ? argv : []).map(String).filter((arg) => arg.trim() !== '')
  if (args.length !== 1 || args[0].startsWith('-')) return { code: 1, lines: [USAGE] }
  const files = { pkg: join(root, 'package.json'), lock: join(root, 'package-lock.json'), architecture: join(root, ARCHITECTURE) }
  let result
  try {
    const texts = { pkg: readFileSync(files.pkg, 'utf8'), lock: readFileSync(files.lock, 'utf8'), architecture: readFileSync(files.architecture, 'utf8') }
    result = bumpTexts(texts, args[0])
  } catch (error) {
    return { code: 1, lines: [error.code === 'ENOENT' ? `${error.path} could not be read. Nothing was changed.` : error.message] }
  }
  writeFileSync(files.pkg, result.pkg)
  writeFileSync(files.lock, result.lock)
  writeFileSync(files.architecture, result.architecture)
  return { code: 0, lines: result.lines }
}

const invoked = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false
if (invoked) {
  const result = bump(process.cwd(), process.argv.slice(2))
  for (const line of result.lines) (result.code === 0 ? console.log : console.error)(line)
  process.exitCode = result.code
}
