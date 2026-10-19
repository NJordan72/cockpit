import type { Action, Keybindings } from '@shared/config'

export interface Chord {
  meta: boolean
  ctrl: boolean
  alt: boolean
  shift: boolean
  /** KeyboardEvent.code, e.g. KeyT, Digit1, BracketRight, ArrowLeft. */
  code: string
}

const NAMED: Record<string, string> = {
  left: 'ArrowLeft',
  right: 'ArrowRight',
  up: 'ArrowUp',
  down: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  esc: 'Escape',
  escape: 'Escape',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  ';': 'Semicolon',
  "'": 'Quote',
  '`': 'Backquote',
  '-': 'Minus',
  '=': 'Equal',
  '\\': 'Backslash'
}

/** Parse "Cmd+Shift+D" style strings. Returns null for anything it can't read. */
export function parseChord(binding: string): Chord | null {
  // Split on + but keep a literal "+" key ("Cmd++" is not supported; use "Cmd+=").
  const parts = binding.split('+').map((p) => p.trim())
  const keyPart = parts.pop()
  if (!keyPart) return null
  const chord: Chord = { meta: false, ctrl: false, alt: false, shift: false, code: '' }
  for (const mod of parts) {
    switch (mod.toLowerCase()) {
      case 'cmd':
      case 'command':
      case 'meta':
      case 'super':
        chord.meta = true
        break
      case 'ctrl':
      case 'control':
        chord.ctrl = true
        break
      case 'alt':
      case 'opt':
      case 'option':
        chord.alt = true
        break
      case 'shift':
        chord.shift = true
        break
      default:
        return null
    }
  }
  const k = keyPart.toLowerCase()
  if (/^[a-z]$/.test(k)) chord.code = `Key${k.toUpperCase()}`
  else if (/^[0-9]$/.test(k)) chord.code = `Digit${k}`
  else if (/^f([1-9]|1[0-9]|20)$/.test(k)) chord.code = k.toUpperCase()
  else if (NAMED[k]) chord.code = NAMED[k]
  else return null
  return chord
}

export interface KeyEventLike {
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

export function matches(chord: Chord, e: KeyEventLike): boolean {
  return (
    chord.code === e.code &&
    chord.meta === e.metaKey &&
    chord.ctrl === e.ctrlKey &&
    chord.alt === e.altKey &&
    chord.shift === e.shiftKey
  )
}

export type Keymap = { action: Action; chord: Chord }[]

/** Compile bindings, skipping (and reporting) ones that don't parse. */
export function compileKeymap(bindings: Keybindings): { keymap: Keymap; invalid: string[] } {
  const keymap: Keymap = []
  const invalid: string[] = []
  for (const [action, binding] of Object.entries(bindings) as [Action, string][]) {
    if (binding === '') continue // empty string unbinds
    const chord = parseChord(binding)
    if (chord) keymap.push({ action, chord })
    else invalid.push(`${action}: ${binding}`)
  }
  return { keymap, invalid }
}

export function actionFor(keymap: Keymap, e: KeyEventLike): Action | null {
  return keymap.find((k) => matches(k.chord, e))?.action ?? null
}

const KEY_SYMBOL: Record<string, string> = {
  left: '←',
  right: '→',
  up: '↑',
  down: '↓',
  enter: '↩',
  return: '↩',
  tab: '⇥',
  esc: '⎋',
  escape: '⎋',
  space: 'Space',
  backspace: '⌫',
  delete: '⌦'
}

/** "Cmd+Shift+D" → "⇧⌘D", in the order macOS menus use. null when it doesn't parse. */
export function chordLabel(binding: string): string | null {
  const chord = parseChord(binding)
  if (!chord) return null
  const key = binding.split('+').pop()?.trim() ?? ''
  return (
    (chord.ctrl ? '⌃' : '') +
    (chord.alt ? '⌥' : '') +
    (chord.shift ? '⇧' : '') +
    (chord.meta ? '⌘' : '') +
    (KEY_SYMBOL[key.toLowerCase()] ?? key.toUpperCase())
  )
}
