import { createOpencodeSessionsReader } from '../opencode-sessions.js'

export const opencodeServerHarness = {
  key: 'opencode',
  createSessionsReader: createOpencodeSessionsReader,
}
