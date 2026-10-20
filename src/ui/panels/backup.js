const WARNING_WORDS = {
  database_backup_stale: "Older than Paperclip's limit.",
  database_backup_missing: 'Paperclip found no backup file.',
  database_backup_last_failure: 'The last backup failed.',
  database_backup_check_failed: 'Paperclip could not check its backups.',
}

const RED_WARNINGS = new Set([
  'database_backup_stale',
  'database_backup_missing',
  'database_backup_last_failure',
])

const YELLOW_WARNINGS = new Set(['database_backup_check_failed'])

function mapWarningLine(warning) {
  if (typeof warning === 'string') {
    return WARNING_WORDS[warning] ?? warning
  }
  if (warning && typeof warning === 'object') {
    const code = warning.code || warning.message
    if (code) return WARNING_WORDS[code] ?? String(code)
  }
  return String(warning)
}

export function formatBytes(n) {
  if (n == null || !Number.isFinite(n) || n < 0) {
    return 'size unknown'
  }
  const kB = Math.round(n / 1024)
  if (kB < 1024) {
    return `${kB} kB`
  }
  const mB = (n / (1024 * 1024)).toFixed(1)
  return `${mB} MB`
}

export function backupNotice(status, { now = Date.now() } = {}) {
  if (!status || typeof status !== 'object' || Array.isArray(status)) {
    return null
  }

  if (status.enabled === false) {
    return {
      tone: 'yellow',
      title: 'Automatic backups are off',
      lines: ["Turn them on in Paperclip's instance settings."],
    }
  }

  if (typeof status.enabled !== 'boolean') {
    return null
  }

  const rawWarnings = Array.isArray(status.warnings) ? status.warnings : []
  const lines = rawWarnings.map(mapWarningLine)

  if (!status.latestAt) {
    return {
      tone: 'red',
      title: 'No backup yet',
      lines,
    }
  }

  let age = null
  if (Number.isFinite(status.ageHours)) {
    age = status.ageHours
  } else if (typeof status.latestAt === 'string') {
    const parsed = Date.parse(status.latestAt)
    if (!Number.isNaN(parsed)) {
      age = Math.max(0, (now - parsed) / 3600000)
    }
  }

  if (age == null || !Number.isFinite(age)) {
    return null
  }

  let title = ''
  if (age < 1) {
    title = 'Newest backup less than an hour ago'
  } else if (age >= 48) {
    const days = Math.floor(age / 24)
    title = `Newest backup ${days} days ago`
  } else {
    const hours = Math.floor(age)
    if (hours === 1) {
      title = 'Newest backup 1 hour ago'
    } else {
      title = `Newest backup ${hours} hours ago`
    }
  }

  let tone = 'ok'
  const hasRed = rawWarnings.some((w) => {
    const code = typeof w === 'string' ? w : w?.code
    return RED_WARNINGS.has(code)
  })
  const hasYellow = rawWarnings.some((w) => {
    const code = typeof w === 'string' ? w : w?.code
    return YELLOW_WARNINGS.has(code)
  })

  if (hasRed) {
    tone = 'red'
  } else if (hasYellow) {
    tone = 'yellow'
  } else if (rawWarnings.length > 0) {
    tone = 'yellow'
  } else {
    tone = 'ok'
  }

  return {
    tone,
    title,
    lines,
  }
}

export default backupNotice
