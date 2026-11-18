import './hide-windows.mjs'
import { testRecordingsFolder, testRunsFolder } from './tempRoot.js'

const hideWindowsImport = `--import=${new URL('./hide-windows.mjs', import.meta.url).href}`
const escapedImport = hideWindowsImport.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const nodeOptions = (process.env.NODE_OPTIONS ?? '').replace(new RegExp(`(?:^|\\s)${escapedImport}(?=\\s|$)`, 'g'), '').trim()
process.env.NODE_OPTIONS = `${nodeOptions} ${hideWindowsImport}`.trim()

// A lane or the orchestrator runs tests with its own runs folder and lane list set; a test must never write there.
process.env.MACHINEROOM_RUNS = testRunsFolder()
process.env.MACHINEROOM_RECORDINGS = testRecordingsFolder()
process.env.MACHINEROOM_SAMPLE_MS = '0'
delete process.env.MACHINEROOM_LANES_DIR
