import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { appendRunRecord } from '../scripts/run-lane.mjs'
import { makeTempDir } from './helpers/tempRoot.js'

it('keeps the next record separate from a torn tail', () => {
  const root = makeTempDir('mr-records-')
  try {
    const file = join(root, 'runs.jsonl')
    writeFileSync(file, '{"lane":"torn"')
    expect(appendRunRecord({ lane: 'next' }, { file })).toBe(true)
    expect(readFileSync(file, 'utf8').split('\n')).toEqual(['{"lane":"torn"', '{"lane":"next"}', ''])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
