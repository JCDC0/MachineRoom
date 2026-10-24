import { HARNESSES as CLIENT_HARNESSES } from '../../src/harnesses/index.js'
import { claudeServerHarness } from './claude.js'
import { opencodeServerHarness } from './opencode.js'

const SERVER_HALVES = [claudeServerHarness, opencodeServerHarness]
const SERVER_HALF_BY_KEY = new Map(SERVER_HALVES.map((harness) => [harness.key, harness]))

export const HARNESSES = CLIENT_HARNESSES.map((harness) => {
  const half = SERVER_HALF_BY_KEY.get(harness.key)
  return half ? { ...harness, ...half } : harness
})

export const SESSION_HARNESSES = HARNESSES.filter((harness) => typeof harness.createSessionsReader === 'function')
export const harnessByKey = Object.fromEntries(HARNESSES.map((harness) => [harness.key, harness]))
export const harnessByAdapter = Object.fromEntries(HARNESSES.map((harness) => [harness.adapterType, harness]))
