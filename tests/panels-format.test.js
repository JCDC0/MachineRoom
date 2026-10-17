import { describe, expect, it } from 'vitest'
import {
  formatCents,
  percentOf,
  meterTone,
  timeUntil,
  timeAgo,
  statusLabel,
  approvalTypeLabel,
} from '../src/ui/panels/format.js'

describe('format helpers for panels', () => {
  it('formats cents as dollars and cents', () => {
    expect(formatCents(8)).toBe('$0.08')
    expect(formatCents(291)).toBe('$2.91')
    expect(formatCents(1000)).toBe('$10.00')
    expect(formatCents(0)).toBe('$0.00')
    expect(formatCents(null)).toBe('$0.00')
    expect(formatCents(undefined)).toBe('$0.00')
    expect(formatCents(-8)).toBe('-$0.08')
    expect(formatCents('500')).toBe('$5.00')
  })

  it('clamps percentOf between 0 and 100 and returns 0 for zero total', () => {
    expect(percentOf(0, 100)).toBe(0)
    expect(percentOf(50, 100)).toBe(50)
    expect(percentOf(291, 300)).toBe(97)
    expect(percentOf(500, 100)).toBe(100)
    expect(percentOf(-10, 100)).toBe(0)
    expect(percentOf(50, 0)).toBe(0)
    expect(percentOf(50, -10)).toBe(0)
    expect(percentOf(null, 100)).toBe(0)
    expect(percentOf(50, null)).toBe(0)
    expect(percentOf(0, 0)).toBe(0)
  })

  it('reports meter tone based on 90 percent threshold', () => {
    expect(meterTone(0)).toBe('normal')
    expect(meterTone(89)).toBe('normal')
    expect(meterTone(89.9)).toBe('normal')
    expect(meterTone(90)).toBe('full')
    expect(meterTone(99)).toBe('full')
    expect(meterTone(100)).toBe('full')
  })

  it('formats time until future date', () => {
    const now = Date.parse('2026-10-18T12:00:00Z')
    expect(timeUntil('2026-10-18T11:59:00Z', now)).toBe('now')
    expect(timeUntil('2026-10-18T12:00:00Z', now)).toBe('now')
    expect(timeUntil('2026-10-18T12:12:00Z', now)).toBe('12m')
    expect(timeUntil('2026-10-18T16:12:00Z', now)).toBe('4h 12m')
    expect(timeUntil('2026-10-18T16:00:00Z', now)).toBe('4h')
    expect(timeUntil('2026-10-21T14:00:00Z', now)).toBe('3d 2h')
    expect(timeUntil('2026-10-21T12:00:00Z', now)).toBe('3d')
    expect(timeUntil('', now)).toBe('now')
    expect(timeUntil(null, now)).toBe('now')
  })

  it('formats time ago from past date', () => {
    const now = Date.parse('2026-10-18T12:00:00Z')
    expect(timeAgo('2026-10-18T12:00:00Z', now)).toBe('just now')
    expect(timeAgo('2026-10-18T11:59:30Z', now)).toBe('just now')
    expect(timeAgo('2026-10-18T11:51:00Z', now)).toBe('9 min ago')
    expect(timeAgo('2026-10-18T09:00:00Z', now)).toBe('3 h ago')
    expect(timeAgo('2026-10-16T12:00:00Z', now)).toBe('2 d ago')
    expect(timeAgo('2026-10-18T12:05:00Z', now)).toBe('just now')
    expect(timeAgo('', now)).toBe('just now')
    expect(timeAgo(null, now)).toBe('just now')
  })

  it('maps issue and agent statuses to plain words', () => {
    expect(statusLabel('in_progress')).toBe('in progress')
    expect(statusLabel('in_review')).toBe('in review')
    expect(statusLabel('blocked')).toBe('blocked')
    expect(statusLabel('todo')).toBe('to do')
    expect(statusLabel('backlog')).toBe('backlog')
    expect(statusLabel('done')).toBe('done')
    expect(statusLabel('cancelled')).toBe('cancelled')
    expect(statusLabel('pending')).toBe('pending')
    expect(statusLabel('approved')).toBe('approved')
    expect(statusLabel('rejected')).toBe('rejected')
    expect(statusLabel('revision_requested')).toBe('revision requested')
    expect(statusLabel('idle')).toBe('idle')
    expect(statusLabel('running')).toBe('running')
    expect(statusLabel('paused')).toBe('paused')
    expect(statusLabel('error')).toBe('failed')
    expect(statusLabel('pending_approval')).toBe('pending approval')
    expect(statusLabel('custom_unknown_status')).toBe('custom unknown status')
    expect(statusLabel('')).toBe('')
    expect(statusLabel(null)).toBe('')
  })

  it('maps approval types to plain words', () => {
    expect(approvalTypeLabel('hire_agent')).toBe('Hire request')
    expect(approvalTypeLabel('budget_override_required')).toBe('Budget override')
    expect(approvalTypeLabel('approve_ceo_strategy')).toBe('Plan approval')
    expect(approvalTypeLabel('request_board_approval')).toBe('Board approval')
    expect(approvalTypeLabel('custom_type')).toBe('custom type')
    expect(approvalTypeLabel('')).toBe('')
    expect(approvalTypeLabel(null)).toBe('')
  })
})
