export function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function argmax(probabilities) {
  let best = null
  for (const [option, value] of Object.entries(probabilities)) {
    if (best === null || value > best.value) best = { option, value }
  }
  return best
}

export function scoreAnswer(answer, expected) {
  if (!answer) return { predicted: null, correct: false, confidence: null }
  if (answer.type === 'noul') {
    const predicted = answer.noul >= 0.5
    return { predicted, correct: predicted === expected, confidence: Math.max(answer.noul, 1 - answer.noul) }
  }
  if (answer.type === 'choice') {
    const top = answer.probabilities ? argmax(answer.probabilities) : null
    const confidence = top ? top.value : answer.confidence
    return { predicted: answer.choice, correct: answer.choice === expected, confidence: confidence ?? null }
  }
  const predicted = Math.round(answer.score)
  return {
    predicted,
    correct: predicted === expected,
    near: Math.abs(predicted - expected) <= 1,
    confidence: answer.confidence ?? null,
  }
}

export function coverageAtError(records, maxError = 0.05) {
  const total = records.length
  if (total === 0) return 0
  const groups = new Map()
  for (const record of records) {
    if (record.confidence === null || record.confidence === undefined) continue
    const bucket = groups.get(record.confidence) ?? { right: 0, count: 0 }
    bucket.count += 1
    if (record.correct) bucket.right += 1
    groups.set(record.confidence, bucket)
  }
  let accepted = 0
  let errors = 0
  let best = 0
  for (const confidence of [...groups.keys()].sort((a, b) => b - a)) {
    const bucket = groups.get(confidence)
    accepted += bucket.count
    errors += bucket.count - bucket.right
    if (errors / accepted <= maxError) best = accepted
  }
  return best / total
}

export function calibrationError(records, bins = 10) {
  const usable = records.filter((record) => record.confidence !== null && record.confidence !== undefined)
  if (usable.length === 0) return null
  const buckets = Array.from({ length: bins }, () => ({ count: 0, right: 0, confidence: 0 }))
  for (const record of usable) {
    const index = Math.min(bins - 1, Math.floor(record.confidence * bins))
    const bucket = buckets[index]
    bucket.count += 1
    bucket.confidence += record.confidence
    if (record.correct) bucket.right += 1
  }
  let error = 0
  for (const bucket of buckets) {
    if (bucket.count === 0) continue
    error += (bucket.count / usable.length) * Math.abs(bucket.right / bucket.count - bucket.confidence / bucket.count)
  }
  return error
}

export function summarize(records) {
  const n = records.length
  const right = records.filter((record) => record.correct).length
  const near = records.filter((record) => record.correct || record.near).length
  return {
    n,
    accuracy: n ? right / n : null,
    within1: records.some((record) => record.near !== undefined) && n ? near / n : null,
    coverage5: coverageAtError(records, 0.05),
    ece: calibrationError(records),
  }
}

export function flipRate(first, second) {
  let common = 0
  let flips = 0
  for (const [key, value] of first) {
    if (!second.has(key)) continue
    common += 1
    if (second.get(key) !== value) flips += 1
  }
  return common ? flips / common : null
}

export function majorityAccuracy(labels) {
  if (labels.length === 0) return null
  const counts = new Map()
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1)
  return Math.max(...counts.values()) / labels.length
}
