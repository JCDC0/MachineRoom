import { createClaudeSessionsReader } from '../claude-sessions.js'

export const claudeServerHarness = {
  key: 'claude',
  createSessionsReader: createClaudeSessionsReader,
}
