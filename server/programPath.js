import { accessSync, constants, statSync } from 'node:fs'
import { posix, win32 } from 'node:path'

const found = new Map()

function isProgram(path, platform) {
  try {
    if (!statSync(path).isFile()) return false
    if (platform !== 'win32') accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function unquote(folder) {
  const text = folder.trim()
  return text.length > 1 && text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text
}

export function programPath(name, { platform = process.platform, env = process.env, check } = {}) {
  const paths = platform === 'win32' ? win32 : posix
  const list = String(env.PATH ?? env.Path ?? '')
  const key = `${platform}\u0000${name}\u0000${list}`
  if (!check && found.has(key)) return found.get(key)
  const test = check ?? isProgram
  const endings = platform === 'win32' ? ['.com', '.exe'] : ['']
  let result = null
  for (const entry of list.split(paths.delimiter)) {
    const folder = unquote(entry)
    if (!folder || !paths.isAbsolute(folder)) continue
    const hit = endings.map((ending) => paths.join(folder, `${name}${ending}`)).find((candidate) => test(candidate, platform))
    if (hit) {
      result = hit
      break
    }
  }
  if (!check && result) found.set(key, result)
  return result
}

export function gitPath() {
  const path = programPath('git')
  if (!path) throw Object.assign(new Error('Git is not on the PATH.'), { code: 'ENOGIT' })
  return path
}

export function gitEnv(base = process.env) {
  const env = { ...base }
  for (const key of Object.keys(env)) {
    if (['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR'].includes(key.toUpperCase())) delete env[key]
  }
  return env
}
