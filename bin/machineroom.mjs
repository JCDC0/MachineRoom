#!/usr/bin/env node
import { statSync } from 'node:fs'
import { upArgs } from '../server/doctor.js'

const USAGE = [
  'Usage: machineroom [FOLDER] [options]',
  '',
  'Start the room for FOLDER, or the current folder.',
  '',
  'Options:',
  '  --port <n>          port to listen on',
  '  --no-open           keep the browser closed',
  '  --no-sessions       keep the session source off',
  '  --help              show this help',
].join('\n')

function isFolder(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(USAGE)
  process.exit(0)
}
const plan = upArgs(process.argv.slice(2))
if (!isFolder(plan.root)) {
  console.error(`machineroom: ${plan.root} is not a folder. Give a project folder, or run machineroom inside one.`)
  process.exit(1)
}
console.log(`machineroom: starting the room for ${plan.root}`)
process.argv = [process.argv[0], process.argv[1], ...plan.args]
await import('./machine-room.mjs')
