import { realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { posix, resolve, win32 } from 'node:path'

export function isWindowsPath(value) {
  return /^[A-Za-z]:(?:[\\/]|$)/.test(value) || value.startsWith('\\\\')
}

function matchPathPrefix(pathStr, prefix, win32Path) {
  if (!pathStr || !prefix) return null
  if (win32Path) {
    const lowerPath = pathStr.toLowerCase()
    const lowerPrefix = prefix.toLowerCase()
    if (lowerPath === lowerPrefix) return { suffix: '', length: prefix.length }
    const hasSep = prefix.endsWith('\\') || prefix.endsWith('/')
    const prefixWithSep = hasSep ? prefix : `${prefix}\\`
    if (lowerPath.startsWith(prefixWithSep.toLowerCase())) {
      const suffix = hasSep ? pathStr.slice(prefix.length - 1) : pathStr.slice(prefix.length)
      return { suffix, length: prefix.length }
    }
    return null
  }
  if (pathStr === prefix) return { suffix: '', length: prefix.length }
  const hasSep = prefix.endsWith('/')
  const prefixWithSep = hasSep ? prefix : `${prefix}/`
  if (pathStr.startsWith(prefixWithSep)) {
    const suffix = hasSep ? pathStr.slice(prefix.length - 1) : pathStr.slice(prefix.length)
    return { suffix, length: prefix.length }
  }
  return null
}

export function realPath(value) {
  const folder = resolve(String(value ?? ''))
  try {
    return realpathSync.native(folder)
  } catch {
    return folder
  }
}

function testPrefix(resolved, rawPrefix, pathApi, win32Path) {
  if (!rawPrefix) return null
  if (win32Path && rawPrefix.startsWith('/') && !rawPrefix.startsWith('//')) return null
  if (!win32Path && isWindowsPath(rawPrefix)) return null
  const direct = matchPathPrefix(resolved, pathApi.resolve(rawPrefix), win32Path)
  const samePlatform = win32Path === (process.platform === 'win32')
  const real = samePlatform ? matchPathPrefix(resolved, realPath(rawPrefix), win32Path) : null
  if (direct && real) return real.length > direct.length ? real : direct
  return direct ?? real
}

function readEnv(env, name) {
  return typeof env?.[name] === 'string' ? env[name].trim() : ''
}

export function printedRunsFolder(folder, env = process.env) {
  const raw = String(folder ?? '')
  const win32Path = isWindowsPath(raw) || (process.platform === 'win32' && !raw.startsWith('/'))
  const pathApi = win32Path ? win32 : posix
  const resolved = pathApi.resolve(raw)
  let tempFallback = ''
  let homeFallback = ''
  if (env === process.env) {
    try {
      tempFallback = tmpdir()
    } catch {}
    try {
      homeFallback = homedir()
    } catch {}
  }
  const temp = readEnv(env, 'TEMP') || readEnv(env, 'TMP') || tempFallback
  const local = readEnv(env, 'LOCALAPPDATA')
  const roaming = readEnv(env, 'APPDATA')
  const userProfile = readEnv(env, 'USERPROFILE') || (process.platform === 'win32' ? homeFallback : '')
  const stateHome = readEnv(env, 'XDG_STATE_HOME')
  const home = readEnv(env, 'HOME') || (process.platform !== 'win32' ? homeFallback : '')
  const windowsCandidates = [
    { prefix: local, label: '%LOCALAPPDATA%' },
    { prefix: roaming, label: '%APPDATA%' },
    { prefix: userProfile, label: '%USERPROFILE%' },
  ]
  const candidates = [
    { prefix: temp, label: '%TEMP%' },
    ...(win32Path ? windowsCandidates : []),
    { prefix: stateHome, label: '$XDG_STATE_HOME' },
    { prefix: home, label: '~' },
  ]
  let best = null
  for (const { prefix, label } of candidates) {
    const match = testPrefix(resolved, prefix, pathApi, win32Path)
    if (!match) continue
    if (!best || match.length > best.length) {
      best = { length: match.length, value: `${label}${match.suffix}` }
    }
  }
  return best ? best.value : resolved
}
