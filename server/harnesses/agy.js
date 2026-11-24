import { createAgySessionsReader } from '../agy-sessions.js'

export const agyServerHarness = {
  key: 'agy',
  createSessionsReader: createAgySessionsReader,
}
