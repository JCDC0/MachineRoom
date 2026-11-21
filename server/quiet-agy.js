// AGY's background updater runs `agy --version` in a visible console window on Windows,
// so every agy that MachineRoom starts inherits this switch, unless the owner set it already.
// agy reads only `true` here (tested 2026-11-21: `1` still starts the updater); a `1` left by an older MachineRoom is raised.
export const AGY_QUIET_ENV = 'AGY_CLI_DISABLE_AUTO_UPDATE'
export const AGY_QUIET_VALUE = 'true'

export function quietAgy(env = process.env) {
  if (env[AGY_QUIET_ENV] === undefined || env[AGY_QUIET_ENV] === '1') env[AGY_QUIET_ENV] = AGY_QUIET_VALUE
  return env
}

quietAgy()
