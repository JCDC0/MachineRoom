export const RECORD_MINUTES_DEFAULT = 10
export const RECORD_MINUTES_MIN = 1
export const RECORD_MINUTES_MAX = 240

export function clampRecordMinutes(value) {
  if (value == null || value === '') return RECORD_MINUTES_DEFAULT
  const num = Number(value)
  if (!Number.isFinite(num)) return RECORD_MINUTES_DEFAULT
  return Math.min(RECORD_MINUTES_MAX, Math.max(RECORD_MINUTES_MIN, Math.floor(num)))
}
