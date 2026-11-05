import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { BATCH_MS, HIGH_WATER, LOW_WATER, PtyOutput } from './ptyOutput'

let sent: string[]
let calls: string[]
let out: PtyOutput

beforeEach(() => {
  vi.useFakeTimers()
  sent = []
  calls = []
  out = new PtyOutput({
    send: (d) => sent.push(d),
    pause: () => calls.push('pause'),
    resume: () => calls.push('resume')
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PtyOutput', () => {
  it('joins chunks that arrive close together into one message', () => {
    out.push('a')
    out.push('b')
    expect(sent).toEqual([])
    vi.advanceTimersByTime(BATCH_MS)
    expect(sent).toEqual(['ab'])
    out.push('c')
    vi.advanceTimersByTime(BATCH_MS)
    expect(sent).toEqual(['ab', 'c'])
  })

  it('sends what it holds on flush, and nothing after dispose', () => {
    out.push('last')
    out.flush()
    expect(sent).toEqual(['last'])
    out.push('dropped')
    out.dispose()
    vi.advanceTimersByTime(BATCH_MS)
    expect(sent).toEqual(['last'])
  })

  it('sends a flood at once and pauses until the terminal catches up', () => {
    out.push('x'.repeat(HIGH_WATER + 1))
    expect(sent).toHaveLength(1)
    expect(calls).toEqual(['pause'])
    out.ack(HIGH_WATER + 1 - LOW_WATER)
    expect(calls).toEqual(['pause'])
    out.ack(1)
    expect(calls).toEqual(['pause', 'resume'])
  })

  it('pauses once however much more is sent', () => {
    for (let i = 0; i < 3; i++) out.push('x'.repeat(HIGH_WATER))
    expect(calls).toEqual(['pause'])
  })

  it('never goes below nothing unacknowledged', () => {
    out.ack(1_000_000)
    out.push('x'.repeat(HIGH_WATER))
    vi.advanceTimersByTime(BATCH_MS)
    expect(calls).toEqual([])
    out.push('x')
    vi.advanceTimersByTime(BATCH_MS)
    expect(calls).toEqual(['pause'])
  })
})
