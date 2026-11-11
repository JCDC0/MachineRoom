#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SINCE_PROBLEM, dayStart, filterRunsSince } from '../src/briefs/run.js'
import { readPolicy } from '../src/policy/route.js'
import { policyDiff, policyText, proposePolicy } from '../src/policy/proposals.js'
import { outcomeTable } from '../server/outcomes.js'
import { outcomesFile, readAllRunRecords, readMainSubjectsSync, readOutcomeRecords, runsFile } from '../server/runs.js'
import { lanesFolder } from '../server/lanes-source.js'

const USAGE = 'Use: npm run policy-propose -- [--since YYYY-MM-DD] [--min N]'
const MIN_PROBLEM = '--min needs a whole number from 1 to 1000.'
const MIN_LIMIT = 1000
const MIN_DEFAULT = 10

const root = resolve(fileURLToPath(import.meta.url), '..', '..')
const policyPath = join(lanesFolder(), 'policy.json')
const policyRelative = relative(root, policyPath).split('\\').join('/')

function parseArgs(argv) {
  const values = { since: null, min: null }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--since' || arg === '--min') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) {
        return { error: arg === '--since' ? SINCE_PROBLEM : MIN_PROBLEM }
      }
      values[arg.slice(2)] = value
      index += 1
    } else {
      return { error: USAGE }
    }
  }
  return values
}

function minProblem(min) {
  if (min === null) return null
  const value = Number(min)
  if (!/^\d+$/.test(min) || value < 1 || value > MIN_LIMIT) return MIN_PROBLEM
  return null
}

function patchStamp(date) {
  const pad = (value) => String(value).padStart(2, '0')
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `${day}-${time}`
}

export function buildTable(runs, outcomes, subjects = readMainSubjectsSync()) {
  return outcomeTable(runs, outcomes, subjects)
}

function main(argv) {
  const parsed = parseArgs(argv)
  if (parsed.error) {
    console.error(parsed.error)
    return 1
  }
  if (parsed.since !== null && dayStart(parsed.since) === null) {
    console.error(SINCE_PROBLEM)
    return 1
  }
  const problem = minProblem(parsed.min)
  if (problem) {
    console.error(problem)
    return 1
  }

  let text
  try {
    text = readFileSync(policyPath, 'utf8')
  } catch {
    console.error('The policy file is missing.')
    return 1
  }
  let policy
  try {
    policy = readPolicy(text)
  } catch (error) {
    console.error(error.message)
    return 1
  }

  const runs = filterRunsSince(readAllRunRecords(runsFile()), parsed.since)
  const rows = outcomeTable(runs, readOutcomeRecords(outcomesFile()), readMainSubjectsSync())
  const minDecided = parsed.min === null ? MIN_DEFAULT : Number(parsed.min)
  const answer = proposePolicy({ policy, rows, minDecided })

  for (const join of answer.joins) console.log(join)
  for (const change of answer.changes) console.log(change)
  for (const note of answer.notes) console.log(note)

  if (answer.changes.length === 0) {
    console.log('No change to propose.')
    return 0
  }

  const diff = policyDiff(text, policyText(answer.policy), policyRelative)
  const file = join(dirname(runsFile()), `policy-${patchStamp(new Date())}.patch`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, diff)
  console.log(`Patch: ${file}. Read it, then run git apply ${file} in the main checkout.`)
  return 0
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = main(process.argv.slice(2))
}
