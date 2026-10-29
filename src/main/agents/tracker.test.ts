import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentReport, AgentSignal } from './events'
import { DEFAULT_TIMINGS, StatusTracker, type PaneStatus } from './tracker'

const report = (signal: AgentSignal, title: string | null = null): AgentReport => ({
  signal,
  transcriptPath: null,
  title
})

let changes: [string, string | null, string][]
let tracker: StatusTracker

const status = (id = 'p1'): string | undefined => tracker.get(id)?.status
const state = (id = 'p1'): PaneStatus => {
  const s = tracker.get(id)
  if (!s) throw new Error(`no pane ${id}`)
  return s
}

/** Output every 100 ms for `ms`, like a spinner or a busy build. */
function stream(ms: number, id = 'p1'): void {
  for (let t = 0; t < ms; t += 100) {
    tracker.output(id)
    vi.advanceTimersByTime(100)
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
  changes = []
  tracker = new StatusTracker((id, prev, next) => {
    changes.push([id, prev?.status ?? null, next.status])
  })
})

afterEach(() => {
  tracker.close()
  vi.useRealTimers()
})

describe('without hooks (output heuristic)', () => {
  beforeEach(() => {
    tracker.spawn('p1', 't1', null)
  })

  it('is working while output keeps coming and idle once it stops', () => {
    stream(500)
    expect(status()).toBe('idle')
    stream(800)
    expect(status()).toBe('working')
    // The last output came 100 ms before stream() returned.
    vi.advanceTimersByTime(DEFAULT_TIMINGS.quietMs - 200)
    expect(status()).toBe('working')
    vi.advanceTimersByTime(200)
    expect(status()).toBe('idle')
  })

  it('ignores a single burst, like a prompt redrawing', () => {
    tracker.output('p1')
    vi.advanceTimersByTime(900)
    tracker.output('p1')
    vi.advanceTimersByTime(50)
    tracker.output('p1')
    expect(status()).toBe('idle')
  })

  it("doesn't count typing echo or redraws after a resize", () => {
    for (let i = 0; i < 30; i++) {
      tracker.input('p1', 'a')
      vi.advanceTimersByTime(50)
      tracker.output('p1')
      vi.advanceTimersByTime(50)
    }
    expect(status()).toBe('idle')
    tracker.resized('p1')
    tracker.output('p1')
    expect(status()).toBe('idle')
  })

  it('is exited once the process ends, and ignores output after that', () => {
    tracker.exit('p1')
    expect(status()).toBe('exited')
    stream(2000)
    expect(status()).toBe('exited')
  })
})

describe('with hooks', () => {
  beforeEach(() => {
    tracker.spawn('p1', 't1', 'claude')
  })

  it('follows a turn that asks for permission', () => {
    expect(tracker.report('t1', report({ kind: 'idle' }))).toBe(true)
    tracker.report('t1', report({ kind: 'working', clears: true }))
    expect(status()).toBe('working')
    tracker.report('t1', report({ kind: 'waiting', key: 'Bash:1', message: 'May I?' }))
    expect(state()).toMatchObject({ status: 'needs-input', message: 'May I?' })
    tracker.report('t1', report({ kind: 'working', resolves: 'Bash:1' }))
    expect(state()).toMatchObject({ status: 'working', message: null })
    tracker.report('t1', report({ kind: 'done', message: 'All set' }))
    expect(state()).toMatchObject({ status: 'done', doneMessage: 'All set' })
    expect(changes.map((c) => c[2])).toEqual(['idle', 'working', 'needs-input', 'working', 'done'])
  })

  it('keeps needs-input while another tool finishes during the dialog', () => {
    tracker.report('t1', report({ kind: 'waiting', key: 'Bash:1', message: 'May I?' }))
    tracker.report('t1', report({ kind: 'working', resolves: 'Read:9' }))
    tracker.report('t1', report({ kind: 'working' }))
    expect(status()).toBe('needs-input')
    tracker.report('t1', report({ kind: 'working', resolves: 'Bash:1' }))
    expect(status()).toBe('working')
  })

  it('settles a dialog when its call finishes with different input', () => {
    // Plan approval, answered with keys that don't read as an answer.
    const plan = { id: 'toolu_1', scope: 'ExitPlanMode@main' }
    tracker.report('t1', report({ kind: 'working', starts: plan }))
    tracker.report(
      't1',
      report({ kind: 'waiting', key: 'ExitPlanMode:1', scope: plan.scope, message: 'Approve?' })
    )
    tracker.report(
      't1',
      report({ kind: 'waiting', key: null, message: 'Claude needs you', reminder: true })
    )
    tracker.input('p1', '\x1b[B')
    tracker.report('t1', report({ kind: 'working', resolves: 'ExitPlanMode:2', ends: plan }))
    expect(status()).toBe('working')
    tracker.report('t1', report({ kind: 'working', starts: { id: 'toolu_2', scope: 'Bash@main' } }))
    expect(status()).toBe('working')
  })

  it('keeps needs-input while another call to the same tool finishes', () => {
    const asking = { id: 'toolu_1', scope: 'WebFetch@main' }
    const other = { id: 'toolu_2', scope: 'WebFetch@main' }
    const subagent = { id: 'toolu_3', scope: 'WebFetch@a1' }
    for (const call of [asking, other, subagent]) {
      tracker.report('t1', report({ kind: 'working', starts: call }))
    }
    tracker.report(
      't1',
      report({ kind: 'waiting', key: 'WebFetch:1', scope: asking.scope, message: 'Fetch?' })
    )
    tracker.report('t1', report({ kind: 'working', resolves: 'WebFetch:2', ends: other }))
    tracker.report('t1', report({ kind: 'working', resolves: 'WebFetch:3', ends: subagent }))
    expect(status()).toBe('needs-input')
    tracker.report('t1', report({ kind: 'working', resolves: 'WebFetch:4', ends: asking }))
    expect(status()).toBe('working')
  })

  it('forgets a refused call once the user moves on', () => {
    const refused = { id: 'toolu_1', scope: 'AskUserQuestion@main' }
    tracker.report(
      't1',
      report({ kind: 'waiting', key: 'Ask:1', scope: refused.scope, starts: refused, message: '?' })
    )
    // Refused: the call never finishes, and the user sends a new prompt.
    tracker.report('t1', report({ kind: 'working', clears: true }))
    const next = { id: 'toolu_2', scope: refused.scope }
    tracker.report(
      't1',
      report({ kind: 'waiting', key: 'Ask:2', scope: next.scope, starts: next, message: '?' })
    )
    tracker.report('t1', report({ kind: 'working', resolves: 'Ask:3', ends: next }))
    expect(status()).toBe('working')
  })

  it('keeps the specific request over a reminder, but takes a newer specific one', () => {
    tracker.report('t1', report({ kind: 'waiting', key: 'Bash:1', message: 'Use Bash?' }))
    tracker.report(
      't1',
      report({ kind: 'waiting', key: null, message: 'Claude needs you', reminder: true })
    )
    expect(state().message).toBe('Use Bash?')
    tracker.report('t1', report({ kind: 'waiting', key: null, message: null }))
    expect(state().message).toBe('Use Bash?')
    tracker.report('t1', report({ kind: 'waiting', key: null, message: 'Approval requested: ls' }))
    expect(state().message).toBe('Approval requested: ls')
  })

  it('treats Enter or Esc in a dialog as an answer', () => {
    tracker.report('t1', report({ kind: 'waiting', key: 'Bash:1', message: 'May I?' }))
    tracker.input('p1', '\x1b[B') // moving through the options isn't an answer
    tracker.input('p1', '\x1b[O') // nor is the window losing focus
    expect(status()).toBe('needs-input')
    tracker.input('p1', '\r')
    expect(status()).toBe('working')
    // Refused: no more events, the spinner stops, and the turn times out.
    vi.advanceTimersByTime(DEFAULT_TIMINGS.hookedQuietMs + 10)
    expect(status()).toBe('idle')
  })

  it('treats a number key in a dialog as an answer', () => {
    tracker.report('t1', report({ kind: 'waiting', key: 'Bash:1', message: 'May I?' }))
    tracker.input('p1', '12') // pasted text isn't a keypress
    expect(status()).toBe('needs-input')
    tracker.input('p1', '1')
    expect(status()).toBe('working')
  })

  it('ignores a reminder that arrives after the user answered', () => {
    const reminder = report({
      kind: 'waiting',
      key: null,
      message: 'Claude needs you',
      reminder: true
    })
    tracker.report('t1', report({ kind: 'waiting', key: 'Bash:1', message: 'May I?' }))
    tracker.input('p1', '\r')
    tracker.report('t1', reminder)
    expect(status()).toBe('working')
    // The next request counts again, and so do reminders about it.
    tracker.report('t1', report({ kind: 'waiting', key: 'Edit:2', message: 'Edit?' }))
    tracker.input('p1', '\x1b[B')
    tracker.report('t1', reminder)
    expect(state()).toMatchObject({ status: 'needs-input', message: 'Edit?' })
  })

  it('stays working while the spinner animates, and ends an interrupted turn on silence', () => {
    tracker.report('t1', report({ kind: 'working', clears: true }))
    stream(DEFAULT_TIMINGS.hookedQuietMs * 2)
    expect(status()).toBe('working')
    vi.advanceTimersByTime(DEFAULT_TIMINGS.hookedQuietMs + 10)
    expect(status()).toBe('idle')
  })

  it('stays working while the user types ahead during a long tool call', () => {
    tracker.report('t1', report({ kind: 'working', clears: true }))
    for (let i = 0; i < 150; i++) {
      tracker.input('p1', 'x')
      vi.advanceTimersByTime(50)
      tracker.output('p1') // the spinner, and the echo
      vi.advanceTimersByTime(50)
    }
    expect(status()).toBe('working')
  })

  it("doesn't let output alone start work once hooks report", () => {
    tracker.report('t1', report({ kind: 'idle' }))
    stream(3000)
    expect(status()).toBe('idle')
  })

  it('counts a finished turn as seen when the pane is focused or typed into', () => {
    tracker.report('t1', report({ kind: 'done', message: null }))
    tracker.input('p1', '\x1b[I')
    expect(status()).toBe('done')
    tracker.seen('p1')
    expect(status()).toBe('idle')
    tracker.report('t1', report({ kind: 'done', message: null }))
    tracker.input('p1', 'n')
    expect(status()).toBe('idle')
  })

  it("keeps done when the agent's prompt comes back (keepDone)", () => {
    tracker.report('t1', report({ kind: 'done', message: null }))
    tracker.report('t1', report({ kind: 'idle', keepDone: true }))
    expect(status()).toBe('done')
    tracker.report('t1', report({ kind: 'working', clears: true }))
    tracker.report('t1', report({ kind: 'idle', keepDone: true }))
    expect(status()).toBe('idle')
  })

  it('keeps the title and tokens through status changes', () => {
    tracker.report('t1', report({ kind: 'idle' }, 'Fix login'))
    tracker.annotate('p1', { tokens: 1234 })
    tracker.report('t1', report({ kind: 'working', clears: true }))
    expect(state()).toMatchObject({ title: 'Fix login', tokens: 1234 })
  })

  it('refuses tokens from other panes, an earlier run, or an exited process', () => {
    expect(tracker.report('nope', report({ kind: 'done', message: null }))).toBe(false)
    tracker.spawn('p1', 't2', 'claude')
    expect(tracker.report('t1', report({ kind: 'done', message: null }))).toBe(false)
    expect(status()).toBe('idle')
    tracker.exit('p1')
    expect(tracker.report('t2', report({ kind: 'done', message: null }))).toBe(false)
    expect(status()).toBe('exited')
  })

  it('forgets a removed pane without reporting it', () => {
    const before = changes.length
    tracker.remove('p1')
    expect(tracker.get('p1')).toBeNull()
    expect(changes.length).toBe(before)
    expect(tracker.report('t1', report({ kind: 'idle' }))).toBe(false)
  })
})
