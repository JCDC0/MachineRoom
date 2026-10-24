import { request } from 'node:http'

const DEFAULT_TIMEOUT_MS = 20000

export function requestJson(url, { method = 'GET', headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolveRequest, rejectRequest) => {
    const target = new URL(url)
    const payload = body === undefined ? null : Buffer.from(String(body))
    const asked = request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method,
        agent: false,
        headers: {
          ...headers,
          ...(payload ? { 'content-length': String(payload.length) } : {}),
        },
      },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.once('error', rejectRequest)
        response.once('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          resolveRequest({
            status: response.statusCode,
            headers: response.headers,
            text,
            json: () => JSON.parse(text),
          })
        })
      }
    )
    asked.setTimeout(timeoutMs, () => {
      asked.destroy(new Error(`No answer from ${method} ${target.pathname} in ${timeoutMs} ms.`))
    })
    asked.once('error', rejectRequest)
    if (payload) asked.write(payload)
    asked.end()
  })
}
