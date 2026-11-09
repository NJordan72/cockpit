import { describe, expect, it } from 'bun:test'
import { OscScanner, parseProgramStatus } from './osc'

const title = (t: string): string => `\x1b]0;${t}\x07`
const b64 = (t: string): string => Buffer.from(t).toString('base64')

describe('OscScanner', () => {
  it('finds sequences ended by BEL or ST among other output', () => {
    const s = new OscScanner()
    expect(s.feed(`plain \x1b[1mbold\x1b[0m ${title('Ready')} more \x1b]9;hi\x1b\\ end`)).toEqual([
      { code: 0, text: 'Ready' },
      { code: 9, text: 'hi' }
    ])
  })

  it('joins a sequence split across chunks, even at the ESC', () => {
    const s = new OscScanner()
    expect(s.feed('abc \x1b')).toEqual([])
    expect(s.feed(']0;Work')).toEqual([])
    expect(s.feed('ing\x07 tail')).toEqual([{ code: 0, text: 'Working' }])
  })

  it('drops a sequence that another escape interrupts', () => {
    const s = new OscScanner()
    expect(s.feed('\x1b]0;half\x1b[2J' + title('Ready'))).toEqual([{ code: 0, text: 'Ready' }])
  })

  it('gives up on a sequence that never ends', () => {
    const s = new OscScanner()
    s.feed('\x1b]0;' + 'x'.repeat(10_000))
    expect(s.feed(title('Ready'))).toEqual([{ code: 0, text: 'Ready' }])
  })
})

describe('parseProgramStatus', () => {
  it('reads what agy sends', () => {
    expect(
      parseProgramStatus('state=blocked:kind=auth:app=antigravity:msg=U2lnbiBpbiByZXF1aXJlZA==')
    ).toEqual({
      state: 'blocked',
      id: null,
      kind: 'auth',
      progress: null,
      app: 'antigravity',
      title: null,
      msg: 'Sign in required'
    })
    expect(parseProgramStatus('state=idle:app=antigravity')).toMatchObject({
      state: 'idle',
      app: 'antigravity',
      msg: null
    })
  })

  it("reads the spec's example, with or without base64 padding", () => {
    expect(
      parseProgramStatus('state=done:app=brew:msg=VXBncmFkZWQgMTIgcGFja2FnZXM=')
    ).toMatchObject({ state: 'done', msg: 'Upgraded 12 packages' })
    expect(parseProgramStatus('state=done:msg=U2lnbiBpbiByZXF1aXJlZA')?.msg).toBe(
      'Sign in required'
    )
  })

  it('skips malformed pairs and unknown keys, and keeps the last of a repeated key', () => {
    expect(
      parseProgramStatus(
        ` state = working :garbage:Upper=x:msg=has space:colour=red:progress=40:progress=60:id=deploy/us-east-1`
      )
    ).toEqual({
      state: 'working',
      id: 'deploy/us-east-1',
      kind: null,
      progress: 60,
      app: null,
      title: null,
      msg: null
    })
  })

  it('treats bad optional values as absent', () => {
    expect(parseProgramStatus('state=blocked:kind=coffee:progress=101:app=')).toMatchObject({
      kind: null,
      progress: null,
      app: null
    })
    expect(parseProgramStatus('state=working:progress=x')?.progress).toBeNull()
    expect(parseProgramStatus(`state=done:title=${b64('Deploy')}`)?.title).toBe('Deploy')
  })

  it('drops a report the spec says to ignore', () => {
    // No state, or one it doesn't know.
    expect(parseProgramStatus('kind=permission')).toBeNull()
    expect(parseProgramStatus('state=sleeping')).toBeNull()
    // The feature query.
    expect(parseProgramStatus('?')).toBeNull()
    expect(parseProgramStatus('?:states=idle,done')).toBeNull()
    // Bad ids.
    expect(parseProgramStatus('state=done:id=a//b')).toBeNull()
    expect(parseProgramStatus(`state=done:id=${'a/'.repeat(8)}a`)).toBeNull()
    expect(parseProgramStatus(`state=done:id=${'x'.repeat(33)}`)).toBeNull()
    // Bad base64, invalid UTF-8, control characters, too long.
    expect(parseProgramStatus('state=done:msg=QQ=')).toBeNull()
    expect(parseProgramStatus('state=done:msg=Q')).toBeNull()
    expect(
      parseProgramStatus(`state=done:msg=${Buffer.from([0xff, 0xfe]).toString('base64')}`)
    ).toBeNull()
    expect(parseProgramStatus(`state=done:msg=${b64('one\ntwo')}`)).toBeNull()
    expect(parseProgramStatus(`state=done:msg=${b64('x'.repeat(2049))}`)).toBeNull()
    expect(parseProgramStatus(`state=done:title=${b64('x'.repeat(193))}`)).toBeNull()
    expect(parseProgramStatus(`state=done:app=x:${'k=v:'.repeat(1100)}`)).toBeNull()
  })
})
