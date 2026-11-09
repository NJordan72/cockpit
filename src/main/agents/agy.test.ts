import { describe, expect, it } from 'bun:test'
import { AgyWatcher } from './agy'

// Reports captured from agy 1.5.3 with AGY_CLI_OSC7501=on, unless made up for a case it didn't hit.
const osc = (body: string): string => `\x1b]7501;${body}\x1b\\`
const b64 = (t: string): string => Buffer.from(t).toString('base64')
const SIGN_IN = osc('state=blocked:kind=auth:app=antigravity:msg=U2lnbiBpbiByZXF1aXJlZA==')
const TRUST = osc('state=blocked:kind=permission:app=antigravity:msg=VHJ1c3QgdGhpcyBmb2xkZXI/')
const IDLE = osc('state=idle:app=antigravity')
const WORKING = osc('state=working:app=antigravity')

const signals = (w: AgyWatcher, chunk: string): unknown[] => w.feed(chunk).map((r) => r.signal)

describe('AgyWatcher', () => {
  it('skips the sign-in agy reports for a moment at startup', () => {
    const w = new AgyWatcher()
    expect(signals(w, `\x1b[c\x1b]7501;?\x1b\\${SIGN_IN}`)).toEqual([])
    expect(signals(w, TRUST)).toEqual([
      { kind: 'waiting', key: null, ask: 'permission', message: 'Trust this folder?' }
    ])
    expect(signals(w, IDLE)).toEqual([{ kind: 'idle', keepDone: true }])
    // Once agy is running, it means it.
    expect(signals(w, SIGN_IN)).toEqual([
      { kind: 'waiting', key: null, ask: 'auth', message: 'Sign in required' }
    ])
  })

  it('follows turns through an approval and a question', () => {
    const w = new AgyWatcher()
    w.feed(SIGN_IN + IDLE)
    expect(signals(w, WORKING)).toEqual([{ kind: 'working', clears: true }])
    expect(
      signals(
        w,
        osc(
          'state=blocked:kind=permission:app=antigravity:msg=QXBwcm92ZSBSdW5Db21tYW5kOiBkYXRlIC11'
        )
      )
    ).toEqual([
      { kind: 'waiting', key: null, ask: 'permission', message: 'Approve RunCommand: date -u' }
    ])
    // Carrying on after the answer is the same turn.
    expect(signals(w, WORKING)).toEqual([{ kind: 'working', clears: false }])
    expect(
      signals(w, osc('state=done:app=antigravity:msg=YE1vbiBOb3YgOSAwOToyMjowOSBVVEMgMjAyNmA='))
    ).toEqual([{ kind: 'done', message: '`Mon Nov 9 09:22:09 UTC 2026`' }])
    // Typing the next prompt.
    expect(signals(w, IDLE)).toEqual([{ kind: 'idle', keepDone: true }])
    w.feed(WORKING)
    expect(
      signals(
        w,
        osc('state=blocked:kind=question:app=antigravity:msg=RG8geW91IHByZWZlciByZWQgb3IgYmx1ZT8=')
      )
    ).toEqual([
      { kind: 'waiting', key: null, ask: 'question', message: 'Do you prefer red or blue?' }
    ])
    expect(signals(w, WORKING + osc('state=done:app=antigravity:msg=Qmx1ZQ=='))).toEqual([
      { kind: 'working', clears: false },
      { kind: 'done', message: 'Blue' }
    ])
  })

  it('goes back to idle when a turn is interrupted', () => {
    const w = new AgyWatcher()
    w.feed(IDLE + WORKING)
    expect(signals(w, IDLE)).toEqual([{ kind: 'idle', keepDone: true }])
  })

  it('reports a failed turn as done, with its error', () => {
    const w = new AgyWatcher()
    w.feed(IDLE + WORKING)
    const error = 'Agent Platform API has not been used in project p before or it is disabled.'
    expect(signals(w, osc(`state=error:app=antigravity:msg=${b64(error)}`))).toEqual([
      { kind: 'done', failed: true, message: error }
    ])
    w.feed(WORKING)
    expect(signals(w, osc('state=error'))).toEqual([
      { kind: 'done', failed: true, message: 'The turn ended with an error' }
    ])
  })

  it('says what a request is about when agy gives no message', () => {
    const w = new AgyWatcher()
    w.feed(IDLE)
    expect(signals(w, osc('state=blocked:kind=question'))).toEqual([
      { kind: 'waiting', key: null, ask: 'question', message: 'Antigravity has a question' }
    ])
    expect(signals(w, osc('state=blocked'))).toEqual([
      { kind: 'waiting', key: null, ask: 'permission', message: 'Antigravity needs permission' }
    ])
  })

  it('reports a change once, not every repeat or progress update', () => {
    const w = new AgyWatcher()
    expect(signals(w, IDLE + IDLE)).toHaveLength(1)
    expect(
      signals(w, osc('state=working:progress=10') + osc('state=working:progress=20'))
    ).toHaveLength(1)
    expect(signals(w, osc('state=clear'))).toEqual([{ kind: 'idle', keepDone: true }])
  })

  it('ignores child records, other sequences, and reports it can’t read, even split across chunks', () => {
    const w = new AgyWatcher()
    expect(
      signals(w, osc('state=working:id=subagent/1') + '\x1b]0;title\x07' + osc('state=nope'))
    ).toEqual([])
    expect(signals(w, '\x1b]75')).toEqual([])
    expect(signals(w, '01;state=working:app=antigravity\x1b')).toEqual([])
    expect(signals(w, '\\')).toEqual([{ kind: 'working', clears: true }])
  })
})
