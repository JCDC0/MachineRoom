import { createHermesSessionsReader } from '../hermes-sessions.js'

export const hermesServerHarness = {
  key: 'hermes',
  createSessionsReader: createHermesSessionsReader,
}
