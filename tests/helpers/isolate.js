import { testRunsFolder } from './tempRoot.js'

if (!process.env.MACHINEROOM_RUNS) {
  process.env.MACHINEROOM_RUNS = testRunsFolder()
}
