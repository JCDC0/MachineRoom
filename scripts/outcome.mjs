#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { outcomesFile, readAllRunRecords, runsFile } from '../server/runs.js'

export const GRADES = new Set(['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C', 'D', 'F'])
export const OUTCOMES = new Set(['merged', 'rejected'])
export const NOTE_LIMIT = 200
export const FIXES_LIMIT = 50
export const USAGE = 'Use: npm run outcome -- BRANCH merged|rejected [--grade A-] [--fixes N] [--note TEXT]'

const root = resolve(fileURLToPath(import.meta.url), '..', '..')

export function parseArgs(argv) {
  const values = { grade: null, fixes: null, note: '' }
  const positional = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--grade' || arg === '--fixes' || arg === '--note') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) return { error: USAGE }
      values[arg.slice(2)] = value
      index += 1
    } else if (arg.startsWith('--')) {
      return { error: USAGE }
    } else {
      positional.push(arg)
    }
  }
  if (positional.length !== 2) return { error: USAGE }
  return { branch: positional[0], outcome: positional[1], ...values }
}

export function problemFor({ branch, outcome, grade, fixes, note, runsPath = null }) {
  if (!branch) return 'A branch is required.'
  if (!OUTCOMES.has(outcome)) return 'The outcome must be merged or rejected.'
  if (grade !== null && !GRADES.has(grade)) return 'The grade must be A+, A, A-, B+, B, B-, C, D or F.'
  if (fixes !== null && (!/^\d+$/.test(fixes) || Number(fixes) > FIXES_LIMIT)) {
    return `The fixes must be a whole number from 0 to ${FIXES_LIMIT}.`
  }
  if (note && (note.length > NOTE_LIMIT || /[\r\n]/.test(note))) {
    return `The note must be one line of ${NOTE_LIMIT} characters or less.`
  }
  const records = readAllRunRecords(runsPath ?? runsFile())
  if (!records.some((record) => record && typeof record === 'object' && record.branch === branch)) {
    return `No lane run made the branch ${branch}.`
  }
  return null
}

export function recordOutcome({ branch, outcome, grade = null, fixes = null, note = '', version = null, outcomesPath = null, rootDir = root }) {
  const pkgVersion = version ?? JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')).version
  const record = {
    branch,
    outcome,
    grade,
    fixes: fixes === null ? null : Number(fixes),
    note: note ?? '',
    version: pkgVersion,
    recordedAt: new Date().toISOString(),
  }
  const file = outcomesPath ?? outcomesFile()
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, `${JSON.stringify(record)}\n`)
  return record
}

export function main(argv) {
  const parsed = parseArgs(argv)
  if (parsed.error) {
    console.error(parsed.error)
    return 1
  }
  const problem = problemFor(parsed)
  if (problem) {
    console.error(problem)
    return 1
  }
  const record = recordOutcome(parsed)
  console.log(`Recorded ${record.outcome} for ${record.branch}.`)
  return 0
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = main(process.argv.slice(2))
}
