import { describe, expect, it } from 'bun:test'
import { CodexWatcher, sendsPrompt } from './codex'

// Reports captured from Codex 0.163.0 in a PTY, in the order it sent them.
const osc = (body: string): string => `\x1b]7501;${body}\x1b\\`
const IDLE = osc('state=idle:app=codex')
const WORKING = osc('state=working:app=codex')
const BLOCKED = osc('state=blocked:app=codex')
const CLEAR = osc('state=clear')

const signals = (w: CodexWatcher, chunk: string): unknown[] => w.feed(chunk).map((r) => r.signal)

describe('sendsPrompt', () => {
  it('tells Enter from a new line or a pasted line break', () => {
    expect(sendsPrompt('\r')).toBe(true)
    expect(sendsPrompt('fix it\r')).toBe(true)
    expect(sendsPrompt('\x1b\r')).toBe(false)
    expect(sendsPrompt('\x1b[200~one\rtwo\x1b[201~')).toBe(false)
    expect(sendsPrompt('\x1b[200~one\rtwo\x1b[201~\r')).toBe(true)
    expect(sendsPrompt('y')).toBe(false)
    expect(sendsPrompt('\x1b[I')).toBe(false)
  })
})

describe('CodexWatcher', () => {
  it("doesn't count the work Codex does while it loads as a turn", () => {
    const w = new CodexWatcher()
    // Started with no prompt and left alone.
    expect(signals(w, IDLE)).toEqual([{ kind: 'idle', keepDone: true }])
    expect(signals(w, WORKING)).toEqual([])
    expect(signals(w, IDLE)).toEqual([])
  })

  it('follows a typed prompt through an approval to the end of its turn', () => {
    const w = new CodexWatcher()
    w.feed(IDLE + WORKING + IDLE)
    w.input('write b.txt\r')
    expect(signals(w, WORKING)).toEqual([{ kind: 'working', clears: true }])
    expect(signals(w, BLOCKED)).toEqual([
      { kind: 'waiting', key: null, message: 'Codex is waiting for you' }
    ])
    w.input('y')
    // Carrying on after the answer is the same turn.
    expect(signals(w, WORKING)).toEqual([{ kind: 'working', clears: false }])
    // Codex never says done; back at the prompt after a turn is its end.
    expect(signals(w, IDLE)).toEqual([{ kind: 'done', message: null }])
    expect(signals(w, CLEAR)).toEqual([{ kind: 'idle', keepDone: true }])
  })

  it('runs a prompt sent while Codex loads as a turn of its own', () => {
    const w = new CodexWatcher()
    w.feed(IDLE + WORKING)
    w.input('Reply with ok')
    w.input('\r')
    // Loading ends; then the queued prompt's turn.
    expect(signals(w, IDLE)).toEqual([])
    expect(signals(w, WORKING)).toEqual([{ kind: 'working', clears: true }])
    expect(signals(w, IDLE)).toEqual([{ kind: 'done', message: null }])
  })

  it('counts a first prompt from the command line', () => {
    const w = new CodexWatcher(true)
    // Loading and the turn run together, with no idle between.
    expect(signals(w, IDLE + WORKING)).toEqual([
      { kind: 'idle', keepDone: true },
      { kind: 'working', clears: true }
    ])
    expect(signals(w, IDLE)).toEqual([{ kind: 'done', message: null }])
    // Only the first turn came from the command line.
    expect(signals(w, WORKING + IDLE)).toEqual([])
  })

  it('forgets an Enter from before Codex was at its prompt', () => {
    const w = new CodexWatcher()
    // Picking a session in `codex resume`.
    w.input('\r')
    w.feed(IDLE)
    expect(signals(w, WORKING + IDLE)).toEqual([])
  })

  it('reports a request even outside a turn', () => {
    const w = new CodexWatcher()
    w.feed(IDLE + WORKING)
    expect(signals(w, BLOCKED)).toEqual([
      { kind: 'waiting', key: null, message: 'Codex is waiting for you' }
    ])
    expect(signals(w, IDLE)).toEqual([{ kind: 'done', message: null }])
  })

  it('passes on done, error, and the kind of a request, if Codex sends them', () => {
    const w = new CodexWatcher(true)
    w.feed(IDLE + WORKING)
    expect(signals(w, osc('state=blocked:kind=question:msg=UmVkIG9yIGJsdWU/'))).toEqual([
      { kind: 'waiting', key: null, ask: 'question', message: 'Red or blue?' }
    ])
    expect(signals(w, osc('state=done:msg=Qmx1ZQ==') + IDLE)).toEqual([
      { kind: 'done', message: 'Blue' },
      { kind: 'idle', keepDone: true }
    ])
    w.input('\r')
    w.feed(WORKING)
    expect(signals(w, osc('state=error'))).toEqual([
      { kind: 'done', failed: true, message: 'The turn ended with an error' }
    ])
  })

  it('answers a probe and ignores other sequences', () => {
    const replies: string[] = []
    const w = new CodexWatcher(false, (d) => replies.push(d))
    const chunk = '\x1b]7501;?\x1b\\\x1b]0;cockpit\x07\x1b]9;Agent turn complete\x07'
    expect(signals(w, chunk)).toEqual([])
    expect(replies).toEqual(['\x1b]7501;?\x1b\\'])
  })
})
