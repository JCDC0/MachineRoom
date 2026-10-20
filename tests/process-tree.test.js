import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { killTree, treeSpawnOptions } from '../server/processTree.js'

const PARENT = [
  "const { spawn } = require('node:child_process')",
  "const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })",
  "console.log('grandchild ' + child.pid)",
  'setTimeout(() => {}, 60000)',
].join('\n')

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

async function waitUntil(fn, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (fn()) return
    await new Promise((settle) => setTimeout(settle, 25))
  }
  throw new Error('condition not met in time')
}

describe('killTree', () => {
  it('asks taskkill for the whole tree with force on Windows', () => {
    const calls = []
    const run = (file, args, options) => {
      calls.push({ file, args, options })
      return { status: 0 }
    }
    expect(killTree({ pid: 4242 }, { platform: 'win32', run })).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].file).toBe('taskkill')
    expect(calls[0].args).toEqual(['/T', '/F', '/PID', '4242'])
    expect(calls[0].options.windowsHide).toBe(true)
    expect(calls[0].options.timeout).toBeGreaterThan(0)
  })

  it('kills the process group away from Windows', () => {
    const signals = []
    const kill = (pid, signal) => signals.push({ pid, signal })
    expect(killTree({ pid: 4242, kill: () => true }, { platform: 'linux', kill })).toBe(true)
    expect(signals).toEqual([{ pid: -4242, signal: 'SIGKILL' }])
  })

  it('falls back to the child alone when it leads no group', () => {
    const killed = []
    const child = { pid: 4242, kill: (signal) => killed.push(signal) }
    const kill = () => {
      throw Object.assign(new Error('no such group'), { code: 'ESRCH' })
    }
    expect(killTree(child, { platform: 'linux', kill })).toBe(true)
    expect(killed).toEqual(['SIGKILL'])
  })

  it('does nothing without a process id', () => {
    const run = () => {
      throw new Error('should not run')
    }
    expect(killTree({}, { platform: 'win32', run })).toBe(false)
    expect(killTree(null, { platform: 'linux' })).toBe(false)
  })

  it('starts a group leader only away from Windows', () => {
    expect(treeSpawnOptions('win32')).toEqual({})
    expect(treeSpawnOptions('linux')).toEqual({ detached: true })
    expect(treeSpawnOptions('darwin')).toEqual({ detached: true })
  })

  it('stops a real child and the process it started', async () => {
    const child = spawn(process.execPath, ['-e', PARENT], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      ...treeSpawnOptions(),
    })
    let grandchild = 0
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
      const match = /grandchild (\d+)/.exec(output)
      if (match) grandchild = Number(match[1])
    })
    try {
      await waitUntil(() => grandchild > 0)
      expect(alive(child.pid)).toBe(true)
      expect(alive(grandchild)).toBe(true)
      expect(killTree(child)).toBe(true)
      await waitUntil(() => !alive(grandchild))
      await waitUntil(() => child.exitCode !== null || child.signalCode !== null)
    } finally {
      if (grandchild > 0 && alive(grandchild)) process.kill(grandchild, 'SIGKILL')
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
  })
})
