import { agyHarness } from './agy.js'
import { claudeHarness } from './claude.js'
import { hermesHarness } from './hermes.js'
import { opencodeHarness } from './opencode.js'

export const HARNESSES = [claudeHarness, hermesHarness, opencodeHarness, agyHarness]
export const AGENT_ORDER = HARNESSES.map((harness) => harness.key)
export const OWNER_ORDER = ['hermes', 'opencode', 'agy', 'claude']
export const harnessByKey = Object.fromEntries(HARNESSES.map((harness) => [harness.key, harness]))
export const harnessByAdapter = Object.fromEntries(HARNESSES.map((harness) => [harness.adapterType, harness]))
