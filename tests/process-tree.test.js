import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { descendantProcesses, killTree, leftoverProcesses, listProcesses, parseProcessList, processListCommand, treeSpawnOptions } from '../server/processTree.js'
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
    expect(command.args[2]).toContain('CreationDate')
    expect(processListCommand('linux')).toEqual({ file: 'ps', args: ['-eo', 'pid,ppid,args'] })
  })

  it('reads one object or an array from the Windows listing', () => {
    const one = JSON.stringify({ ProcessId: 10, ParentProcessId: 4, CommandLine: 'node a.js' })
    expect(parseProcessList(one, { platform: 'win32' })).toEqual([{ pid: 10, ppid: 4, command: 'node a.js' }])
    const withDate = JSON.stringify({
      ProcessId: 10,
      ParentProcessId: 4,
      CommandLine: 'node a.js',
      CreationDate: '/Date(1793351410153)/',
    })
    expect(parseProcessList(withDate, { platform: 'win32' })).toEqual([
      { pid: 10, ppid: 4, command: 'node a.js', created: 1793351410153 },
    ])
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

  it('does not take a sibling worktree whose name starts with the lane folder', () => {
    const lanes = [
      { pid: 10, ppid: 1, command: 'node C:\\repo\\.worktrees\\opencode2\\node_modules\\vitest.mjs' },
      { pid: 11, ppid: 1, command: 'node C:\\repo\\.worktrees\\opencode10' },
      { pid: 12, ppid: 1, command: 'node "C:\\repo\\.worktrees\\opencode"' },
      { pid: 13, ppid: 1, command: 'node C:\\repo\\.worktrees\\opencode\\x.js' },
      { pid: 14, ppid: 1, command: 'node C:\\repo\\.worktrees\\opencode' },
    ]
    expect(leftoverProcesses(lanes, { worktree: 'C:\\repo\\.worktrees\\opencode', platform: 'win32' }).map((item) => item.pid)).toEqual([12, 13, 14])
  })

  it('leaves out the pids the caller stops itself', () => {
    expect(leftoverProcesses(rows, { worktree: 'C:\\work\\lane', platform: 'win32', excludePids: [4] }).map((item) => item.pid)).toEqual([])
    expect(leftoverProcesses(rows, { worktree: '', childPid: 2, excludePids: [3] }).map((item) => item.pid)).toEqual([])
  })

  it('does not count a process as a child of a parent created after it', () => {
    const list = [
      { pid: 1, ppid: 0, command: 'init', created: 1000 },
      { pid: 2, ppid: 1, command: 'node harness', created: 2000 },
      { pid: 3, ppid: 2, command: 'node helper', created: 3000 },
      { pid: 4, ppid: 2, command: 'node stranger', created: 1500 },
      { pid: 5, ppid: 2, command: 'node nocreation' },
    ]
    expect(leftoverProcesses(list, { childPid: 2, platform: 'win32' }).map((item) => item.pid)).toEqual([3, 5])
  })
})

describe('descendantProcesses', () => {
  const rows = [
    { pid: 1, ppid: 0, command: 'init' },
    { pid: 2, ppid: 1, command: 'node harness' },
    { pid: 3, ppid: 2, command: 'node helper' },
    { pid: 4, ppid: 3, command: 'node late' },
    { pid: 5, ppid: 1, command: 'node other' },
  ]

  it('takes every descendant of the root and leaves the root out', () => {
    expect(descendantProcesses(rows, { rootPid: 2 }).map((item) => item.pid)).toEqual([3, 4])
    expect(descendantProcesses(rows, { rootPid: 1 }).map((item) => item.pid)).toEqual([2, 3, 4, 5])
    expect(descendantProcesses(rows, { rootPid: 3 }).map((item) => item.pid)).toEqual([4])
  })

  it('leaves out the process asking and the pids it excludes', () => {
    expect(descendantProcesses(rows, { rootPid: 1, ownPid: 5 }).map((item) => item.pid)).toEqual([2, 3, 4])
    expect(descendantProcesses(rows, { rootPid: 2, excludePids: [3] }).map((item) => item.pid)).toEqual([4])
  })

  it('handles junk rows and a missing root', () => {
    expect(descendantProcesses(null, { rootPid: 2 })).toEqual([])
    expect(descendantProcesses(rows, {})).toEqual([])
    expect(descendantProcesses([null, {}, { pid: 0, ppid: 0, command: 'x' }], { rootPid: 2 })).toEqual([])
  })

  it('does not count a process as a child of a parent created after it', () => {
    const list = [
      { pid: 1, ppid: 0, command: 'init', created: 1000 },
      { pid: 2, ppid: 1, command: 'node harness', created: 2000 },
      { pid: 3, ppid: 2, command: 'node helper', created: 3000 },
      { pid: 4, ppid: 2, command: 'node stranger', created: 1500 },
      { pid: 5, ppid: 2, command: 'node nocreation' },
    ]
    expect(descendantProcesses(list, { rootPid: 2 }).map((item) => item.pid)).toEqual([3, 5])
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

describe('descendantProcesses with a dead root', () => {
  it('still finds a child whose root has left the list', () => {
    const list = [{ pid: 300, ppid: 200, command: '', created: 5000 }, { pid: 999, ppid: 1, command: '', created: 1000 }]
    expect(descendantProcesses(list, { rootPid: 200 }).map((item) => item.pid)).toEqual([300])
  })
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

  it('leaves an exited child alone on Windows, since its process id may be reused', () => {
    const calls = []
    const run = (file, args) => {
      calls.push({ file, args })
      return { status: 0 }
    }
    expect(killTree({ pid: 4242, exitCode: 0, signalCode: null }, { platform: 'win32', run })).toBe(false)
    expect(killTree({ pid: 4242, exitCode: null, signalCode: 'SIGTERM' }, { platform: 'win32', run })).toBe(false)
    expect(calls).toEqual([])
    expect(killTree({ pid: 4242, exitCode: null, signalCode: null }, { platform: 'win32', run })).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('still signals the group of an exited leader elsewhere', () => {
    const signals = []
    const kill = (pid, signal) => {
      signals.push({ pid, signal })
      return true
    }
    expect(killTree({ pid: 4242, exitCode: 0 }, { platform: 'linux', kill })).toBe(true)
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
