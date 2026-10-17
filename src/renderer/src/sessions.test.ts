import { describe, expect, it } from 'vitest'
import { formatTokens, mostUrgent } from './sessions'

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
