import { describe, expect, it } from 'bun:test'
import {
  attentionQueue,
  contextPressure,
  DEFAULT_CONTEXT_LIMIT,
  formatAgo,
  formatDuration,
  formatTelemetry,
  formatTokens,
  mostUrgent,
  nextAttentionTarget,
  rollupTelemetry,
  sessionActiveMs,
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
