import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const TEMP_ROOT = join(tmpdir(), 'machineroom-tests')

const made = new Set()

export function processTempRoot(pid = process.pid, root = TEMP_ROOT) {
  const dir = join(root, String(pid))
  if (!made.has(dir)) {
    mkdirSync(dir, { recursive: true })
    made.add(dir)
  }
  return dir
}

export function makeTempDir(prefix, root = TEMP_ROOT) {
  // A runner's TEMP can be an 8.3 short path; the code under test resolves the long one.
  return realpathSync.native(mkdtempSync(join(processTempRoot(process.pid, root), prefix)))
}

export function removeTempDir(dir) {
  if (!dir) return
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  } catch {}
}
