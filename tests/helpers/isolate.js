import { testRunsFolder } from './tempRoot.js'

// A lane or the orchestrator runs tests with its own runs folder and lane list set; a test must never write there.
process.env.MACHINEROOM_RUNS = testRunsFolder()
delete process.env.MACHINEROOM_LANES_DIR
