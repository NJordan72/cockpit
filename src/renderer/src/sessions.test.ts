import { describe, expect, it } from 'bun:test'
import {
  contextPressure,
  DEFAULT_CONTEXT_LIMIT,
  formatAgo,
  formatDuration,
  formatTelemetry,
  formatTokens,
  mostUrgent,
  rollupTelemetry,
  sessionActiveMs
} from './sessions'

describe('mostUrgent', () => {
  it('puts a pane waiting on the user first', () => {
    expect(mostUrgent(['idle', 'working', 'needs-input', 'done'])).toBe('needs-input')
    expect(mostUrgent(['working', 'done', 'idle'])).toBe('done')
    expect(mostUrgent(['idle', 'working'])).toBe('working')
    expect(mostUrgent(['exited', 'idle'])).toBe('idle')
    expect(mostUrgent([])).toBeNull()
  })
})

describe('formatTokens', () => {
  it('shortens large counts', () => {
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(48_213)).toBe('48k')
    expect(formatTokens(1_250_000)).toBe('1.3M')
  })
})

describe('formatAgo', () => {
  it('rounds down to the largest unit', () => {
    const now = Date.UTC(2026, 9, 17)
    const ago = (minutes: number): string => formatAgo(now - minutes * 60_000, now)
    expect(ago(0.5)).toBe('now')
    expect(ago(-5)).toBe('now')
    expect(ago(5)).toBe('5m')
    expect(ago(59)).toBe('59m')
    expect(ago(60 * 3.9)).toBe('3h')
    expect(ago(60 * 24 * 2)).toBe('2d')
    expect(ago(60 * 24 * 20)).toBe('2w')
    expect(ago(60 * 24 * 100)).toBe('3mo')
    expect(ago(60 * 24 * 800)).toBe('2y')
  })
})

describe('contextPressure', () => {
  it('returns null when tokens are unknown or limit is invalid', () => {
    expect(contextPressure(null)).toBeNull()
    expect(contextPressure(10_000, 0)).toBeNull()
  })

  it('classifies normal, warn (>=70%), and high (>=85%) thresholds', () => {
    expect(contextPressure(100_000)).toEqual({
      tokens: 100_000,
      limit: DEFAULT_CONTEXT_LIMIT,
      percent: 50,
      barPercent: 50,
      tone: 'normal'
    })
    expect(contextPressure(138_000)?.tone).toBe('normal')
    expect(contextPressure(140_000)).toMatchObject({ percent: 70, barPercent: 70, tone: 'warn' })
    expect(contextPressure(168_000)?.tone).toBe('warn')
    expect(contextPressure(170_000)).toMatchObject({ percent: 85, barPercent: 85, tone: 'high' })
    expect(contextPressure(240_000)).toMatchObject({ percent: 120, barPercent: 100, tone: 'high' })
  })
})

describe('telemetry formatting and rollups', () => {
  it('formats durations concisely', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(500)).toBe('1s')
    expect(formatDuration(42_000)).toBe('42s')
    expect(formatDuration(60_000)).toBe('1m')
    expect(formatDuration(5 * 60_000 + 20_000)).toBe('5m')
    expect(formatDuration(60 * 60_000)).toBe('1h')
    expect(formatDuration(72 * 60_000)).toBe('1h 12m')
  })

  it('includes in-progress working stretches in sessionActiveMs', () => {
    expect(sessionActiveMs({ status: 'idle', since: 1000, activeMs: 5000 }, 9000)).toBe(5000)
    expect(sessionActiveMs({ status: 'working', since: 1000, activeMs: 5000 }, 9000)).toBe(13_000)
  })

  it('rolls up active time, tool calls, and tokens across sessions', () => {
    const rollup = rollupTelemetry(
      [
        { status: 'working', since: 10_000, activeMs: 20_000, toolCalls: 3, tokens: 40_000 },
        { status: 'idle', since: 15_000, activeMs: 40_000, toolCalls: 5, tokens: null },
        { status: 'done', since: 20_000, activeMs: 0, toolCalls: 2, tokens: 25_000 }
      ],
      30_000
    )
    expect(rollup).toEqual({ activeMs: 80_000, toolCalls: 10, tokens: 65_000 })
    expect(formatTelemetry(rollup)).toBe('1m · 10 tools · 65k tok')
    expect(formatTelemetry({ activeMs: 0, toolCalls: 0, tokens: null })).toBeNull()
    expect(formatTelemetry({ activeMs: 0, toolCalls: 1, tokens: 0 })).toBe('1 tool')
  })
})
