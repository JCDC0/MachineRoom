import { describe, expect, it } from 'vitest'
import { printedRunsFolder } from '../server/printed-path.js'

describe('printedRunsFolder labels', () => {
  it('gives a Windows path below a longer Windows HOME the profile label, not ~', () => {
    expect(
      printedRunsFolder('C:\\Users\\me\\work\\runs\\run.log', {
        USERPROFILE: 'C:\\Users\\me',
        HOME: 'C:\\Users\\me\\work',
      })
    ).toBe('%USERPROFILE%\\work\\runs\\run.log')
  })

  it('leaves $XDG_STATE_HOME to posix paths', () => {
    expect(
      printedRunsFolder('C:\\Users\\me\\state\\runs', {
        USERPROFILE: 'C:\\Users\\me',
        XDG_STATE_HOME: 'C:\\Users\\me\\state',
      })
    ).toBe('%USERPROFILE%\\state\\runs')
  })
})
