import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'

const marker = Symbol.for('machineroom.hideWindows')
if (!childProcess[marker]) {
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork']) {
    const original = childProcess[name]
    childProcess[name] = function (...args) {
      let index = name === 'exec' || name === 'execSync' ? 1 : 2
      if (index === 2 && !Array.isArray(args[1]) && !(args[1] == null && args.length > 2)) index = 1
      const options = args[index]
      if (typeof options === 'function') args.splice(index, 0, { windowsHide: true })
      else if (options == null) args[index] = { windowsHide: true }
      else if (typeof options === 'string') args[index] = { windowsHide: true, encoding: options }
      else args[index] = { windowsHide: true, ...options }
      return original.apply(this, args)
    }
  }
  childProcess[marker] = true
  syncBuiltinESMExports()
}
