import { spawn } from 'node:child_process'
import { nextTestStep } from '../src/briefs/run.js'

const VITEST = [process.execPath, 'node_modules/vitest/vitest.mjs', 'run']
const BAD_COMMAND = 'MACHINEROOM_TEST_COMMAND needs a JSON array of the command and its arguments.'

function testCommand(env) {
  const raw = env.MACHINEROOM_TEST_COMMAND
  if (typeof raw !== 'string' || raw.trim() === '') return VITEST
  let value
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error(BAD_COMMAND)
  }
  if (!Array.isArray(value) || value.length === 0) throw new Error(BAD_COMMAND)
  const parts = value.map((part) => String(part))
  if (parts.some((part) => part.trim() === '')) throw new Error(BAD_COMMAND)
  return parts
}

function runOnce(command) {
  return new Promise((resolveRun) => {
    const [file, ...args] = command
    const child = spawn(file, args, { stdio: 'inherit' })
    child.once('error', (error) => resolveRun({ status: null, error }))
    child.once('exit', (code) => resolveRun({ status: code, error: null }))
  })
}

async function main() {
  let command
  try {
    command = [...testCommand(process.env), ...process.argv.slice(2)]
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
    return
  }
  let tries = 0
  for (;;) {
    const result = await runOnce(command)
    if (result.error) {
      console.error(`The test command did not start (${result.error.message}).`)
      process.exitCode = 1
      return
    }
    tries += 1
    const step = nextTestStep(result.status, tries)
    if (step.message) console.log(step.message)
    if (step.action === 'done') {
      process.exitCode = step.code
      return
    }
  }
}

await main()
