// AGY's background updater runs `agy --version` in a visible console window on Windows,
// so every agy that MachineRoom starts inherits this switch, unless the owner set it already.
export const AGY_QUIET_ENV = 'AGY_CLI_DISABLE_AUTO_UPDATE'

export function quietAgy(env = process.env) {
  if (env[AGY_QUIET_ENV] === undefined) env[AGY_QUIET_ENV] = '1'
  return env
}

quietAgy()
