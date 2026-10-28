import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { win32 } from 'node:path'
import { programPath } from './programPath.js'

export const DEFAULT_ASSISTANT_MODEL = 'opencode/deepseek-v4.1-flash-free'
export const PROMPT_LIMIT = 2000
export const ASSISTANT_TIMEOUT_MS = 8000
export const OWNER_ASSISTANT_PROBLEM = 'Only the owner can run the assistant.'
export const CONFIRM_ASSISTANT_PROBLEM = 'The owner must confirm the assistant run first.'

const OFF = new Set(['', 'none', 'off', 'false', 'no'])

function ownerRequest(req) {
  return Boolean(req.headers?.origin)
}

export function resolveAssistantModel({ env = {}, settings = {} } = {}) {
  const raw = env.ASSISTANT_MODEL !== undefined ? env.ASSISTANT_MODEL : settings.assistantModel !== undefined ? settings.assistantModel : DEFAULT_ASSISTANT_MODEL
  if (raw === null || raw === undefined) return null
  const value = String(raw).trim()
  return OFF.has(value.toLowerCase()) ? null : value
}

export function readSettings(path) {
  if (!path) return {}
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function extractReplyText(output) {
  const text = String(output ?? '').trim()
  if (!text) return ''
  try {
    const json = JSON.parse(text)
    if (typeof json === 'string') return json
    if (json && typeof json === 'object') {
      for (const key of ['text', 'result', 'message', 'content', 'output', 'reply', 'answer']) {
        if (typeof json[key] === 'string') return json[key]
      }
      if (json.message && typeof json.message === 'object' && typeof json.message.text === 'string') return json.message.text
      if (json.part && typeof json.part === 'object' && typeof json.part.text === 'string') return json.part.text
      if (Array.isArray(json.parts)) {
        const joined = json.parts
          .map((part) => (typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : ''))
          .join('')
        if (joined) return joined
      }
    }
  } catch {
    const parts = []
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('{')) continue
      try {
        const item = JSON.parse(trimmed)
        if (typeof item?.part?.text === 'string') parts.push(item.part.text)
        else if (typeof item?.text === 'string') parts.push(item.text)
      } catch {}
    }
    if (parts.length > 0) return parts.join('')
    return text
  }
  return text
}

export function resolveOpencodeBinary({ env = process.env, platform = process.platform, exists = existsSync, check } = {}) {
  if (env.OPENCODE_BIN) return env.OPENCODE_BIN
  if (platform === 'win32') {
    const folders = String(env.PATH ?? env.Path ?? '').split(win32.delimiter)
    for (const folder of folders) {
      if (!folder) continue
      const candidate = win32.join(folder, 'node_modules', '@opencode', 'cli', 'bin', 'opencode.exe')
      if (exists(candidate)) return candidate
    }
  }
  return programPath('opencode', { platform, env, check })
}

export function runOpencode({ model, prompt, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const binary = resolveOpencodeBinary()
    if (!binary) {
      reject(new Error('the assistant run failed'))
      return
    }
    execFile(
      binary,
      ['run', '-m', model, '--format', 'json', prompt],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error) {
          reject(new Error('the assistant run failed'))
          return
        }
        resolve(extractReplyText(stdout))
      }
    )
  })
}

export function createAssistantApi(options) {
  const { sendJson, readJsonBody, runner = runOpencode, model, settingsFile, env = process.env } = options

  async function handle(req, res, url) {
    if (url.pathname !== '/api/assistant') return false
    if (req.method !== 'POST') {
      sendJson(req, res, 405, { error: 'Use POST for the assistant.' })
      return true
    }
    if (!ownerRequest(req)) {
      sendJson(req, res, 403, { error: OWNER_ASSISTANT_PROBLEM })
      return true
    }
    const body = await readJsonBody(req, res)
    if (body === null) return true
    if (body.confirmed !== true) {
      sendJson(req, res, 400, { error: CONFIRM_ASSISTANT_PROBLEM })
      return true
    }
    const prompt = body?.prompt
    if (typeof prompt !== 'string' || !prompt.trim()) {
      sendJson(req, res, 400, { error: 'Write a prompt first.' })
      return true
    }
    if (prompt.trimStart().startsWith('-')) {
      sendJson(req, res, 400, { error: 'The prompt cannot start with a dash.' })
      return true
    }
    if (prompt.length > PROMPT_LIMIT) {
      sendJson(req, res, 400, { error: `Keep the prompt under ${PROMPT_LIMIT} characters.` })
      return true
    }
    const resolved = model !== undefined ? model : resolveAssistantModel({ env, settings: readSettings(settingsFile) })
    if (!resolved) {
      sendJson(req, res, 404, {
        error: 'No assistant model is set. Put ASSISTANT_MODEL in the environment or the assistant model in the settings file.',
      })
      return true
    }
    try {
      const text = await runner({ model: resolved, prompt, timeoutMs: ASSISTANT_TIMEOUT_MS })
      sendJson(req, res, 200, { text: String(text ?? '') })
    } catch {
      sendJson(req, res, 502, { error: 'The helper model is not reachable.' })
    }
    return true
  }

  return { handle }
}
