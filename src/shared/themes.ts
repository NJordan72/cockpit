// The themes that ship with Cockpit. User themes in ~/.cockpit/themes/ can
// extend any of them by id.
import { DEFAULT_THEME_ID, type ThemeDefinition } from './theme'

/** Cockpit's original look. Its tokens are the defaults in theme.ts. */
const midnight: ThemeDefinition = {
  id: DEFAULT_THEME_ID,
  name: 'Midnight',
  tokens: {},
  terminal: {
    selectionBackground: '#3b4261',
    black: '#2a2c33',
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
}

/** A phosphor CRT: cream text and an amber cursor on black, from the app icon. */
const amber: ThemeDefinition = {
  id: 'amber',
  name: 'Amber',
  tokens: {
    bg: '#0c0d0f',
    bgRaised: '#15161a',
    bgHover: '#1f2025',
    fg: '#efe7d6',
    muted: '#8c8370',
    border: '#3b3527',
    accent: '#ffc21a',
    accentFg: '#0c0d0f',
    danger: '#ff6a4d',
    red: '#ff6a4d',
    green: '#b8d977',
    yellow: '#ffc21a',
    blue: '#8fb3d9',
    magenta: '#e39b7b',
    cyan: '#8cc9bd',
    fontUi: 'var(--font-mono)',
    fontSize: '12px',
    headerTracking: '0.14em',
    radius: '0px',
    gap: '6px',
    scanlines: '0.5',
    glow: '0.6',
    vignette: '0.5'
  },
  terminal: {
    cursor: '#ffc21a',
    cursorAccent: '#0c0d0f',
    selectionBackground: '#4a3c12',
    black: '#1c1d21',
    white: '#d9d0bd',
    brightBlack: '#6e6656',
    brightRed: '#ff8a70',
    brightGreen: '#cfe89a',
    brightYellow: '#ffd75e',
    brightBlue: '#abc9e8',
    brightMagenta: '#f0b598',
    brightCyan: '#a9ddd2',
    brightWhite: '#fffaf0'
  }
}

/** Dark text on warm paper. */
const paper: ThemeDefinition = {
  id: 'paper',
  name: 'Paper',
  tokens: {
    bg: '#f7f5f0',
    bgRaised: '#ece9e1',
    bgHover: '#e2ded4',
    fg: '#2b2a27',
    muted: '#77736a',
    border: '#d9d4c8',
    accent: '#2f6fdb',
    accentFg: '#ffffff',
    danger: '#c8382e',
    red: '#c8382e',
    green: '#2f8a3b',
    yellow: '#9a6700',
    blue: '#2f6fdb',
    magenta: '#8a4fc7',
    cyan: '#11808c',
    colorScheme: 'light',
    radius: '5px'
  },
  terminal: {
    cursor: '#2b2a27',
    cursorAccent: '#f7f5f0',
    selectionBackground: '#cddcf6',
    black: '#2b2a27',
    white: '#6e7781',
    brightBlack: '#57606a',
    brightRed: '#a40e26',
    brightGreen: '#1a7f37',
    brightYellow: '#7d4e00',
    brightBlue: '#0550ae',
    brightMagenta: '#6639ba',
    brightCyan: '#1b7c83',
    brightWhite: '#8c959f'
  }
}

export const BUILT_IN_THEMES: readonly ThemeDefinition[] = [midnight, amber, paper]
