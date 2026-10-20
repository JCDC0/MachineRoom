import { mkdirSync, mkdtempSync } from 'node:fs'
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
  return mkdtempSync(join(processTempRoot(process.pid, root), prefix))
}
