#!/usr/bin/env node
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')

writeFileSync(join(process.cwd(), 'lane-note.txt'), 'The fake lane wrote this file.\n')
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
