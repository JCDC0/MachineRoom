import { spawnSync } from 'node:child_process'

export const KILL_TIMEOUT_MS = 10000

export function treeSpawnOptions(platform = process.platform) {
  return platform === 'win32' ? {} : { detached: true }
}

export function killTree(child, { platform = process.platform, run = spawnSync, kill = process.kill } = {}) {
  const pid = child?.pid
  if (!Number.isInteger(pid) || pid <= 0) return false
  if (platform === 'win32') {
    const result = run('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true, timeout: KILL_TIMEOUT_MS })
    return !result?.error && result?.status === 0
  }
  try {
    kill(-pid, 'SIGKILL')
    return true
  } catch {}
  try {
    return child.kill('SIGKILL') !== false
  } catch {
    return false
  }
}
