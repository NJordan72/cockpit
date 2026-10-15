import { describe, expect, it } from 'vitest'
import { classifyKey, NEWLINE_SEQUENCE, type KeyLike } from './keys'

const key = (k: string, mods: Partial<KeyLike> = {}, type = 'keydown'): KeyLike => ({
  type,
  key: k,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...mods
})

describe('classifyKey', () => {
  it('turns Shift+Enter into ESC CR on keydown and swallows the rest', () => {
    expect(classifyKey(key('Enter', { shiftKey: true }))).toEqual({
      kind: 'send',
      data: NEWLINE_SEQUENCE
    })
    expect(classifyKey(key('Enter', { shiftKey: true }, 'keypress'))).toEqual({ kind: 'ignore' })
    expect(classifyKey(key('Enter', { shiftKey: true }, 'keyup'))).toEqual({ kind: 'ignore' })
  })

  it('leaves plain Enter and Option+Enter to xterm', () => {
    expect(classifyKey(key('Enter'))).toEqual({ kind: 'pass' })
    expect(classifyKey(key('Enter', { altKey: true }))).toEqual({ kind: 'pass' })
  })

  it('maps Cmd+C, Cmd+V, Cmd+K', () => {
    expect(classifyKey(key('c', { metaKey: true }))).toEqual({ kind: 'copy' })
    expect(classifyKey(key('v', { metaKey: true }))).toEqual({ kind: 'paste' })
    expect(classifyKey(key('k', { metaKey: true }))).toEqual({ kind: 'clear' })
  })

  it('keeps Ctrl+C going to the PTY', () => {
    expect(classifyKey(key('c', { ctrlKey: true }))).toEqual({ kind: 'pass' })
  })

  it('keeps other Cmd shortcuts away from the shell', () => {
    expect(classifyKey(key('t', { metaKey: true }))).toEqual({ kind: 'ignore' })
    expect(classifyKey(key('c', { metaKey: true }, 'keyup'))).toEqual({ kind: 'ignore' })
  })
})
