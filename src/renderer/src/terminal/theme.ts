import type { ITheme } from '@xterm/xterm'
import type { Theme } from '@shared/theme'

const darkTheme: ITheme = {
  background: '#1e1f24',
  foreground: '#d8dae0',
  cursor: '#d8dae0',
  cursorAccent: '#1e1f24',
  selectionBackground: '#3b4261',
  black: '#2a2c33',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  white: '#c0caf5',
  brightBlack: '#565f89',
  brightRed: '#ff8ea1',
  brightGreen: '#b9f27c',
  brightYellow: '#ffc777',
  brightBlue: '#8db0ff',
  brightMagenta: '#c7a9ff',
  brightCyan: '#a4daff',
  brightWhite: '#e6e9f5'
}

/** The terminal palette, with the theme's background, text, and base colors. */
export function xtermTheme(theme: Theme): ITheme {
  return {
    ...darkTheme,
    background: theme.bg,
    foreground: theme.fg,
    cursor: theme.fg,
    cursorAccent: theme.bg,
    red: theme.red,
    green: theme.green,
    yellow: theme.yellow,
    blue: theme.blue,
    magenta: theme.magenta,
    cyan: theme.cyan
  }
}
