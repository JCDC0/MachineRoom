import { createServer } from 'node:http'

export function startFakeDecisions(answer) {
  const seen = []
  const server = createServer((request, response) => {
    let text = ''
    request.on('data', (chunk) => {
      text += chunk
    })
    request.on('end', () => {
      let body = {}
      try {
        body = JSON.parse(text || '{}')
      } catch {
        body = {}
      }
      seen.push({ method: request.method, url: request.url, authorization: request.headers.authorization, body })
      const reply = answer(body, seen.length)
      const status = reply.status ?? 200
      response.writeHead(status, { 'Content-Type': 'application/json', ...(reply.headers ?? {}) })
      response.end(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({
        url: `http://127.0.0.1:${port}/api/alpha/decisions`,
        seen,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

export function oracle(request, truth, { wrongFor = () => false } = {}) {
  const text = String(request.state).split('\n').slice(1).join('\n')
  const expected = truth.get(text) ?? {}
  const answers = {}
  for (const [name, question] of Object.entries(request.questions)) {
    const wrong = wrongFor(name)
    if (question.type === 'choice') {
      const options = Object.keys(question.criteria)
      let value = expected[name] ?? 'none'
      if (!options.includes(value)) value = options.includes('none') ? 'none' : options[0]
      if (wrong) value = options.find((option) => option !== value) ?? value
      const probabilities = {}
      for (const option of options) probabilities[option] = option === value ? 0.9 : 0.1 / Math.max(1, options.length - 1)
      answers[name] = { type: 'choice', choice: value, confidence: 0.9, probabilities }
    } else if (question.type === 'noul') {
      const value = expected[name] === true
      answers[name] = { type: 'noul', noul: value !== wrong ? 0.9 : 0.1 }
    } else {
      const level = Number.isInteger(expected[name]) ? expected[name] : 0
      answers[name] = { type: 'score', score: wrong ? (level + 2) % question.criteria.length : level, confidence: 0.8 }
    }
  }
  return {
    body: { id: 'fake', model: request.model, answers, usage: { input_tokens: 600, output_tokens: 40, cost: 0.00003 } },
  }
}

export function truthOf(probes) {
  return new Map(probes.map((probe) => [probe.text, probe.expected]))
}
