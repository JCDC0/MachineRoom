import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { killTree, leftoverProcesses, listProcesses, parseProcessList, processListCommand, treeSpawnOptions } from '../server/processTree.js'
import { makeTempDir } from './helpers/tempRoot.js'

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

describe('the process list', () => {
  it('asks Windows for one CIM listing through an argument list', () => {
    const command = processListCommand('win32')
    expect(command.file).toBe('powershell')
    expect(command.args.slice(0, 2)).toEqual(['-NoProfile', '-Command'])
    expect(command.args[2]).toContain('Get-CimInstance Win32_Process')
    expect(command.args[2]).toContain('ProcessId')
    expect(command.args[2]).toContain('ParentProcessId')
    expect(command.args[2]).toContain('CommandLine')
    expect(processListCommand('linux')).toEqual({ file: 'ps', args: ['-eo', 'pid,ppid,args'] })
  })

  it('reads one object or an array from the Windows listing', () => {
    const one = JSON.stringify({ ProcessId: 10, ParentProcessId: 4, CommandLine: 'node a.js' })
    expect(parseProcessList(one, { platform: 'win32' })).toEqual([{ pid: 10, ppid: 4, command: 'node a.js' }])
    const many = JSON.stringify([
      { ProcessId: 10, ParentProcessId: 4, CommandLine: 'node a.js' },
      { ProcessId: 11, ParentProcessId: 10, CommandLine: null },
    ])
    expect(parseProcessList(many, { platform: 'win32' })).toEqual([
      { pid: 10, ppid: 4, command: 'node a.js' },
      { pid: 11, ppid: 10, command: '' },
    ])
    expect(parseProcessList('', { platform: 'win32' })).toEqual([])
    expect(parseProcessList('not json', { platform: 'win32' })).toEqual([])
  })

  it('reads the ps columns elsewhere', () => {
    const text = ['  PID  PPID COMMAND', '   10     4 node a.js', '   11    10 node b.js --flag', 'bad line'].join('\n')
    expect(parseProcessList(text, { platform: 'linux' })).toEqual([
      { pid: 10, ppid: 4, command: 'node a.js' },
      { pid: 11, ppid: 10, command: 'node b.js --flag' },
    ])
  })
})

describe('leftoverProcesses', () => {
  const rows = [
    { pid: 1, ppid: 0, command: 'init' },
    { pid: 2, ppid: 1, command: 'node harness' },
    { pid: 3, ppid: 2, command: 'node helper' },
    { pid: 4, ppid: 1, command: 'node other C:\\work\\lane\\run.js' },
    { pid: 5, ppid: 4, command: 'node child' },
  ]

  it('takes the descendants of the child and the processes that name the worktree', () => {
    const found = leftoverProcesses(rows, { childPid: 2, worktree: 'C:\\work\\lane', platform: 'win32' })
    expect(found.map((item) => item.pid)).toEqual([3, 4])
  })

  it('leaves out the child, its parents and the process asking', () => {
    expect(leftoverProcesses(rows, { childPid: 2, worktree: '', ownPid: 3 }).map((item) => item.pid)).toEqual([])
    expect(leftoverProcesses(rows, { childPid: 2, worktree: 'C:\\work\\lane', ownPid: 5 }).map((item) => item.pid)).toEqual([3])
    expect(leftoverProcesses(rows, { childPid: 1, worktree: '' }).map((item) => item.pid)).toEqual([2, 3, 4, 5])
  })

  it('compares the folder without case on Windows and with case elsewhere', () => {
    expect(leftoverProcesses(rows, { worktree: 'c:/WORK/lane', platform: 'win32' }).map((item) => item.pid)).toEqual([4])
    expect(leftoverProcesses(rows, { worktree: 'c:/WORK/lane', platform: 'linux' }).map((item) => item.pid)).toEqual([])
  })

  it('handles junk rows and a missing folder', () => {
    expect(leftoverProcesses(null, { childPid: 2 })).toEqual([])
    expect(leftoverProcesses([null, {}, { pid: 0, ppid: 0, command: 'x' }], { childPid: 2 })).toEqual([])
    expect(leftoverProcesses(rows, {})).toEqual([])
  })

  it('leaves out the pids the caller stops itself', () => {
    expect(leftoverProcesses(rows, { worktree: 'C:\\work\\lane', platform: 'win32', excludePids: [4] }).map((item) => item.pid)).toEqual([])
    expect(leftoverProcesses(rows, { worktree: '', childPid: 2, excludePids: [3] }).map((item) => item.pid)).toEqual([])
  })
})

describe('listProcesses', () => {
  it('lists this machine and finds a real process by the folder in its command line', async () => {
    const folder = makeTempDir('mr-process-list-')
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', folder], {
      stdio: 'ignore',
      windowsHide: true,
    })
    try {
      const deadline = Date.now() + 10000
      let found = []
      while (Date.now() < deadline) {
        found = leftoverProcesses(listProcesses(), { worktree: folder, ownPid: process.pid })
        if (found.some((item) => item.pid === child.pid)) break
        await new Promise((settle) => setTimeout(settle, 100))
      }
      expect(found.some((item) => item.pid === child.pid)).toBe(true)
    } finally {
      killTree(child)
    }
  }, 30000)
})

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

  it('kills a plain process id when it leads no group', () => {
    const signals = []
    const kill = (pid, signal) => {
      if (pid < 0) throw Object.assign(new Error('no such group'), { code: 'ESRCH' })
      signals.push({ pid, signal })
      return true
    }
    expect(killTree({ pid: 4242 }, { platform: 'linux', kill })).toBe(true)
    expect(signals).toEqual([{ pid: 4242, signal: 'SIGKILL' }])
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
