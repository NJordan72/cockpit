import { describe, expect, it } from 'bun:test'
import {
  attentionQueue,
  formatAgo,
  formatTokens,
  mostUrgent,
  nextAttentionTarget,
  type AttentionItem
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

describe('attentionQueue', () => {
  const item = (id: string, status: AttentionItem['status'], since: number): AttentionItem => ({
    id,
    status,
    since
  })

  it('orders needs-input oldest-first, then done oldest-first, ignoring other statuses', () => {
    const sessions: AttentionItem[] = [
      item('p-idle', 'idle', 1),
      item('p-done-new', 'done', 300),
      item('p-work', 'working', 2),
      item('p-wait-new', 'needs-input', 200),
      item('p-exit', 'exited', 3),
      item('p-done-old', 'done', 100),
      item('p-wait-old', 'needs-input', 50)
    ]
    expect(attentionQueue(sessions).map((s) => s.id)).toEqual([
      'p-wait-old',
      'p-wait-new',
      'p-done-old',
      'p-done-new'
    ])
  })

  it('breaks equal timestamps stably by pane id', () => {
    const sessions: AttentionItem[] = [
      item('p-b', 'needs-input', 100),
      item('p-a', 'needs-input', 100),
      item('p-d', 'done', 100),
      item('p-c', 'done', 100)
    ]
    expect(attentionQueue(sessions).map((s) => s.id)).toEqual(['p-a', 'p-b', 'p-c', 'p-d'])
  })

  it('returns an empty list when nothing needs attention', () => {
    expect(attentionQueue([item('p1', 'idle', 1), item('p2', 'working', 2)])).toEqual([])
  })
})

describe('nextAttentionTarget', () => {
  const item = (id: string, status: AttentionItem['status'], since: number): AttentionItem => ({
    id,
    status,
    since
  })

  it('returns null when no pane needs input or is done', () => {
    expect(nextAttentionTarget([item('p1', 'working', 1)], 'p1')).toBeNull()
    expect(nextAttentionTarget([], null)).toBeNull()
  })

  it('picks the oldest needs-input pane first, or oldest done if none wait', () => {
    const withWaiting = [
      item('p-done', 'done', 10),
      item('p-wait-2', 'needs-input', 30),
      item('p-wait-1', 'needs-input', 20)
    ]
    expect(nextAttentionTarget(withWaiting, 'p-other')?.id).toBe('p-wait-1')
    expect(nextAttentionTarget(withWaiting, null)?.id).toBe('p-wait-1')

    const onlyDone = [item('p-done-2', 'done', 50), item('p-done-1', 'done', 10)]
    expect(nextAttentionTarget(onlyDone, 'p-other')?.id).toBe('p-done-1')
  })

  it('cycles through waiting and done panes and wraps around', () => {
    const sessions = [
      item('p-wait-1', 'needs-input', 10),
      item('p-wait-2', 'needs-input', 20),
      item('p-done-1', 'done', 30)
    ]
    expect(nextAttentionTarget(sessions, 'p-wait-1')?.id).toBe('p-wait-2')
    expect(nextAttentionTarget(sessions, 'p-wait-2')?.id).toBe('p-done-1')
    expect(nextAttentionTarget(sessions, 'p-done-1')?.id).toBe('p-wait-1')
  })

  it('returns the sole attention pane when it is already focused', () => {
    const sessions = [item('p-wait-1', 'needs-input', 10), item('p-idle', 'idle', 5)]
    expect(nextAttentionTarget(sessions, 'p-wait-1')?.id).toBe('p-wait-1')
  })
})
