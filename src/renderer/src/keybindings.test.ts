import { describe, expect, it } from 'vitest'
import { DEFAULT_KEYBINDINGS } from '@shared/config'
import { actionFor, compileKeymap, parseChord } from './keybindings'

const ev = (
  code: string,
  mods: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean } = {}
) => ({
  code,
  metaKey: !!mods.meta,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift
})

describe('parseChord', () => {
  it('parses modifiers and keys', () => {
    expect(parseChord('Cmd+Shift+D')).toEqual({
      meta: true,
      ctrl: false,
      alt: false,
      shift: true,
      code: 'KeyD'
    })
    expect(parseChord('Ctrl+Alt+Left')?.code).toBe('ArrowLeft')
    expect(parseChord('Cmd+]')?.code).toBe('BracketRight')
    expect(parseChord('Cmd+1')?.code).toBe('Digit1')
    expect(parseChord('Option+F12')).toMatchObject({ alt: true, code: 'F12' })
  })

  it('rejects junk', () => {
    expect(parseChord('Hyper+X')).toBeNull()
    expect(parseChord('Cmd+')).toBeNull()
    expect(parseChord('Cmd+Banana')).toBeNull()
  })
})

describe('actionFor', () => {
  const { keymap, invalid } = compileKeymap(DEFAULT_KEYBINDINGS)

  it('compiles every default binding', () => {
    expect(invalid).toEqual([])
  })

  it('matches by physical key, so Shift+] works', () => {
    expect(actionFor(keymap, ev('BracketRight', { meta: true, shift: true }))).toBe('nextTab')
    expect(actionFor(keymap, ev('KeyD', { meta: true }))).toBe('splitRight')
    expect(actionFor(keymap, ev('KeyD', { meta: true, shift: true }))).toBe('splitDown')
    expect(actionFor(keymap, ev('Digit3', { meta: true }))).toBe('goToTab3')
  })

  it('requires an exact modifier match', () => {
    expect(actionFor(keymap, ev('KeyT', { meta: true, alt: true }))).toBeNull()
    expect(actionFor(keymap, ev('KeyT'))).toBeNull()
  })

  it('treats an empty binding as unbound and reports bad ones', () => {
    const r = compileKeymap({ ...DEFAULT_KEYBINDINGS, newTab: '', closePane: 'Cmd+Nope' })
    expect(r.keymap.some((k) => k.action === 'newTab')).toBe(false)
    expect(r.invalid).toEqual(['closePane: Cmd+Nope'])
  })
})
