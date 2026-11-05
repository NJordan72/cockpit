import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { QUIET_MS, queueRun, runWhenReady, takeRun, type ShellTerminal } from './run'

/** A terminal the test writes shell output to. */
function fakeTerminal(): ShellTerminal & { output: (bracketed: boolean) => void; sent: string[] } {
  const listeners = new Set<() => void>()
  const t = {
    modes: { bracketedPasteMode: false },
    sent: [] as string[],
    onWriteParsed: (cb: () => void) => {
      listeners.add(cb)
      return { dispose: () => listeners.delete(cb) }
    },
    paste: (data: string) => t.sent.push(`paste:${data}`),
    output: (bracketed: boolean) => {
      t.modes.bracketedPasteMode = bracketed
      for (const cb of [...listeners]) cb()
    }
  }
  return t
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('runWhenReady', () => {
  it('pastes and presses Enter once the shell turns on bracketed paste', () => {
    const t = fakeTerminal()
    runWhenReady(t, 'bun test', () => t.sent.push('enter'))
    t.output(false)
    vi.advanceTimersByTime(QUIET_MS - 1)
    expect(t.sent).toEqual([])
    t.output(true)
    t.output(true)
    vi.advanceTimersByTime(QUIET_MS * 2)
    expect(t.sent).toEqual(['paste:bun test', 'enter'])
  })

  it('falls back to output going quiet, but not before anything was printed', () => {
    const t = fakeTerminal()
    runWhenReady(t, 'ls', () => t.sent.push('enter'))
    vi.advanceTimersByTime(QUIET_MS * 5)
    expect(t.sent).toEqual([])
    t.output(false)
    vi.advanceTimersByTime(QUIET_MS - 1)
    t.output(false)
    vi.advanceTimersByTime(QUIET_MS - 1)
    expect(t.sent).toEqual([])
    vi.advanceTimersByTime(1)
    expect(t.sent).toEqual(['paste:ls', 'enter'])
  })

  it('does nothing once disposed', () => {
    const t = fakeTerminal()
    const run = runWhenReady(t, 'ls', () => t.sent.push('enter'))
    t.output(false)
    run.dispose()
    t.output(true)
    vi.advanceTimersByTime(QUIET_MS * 2)
    expect(t.sent).toEqual([])
  })
})

describe('queued runs', () => {
  it('are taken once', () => {
    queueRun('p1', { text: 'ls', strictCwd: true })
    expect(takeRun('p2')).toBeUndefined()
    expect(takeRun('p1')).toEqual({ text: 'ls', strictCwd: true })
    expect(takeRun('p1')).toBeUndefined()
  })
})
