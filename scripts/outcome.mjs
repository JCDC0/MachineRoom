#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { outcomesFile, readAllRunRecords, runsFile } from '../server/runs.js'

const GRADES = new Set(['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C', 'D', 'F'])
const OUTCOMES = new Set(['merged', 'rejected'])
const NOTE_LIMIT = 200
const FIXES_LIMIT = 50
const USAGE = 'Use: npm run outcome -- BRANCH merged|rejected [--grade A-] [--fixes N] [--note TEXT]'

const root = resolve(fileURLToPath(import.meta.url), '..', '..')

function parseArgs(argv) {
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

function problemFor({ branch, outcome, grade, fixes, note }) {
  if (!branch) return 'A branch is required.'
  if (!OUTCOMES.has(outcome)) return 'The outcome must be merged or rejected.'
  if (grade !== null && !GRADES.has(grade)) return 'The grade must be A+, A, A-, B+, B, B-, C, D or F.'
  if (fixes !== null && (!/^\d+$/.test(fixes) || Number(fixes) > FIXES_LIMIT)) {
    return `The fixes must be a whole number from 0 to ${FIXES_LIMIT}.`
  }
  if (note.length > NOTE_LIMIT || /[\r\n]/.test(note)) {
    return `The note must be one line of ${NOTE_LIMIT} characters or less.`
  }
  const records = readAllRunRecords(runsFile())
  if (!records.some((record) => record && typeof record === 'object' && record.branch === branch)) {
    return `No lane run made the branch ${branch}.`
  }
  return null
}

function main(argv) {
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
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  const record = {
    branch: parsed.branch,
    outcome: parsed.outcome,
    grade: parsed.grade,
    fixes: parsed.fixes === null ? null : Number(parsed.fixes),
    note: parsed.note,
    version,
    recordedAt: new Date().toISOString(),
  }
  const file = outcomesFile()
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, `${JSON.stringify(record)}\n`)
  console.log(`Recorded ${record.outcome} for ${record.branch}.`)
  return 0
}

process.exitCode = main(process.argv.slice(2))
