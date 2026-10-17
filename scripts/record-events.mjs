import { appendFileSync, writeFileSync } from 'node:fs'

const [companyId, outFile, seconds = '600'] = process.argv.slice(2)
const url = `ws://127.0.0.1:3100/api/companies/${companyId}/events/ws`
writeFileSync(outFile, '')

const started = Date.now()
const socket = new WebSocket(url)
let count = 0

function line(kind, data) {
  appendFileSync(outFile, JSON.stringify({ t: Date.now() - started, kind, data }) + '\n')
}

socket.addEventListener('open', () => line('open', url))
socket.addEventListener('message', (event) => {
  count += 1
  line('frame', typeof event.data === 'string' ? event.data : '[binary]')
})
socket.addEventListener('error', (event) => line('error', String(event.message ?? 'socket error')))
socket.addEventListener('close', (event) => {
  line('close', { code: event.code, reason: event.reason, frames: count })
  process.exit(0)
})

setTimeout(() => {
  line('timeout', { frames: count })
  socket.close()
}, Number(seconds) * 1000)
