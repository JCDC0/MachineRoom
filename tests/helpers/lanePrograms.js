import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'

const LANES = new URL('../../docs/agents/lanes.json', import.meta.url)

// The doctor and the dry runs look for each lane's program, which a CI runner has not installed.
export function withLanePrograms(env, folder) {
  const next = { ...env }
  const bin = join(folder, 'bin')
  mkdirSync(bin, { recursive: true })
  const lanes = JSON.parse(readFileSync(LANES, 'utf8'))
  for (const lane of Object.values(lanes)) {
    if (!lane || lane.retired === true || typeof lane.cli?.bin !== 'string') continue
    let path = lane.cli.bin.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (whole, name) => {
      next[name] = join(folder, name.toLowerCase())
      return next[name]
    })
    if (!/[\\/]/.test(path)) path = join(bin, process.platform === 'win32' ? `${path}.exe` : path)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, '')
    chmodSync(path, 0o755)
  }
  // A Windows runner can carry both Path and PATH; keep one, or the child may read the other.
  const pathKeys = Object.keys(next).filter((key) => key.toUpperCase() === 'PATH')
  const current = pathKeys.map((key) => next[key]).find(Boolean) ?? ''
  for (const key of pathKeys) delete next[key]
  next.PATH = [bin, current].filter(Boolean).join(delimiter)
  return next
}
