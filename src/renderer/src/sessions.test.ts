import { describe, expect, it } from 'vitest'
import { formatAgo, formatTokens, mostUrgent } from './sessions'

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
