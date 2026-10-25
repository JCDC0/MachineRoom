#!/usr/bin/env node
import { statSync } from 'node:fs'
import { upArgs } from '../server/doctor.js'

function isFolder(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

const help = process.argv.includes('--help')
const plan = upArgs(process.argv.slice(2))
if (!help && !isFolder(plan.root)) {
  console.error(`machineroom: ${plan.root} is not a folder. Give a project folder, or run machineroom inside one.`)
  process.exit(1)
}
if (!help) console.log(`machineroom: starting the room for ${plan.root}`)
process.argv = [process.argv[0], process.argv[1], ...plan.args]
await import('./machine-room.mjs')
