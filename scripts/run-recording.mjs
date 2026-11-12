#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeRecording } from './recording-files.mjs'
import { lanesFolder, runsFolder } from '../server/lanes-source.js'

const root = resolve(fileURLToPath(import.meta.url), '..', '..')

function refusal(message) {
  return new Error(message)
}

export function runsFile(env = process.env) {
  return join(runsFolder(env), 'runs.jsonl')
}

function readRecords() {
  const path = runsFile()
  if (!existsSync(path)) return []
  const out = []
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line))
    } catch {
      continue
    }
  }
  return out
}

function position(argv) {
  const value = String(argv[0] ?? '')
  if (!/^\d+$/.test(value) || Number(value) < 1) throw refusal('Name a run by its position in the run list, for example 1.')
  return Number(value)
}

function main() {
  const index = position(process.argv.slice(2))
  const list = readRecords()
  if (list.length === 0) throw refusal('No runs are recorded yet.')
  if (index > list.length) throw refusal(`There is no run at position ${index}. The list holds ${list.length}.`)
  const record = list[list.length - index]
  const lanes = JSON.parse(readFileSync(join(lanesFolder(), 'lanes.json'), 'utf8'))
  const written = writeRecording({ record, lanes, root, env: process.env })
  console.log(`recording: ${written.runPath}`)
  console.log(`agents: ${written.agentsPath}`)
  console.log(`tree: ${written.treePath}`)
  console.log(`frames: ${written.frames}`)
  console.log(`tool calls: ${written.toolCalls}`)
}

const startedFile = process.argv[1] ? resolve(process.argv[1]) : ''
const currentFile = fileURLToPath(import.meta.url)
const isMain = startedFile !== '' && (process.platform === 'win32'
  ? startedFile.toLowerCase() === currentFile.toLowerCase()
  : startedFile === currentFile)

if (isMain) {
  try {
    main()
  } catch (error) {
    console.error(String(error?.message ?? error))
    process.exitCode = 1
  }
}
