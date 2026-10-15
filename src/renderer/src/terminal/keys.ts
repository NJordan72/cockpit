/**
 * Key handling that xterm.js doesn't do the way agent TUIs expect.
 * Returns what the pane should do with a keyboard event.
 */
export type KeyAction =
  | { kind: 'pass' } // let xterm handle it
  | { kind: 'ignore' } // xterm should not handle it; the browser/menu may
  | { kind: 'send'; data: string } // write these bytes to the PTY instead
  | { kind: 'copy' }
  | { kind: 'paste' }
  | { kind: 'clear' }

/** ESC CR: what Option+Enter sends with Option-as-Meta. Claude Code, Codex and zsh all read it as "insert newline". */
export const NEWLINE_SEQUENCE = '\x1b\r'

export interface KeyLike {
  type: string
  key: string
  code?: string
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}

export function classifyKey(e: KeyLike): KeyAction {
  const isEnter = e.key === 'Enter'
  if (isEnter && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
    // Swallow keypress/keyup too so xterm never sees a bare Enter.
    return e.type === 'keydown' ? { kind: 'send', data: NEWLINE_SEQUENCE } : { kind: 'ignore' }
  }

  if (e.metaKey && !e.ctrlKey && !e.altKey) {
    if (e.type !== 'keydown') return { kind: 'ignore' }
    switch (e.key.toLowerCase()) {
      case 'c':
        return e.shiftKey ? { kind: 'ignore' } : { kind: 'copy' }
      case 'v':
        return e.shiftKey ? { kind: 'ignore' } : { kind: 'paste' }
      case 'k':
        return { kind: 'clear' }
      default:
        // Every other Cmd shortcut belongs to the app, not the shell.
        return { kind: 'ignore' }
    }
  }
  return { kind: 'pass' }
}
