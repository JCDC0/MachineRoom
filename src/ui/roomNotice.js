export function roomNoticeSummary(text) {
  if (typeof text !== 'string') return null
  const lines = text.split('\n')
  const end = /^Run .+ on lane (\S+) ended: ([^.\s]+)\.(?: \(started by removed sub .+\))?$/.exec(lines[0])
  if (!end) return null
  const record = /^lane (.+?) \| (briefs|project) (.*?) \| exit .*? \| branch .*? \| commits (.*?) \| cost .*$/.exec(lines[1] || '')
  const commit = record?.[4].split('; ')[0].match(/^[0-9a-f]{7,40}\s+(?:v?\d+(?:\.\d+)+(?:[-+][\w.-]+)?:\s*)?(.+)$/i)
  return {
    lane: end[1],
    briefs: record?.[2] === 'briefs' ? record[3] : null,
    status: end[2],
    subject: commit?.[1] || null,
  }
}
