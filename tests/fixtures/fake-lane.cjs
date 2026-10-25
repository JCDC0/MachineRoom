#!/usr/bin/env node
const { execFileSync } = require('node:child_process')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')

const args = process.argv.slice(2)
const file = 'lane-note.txt'
writeFileSync(join(process.cwd(), file), 'The fake lane wrote this file.\n')

if (/\bcommit it\b/.test(args.join(' '))) {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'MachineRoom Test',
    GIT_AUTHOR_EMAIL: 'machineroom@example.invalid',
    GIT_COMMITTER_NAME: 'MachineRoom Test',
    GIT_COMMITTER_EMAIL: 'machineroom@example.invalid',
  }
  const git = (gitArgs) => execFileSync('git', gitArgs, { cwd: process.cwd(), env, stdio: 'ignore', windowsHide: true })
  git(['add', '-A'])
  git(['commit', '-m', 'Write the lane note from the fake lane.'])
}

console.log(
  JSON.stringify({
    type: 'tool_use',
    timestamp: Date.now(),
    sessionID: 'ses_fake_lane',
    part: {
      id: 'prt_fake_lane_1',
      type: 'tool',
      tool: 'write',
      state: {
        status: 'completed',
        input: { filePath: 'lane-note.txt', content: 'The fake lane wrote this file.' },
        output: 'Wrote file successfully: lane-note.txt',
      },
    },
  })
)
