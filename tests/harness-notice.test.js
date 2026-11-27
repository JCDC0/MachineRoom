import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { expect, it, vi } from 'vitest'
import { createAgentsConfigApi } from '../server/agents-config.js'
import { saveHarnessSettings } from '../server/harness-settings.js'
import { startLane } from '../scripts/run-lane.mjs'
import { harnessByKey } from '../src/harnesses/index.js'
import FamilyTeam from '../src/ui/FamilyTeam.jsx'
import { FamilyTree } from '../src/ui/FamilyTree.jsx'
import { makeTempDir } from './helpers/tempRoot.js'
import { withDom } from './helpers/uiDom.js'

it('notifies after a settings write and a check', async () => {
  const runs = makeTempDir('notice-')
  try {
    const notices = []
    let status
    const api = createAgentsConfigApi({ runsFolder: runs, lanes: {}, env: { PATH: '' }, notify: (notice) => notices.push(notice), sendJson: (_req, _res, code) => { status = code }, readJsonBody: async (req) => req.body })
    for (const [path, body] of [['settings', { key: 'claude', enabled: false, confirmed: true }], ['check', { confirmed: true }]]) {
      await api.handle({ method: 'POST', headers: { origin: 'http://localhost' }, body }, {}, new URL(`http://localhost/api/harnesses/${path}`))
      expect(status).toBe(200)
    }
    expect(notices).toEqual([{ topic: 'harnesses' }, { topic: 'harnesses' }])
  } finally { rmSync(runs, { recursive: true, force: true }) }
})

it.each([['family tree', FamilyTree], ['team form', FamilyTeam]])('reads harness rows on a notice in %s', async (_name, Component) => {
  const listeners = []
  const read = vi.fn(async () => ({ harnesses: [] }))
  const client = { family: async () => ({ nodes: [], keys: [], proposals: [] }), lanes: async () => ({ lanes: [] }), harnesses: read, models: async () => ({ models: [] }), orchestrators: async () => [], subscribe: (fn) => { listeners.push(fn); return () => {} } }
  await withDom(async ({ root }) => {
    await act(async () => { root.render(createElement(Component, { client })) })
    expect(read).toHaveBeenCalledTimes(1)
    await act(async () => { listeners.forEach((listener) => listener({ topic: 'harnesses' })) })
    expect(read).toHaveBeenCalledTimes(2)
  })
})

it('refuses a direct start on an off harness before touching its worktree', async () => {
  const folder = makeTempDir('off-start-')
  const runs = join(folder, 'runs')
  const previous = process.env.MACHINEROOM_RUNS
  try {
    process.env.MACHINEROOM_RUNS = runs
    saveHarnessSettings(runs, { programs: {}, off: ['claude'] })
    const lane = { worktree: join(folder, 'missing'), cli: { harness: 'claude' } }
    await expect(startLane({ options: { lane: 'backup' }, lane, lanes: { backup: lane } })).rejects.toThrow('That harness is turned off in Settings.')
    expect(existsSync(lane.worktree)).toBe(false)
  } finally {
    if (previous === undefined) delete process.env.MACHINEROOM_RUNS
    else process.env.MACHINEROOM_RUNS = previous
    rmSync(folder, { recursive: true, force: true })
  }
})

it('refuses an off backup before its lock or start and records the refusal', async () => {
  const folder = makeTempDir('off-backup-')
  const runs = join(folder, 'runs')
  const previous = process.env.MACHINEROOM_RUNS
  const command = harnessByKey.opencode.command
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    process.env.MACHINEROOM_RUNS = runs
    saveHarnessSettings(runs, { programs: {}, off: ['claude'] })
    harnessByKey.opencode.command = () => ({ file: process.execPath, args: ['-e', "console.log(JSON.stringify({ type: 'error', error: { type: 'provider.rate_limit', message: '429 Too Many Requests' } })); process.exitCode = 1"], cwd: folder })
    const lanes = { primary: { name: 'Primary', fallback: 'backup', cli: { harness: 'opencode', bin: process.execPath } }, backup: { name: 'Backup', cli: { harness: 'claude', bin: process.execPath } } }
    const result = await startLane({ options: { lane: 'primary', minutes: 1 }, lane: lanes.primary, lanes, wanted: [], prompt: 'Task', logPath: join(runs, 'primary.log'), usageFile: join(runs, 'usage.json'), name: 'primary', project: folder, projectBranch: 'main' })
    expect(result.code).not.toBe(0)
    expect(log.mock.calls.flat().join('\n')).toContain('That harness is turned off in Settings.')
    expect(existsSync(join(runs, 'backup.lock'))).toBe(false)
    const records = readFileSync(join(runs, 'runs.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse)
    expect(records).toHaveLength(1)
    expect(records[0].failover).toMatchObject({ to: 'backup', refused: true })
  } finally {
    harnessByKey.opencode.command = command
    log.mockRestore()
    if (previous === undefined) delete process.env.MACHINEROOM_RUNS
    else process.env.MACHINEROOM_RUNS = previous
    rmSync(folder, { recursive: true, force: true })
  }
}, 30000)
