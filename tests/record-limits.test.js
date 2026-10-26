import { describe, expect, it } from 'vitest'
import {
  RECORD_MINUTES_DEFAULT,
  RECORD_MINUTES_MAX,
  RECORD_MINUTES_MIN,
  clampRecordMinutes,
} from '../src/model/recordLimits.js'

describe('record limits', () => {
  it('keeps the replay window between 1 and 240 minutes, 10 by default', () => {
    expect(RECORD_MINUTES_DEFAULT).toBe(10)
    expect(RECORD_MINUTES_MIN).toBe(1)
    expect(RECORD_MINUTES_MAX).toBe(240)
  })

  it('clamps a record time and gives the default for a non number', () => {
    expect(clampRecordMinutes()).toBe(10)
    expect(clampRecordMinutes(null)).toBe(10)
    expect(clampRecordMinutes('')).toBe(10)
    expect(clampRecordMinutes('ten')).toBe(10)
    expect(clampRecordMinutes(Number.NaN)).toBe(10)
    expect(clampRecordMinutes(Number.POSITIVE_INFINITY)).toBe(10)
    expect(clampRecordMinutes(0)).toBe(1)
    expect(clampRecordMinutes(-5)).toBe(1)
    expect(clampRecordMinutes(1)).toBe(1)
    expect(clampRecordMinutes(45.9)).toBe(45)
    expect(clampRecordMinutes('45')).toBe(45)
    expect(clampRecordMinutes(240)).toBe(240)
    expect(clampRecordMinutes(241)).toBe(240)
  })
})
