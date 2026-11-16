import { EventEmitter } from 'node:events'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearRunsCache, createRunsApi } from '../server/runs.js'
import { laneLockText } from '../src/briefs/run.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const runner = vi.hoisted(() => ({ starts: 0, stopMode: '', release: null, active: null }))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    spawn: (file, args, options) => {
      if (file !== 'cancel-test-runner') return actual.spawn(file, args, options)
      const child = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      if (args.includes('--stop')) {
        const finish = (code) => {
          if (code === 0) rmSync(join(options.env.MACHINEROOM_RUNS, `${args[args.indexOf('--stop') + 1]}.lock`), { force: true })
          if (code === 0) runner.active?.emit('close', 0)
          child.emit('close', code)
        }
        if (runner.stopMode === 'hold') runner.release = () => finish(0)
        else queueMicrotask(() => finish(runner.stopMode === 'fail' ? 1 : 0))
      } else {
        runner.starts += 1
        runner.active = child
      }
      return child
    },
  }
})

const cleanups = []

afterEach(() => {
  while (cleanups.length) cleanups.pop()()
  Object.assign(runner, { starts: 0, stopMode: '', release: null, active: null })
  clearRunsCache()
})

function rig() {
  const base = makeTempDir('mr-interrupt-cancel-')
  cleanups.push(() => removeTempDir(base))
  const runs = join(base, 'runs')
  const project = join(base, 'project')
  mkdirSync(runs)
  mkdirSync(project)
  const lanesFile = join(base, 'lanes.json')
  writeFileSync(lanesFile, JSON.stringify({ primary: { cli: { harness: 'claude', bin: process.execPath } } }))
  const api = createRunsApi({ projectRoot: project, lanesFile, runsFolder: runs, runnerCommand: { file: 'cancel-test-runner', args: [] } })
  cleanups.push(() => api.stopAll())
  const held = api.startRun('primary', [], { project, task: 'Work.' })
  writeFileSync(join(runs, 'primary.lock'), laneLockText({ pid: process.pid, startedAt: held.startedAt, log: 'primary-1.log' }))
  return { api, held }
}

function inbox() {
  const entries = [{ from: 'orchestrator', text: 'first', status: 'queued' }]
  const seen = new Set()
  return {
    entries,
    takeUnseen: () => entries.filter((entry) => !seen.has(entry)),
    markSeen: (items) => items.forEach((entry) => { seen.add(entry); entry.status = 'interrupted' }),
  }
}

describe('interrupt cancellation', () => {
  it('keeps the replies queued after a failed stop and sends them on the next interrupt', async () => {
    const { api, held } = rig()
    const box = inbox()
    runner.stopMode = 'fail'
    expect(await api.interruptLane({ lane: 'primary', held, takeUnseen: box.takeUnseen, markSeen: box.markSeen })).toBe(false)
    expect(box.entries[0].status).toBe('queued')
    expect(box.takeUnseen()).toHaveLength(1)

    runner.stopMode = ''
    expect(await api.interruptLane({ lane: 'primary', held, takeUnseen: box.takeUnseen, markSeen: box.markSeen })).toBe(true)
    expect(box.entries[0].status).toBe('interrupted')
    expect(runner.starts).toBe(2)
  })

  it('never restarts an interrupted lane that Stop sector cancelled', async () => {
    const { api, held } = rig()
    const box = inbox()
    runner.stopMode = 'hold'
    const pending = api.interruptLane({ lane: 'primary', held, takeUnseen: box.takeUnseen, markSeen: box.markSeen })
    await vi.waitFor(() => expect(runner.release).toBeTypeOf('function'))
    await api.stopSectorLanes({ isWholeTree: true })
    runner.release()
    expect(await pending).toBe(false)
    expect(runner.starts).toBe(1)
    expect(box.entries[0].status).toBe('queued')
  })
})
