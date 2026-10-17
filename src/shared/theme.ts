// Themes: the colors, fonts, shapes, and effects shared by the chrome, the
// terminals, and widgets. Each token becomes a CSS variable (bgRaised ->
// --bg-raised) in the chrome and in every widget. A theme sets some tokens and
// inherits the rest from the theme it extends, or from DEFAULT_THEME; the
// user's overrides in config.json apply last.

export const DEFAULT_THEME = {
  bg: '#1e1f24',
  bgRaised: '#26282f',
  bgHover: '#2e3039',
  fg: '#d8dae0',
  muted: '#8a8f9c',
  border: '#2c2e36',
  accent: '#7aa2f7',
  /** Text on an accent background. */
  accentFg: '#1e1f24',
  danger: '#f7768e',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  /** dark or light: native controls and scrollbars follow it. */
  colorScheme: 'dark',
  fontUi: '-apple-system, BlinkMacSystemFont, sans-serif',
  /** Defaults to the terminal font. */
  fontMono: '',
  fontSize: '13px',
  /** Panel and section titles. */
  headerCase: 'uppercase',
  headerTracking: '0.08em',
  headerWeight: 'normal',
  headerHeight: '28px',
  /** Corner radius of buttons, inputs, and dialogs. */
  radius: '4px',
  /** Space between panels; 0 puts them edge to edge with a border between. */
  gap: '0px',
  /** Effects, from 0 (off) to 1. */
  scanlines: '0',
  glow: '0',
  vignette: '0'
}

export type ThemeKey = keyof typeof DEFAULT_THEME
export type Theme = Record<ThemeKey, string>
export type ThemeOverrides = Partial<Theme>

export const THEME_KEYS = Object.keys(DEFAULT_THEME) as ThemeKey[]

/** xterm's palette keys. Missing ones are derived from the tokens. */
export const TERMINAL_KEYS = [
  'background',
  'foreground',
  'cursor',
  'cursorAccent',
  'selectionBackground',
  'selectionForeground',
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite'
] as const

export type TerminalKey = (typeof TERMINAL_KEYS)[number]
export type TerminalPalette = Partial<Record<TerminalKey, string>>

/** A theme as defined: built in, or read from ~/.cockpit/themes/<id>/theme.json. */
export interface ThemeDefinition {
  id: string
  name: string
  /** Another theme's id; its tokens and palette are the starting point. */
  extends?: string
  tokens: ThemeOverrides
  terminal: TerminalPalette
  /** URL of the theme's stylesheet (cockpit-asset://...), user themes only. */
  css?: string
  /** User themes: the folder it was read from. */
  dir?: string
  /** Why the theme couldn't be read; it then has no tokens. */
  error?: string
}

export interface ResolvedTheme {
  /** The theme in use: the one asked for, or the default if it doesn't exist. */
  id: string
  name: string
  tokens: Theme
  terminal: Required<TerminalPalette>
  /** Stylesheets to load, the base theme's first. */
  css: string[]
}

export const DEFAULT_THEME_ID = 'midnight'

/** How many themes an `extends` chain may go through. */
const MAX_EXTENDS = 4

/** Values end up inside a <style> block, so they can't close it or start a new rule. */
export function isSafeThemeValue(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 300 && !/[;{}<>\\]/.test(v)
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** The tokens in `raw` that are known and safe; everything else is dropped. */
export function readTokens(raw: unknown): ThemeOverrides {
  const tokens: ThemeOverrides = {}
  if (!isObj(raw)) return tokens
  for (const key of THEME_KEYS) {
    const v = raw[key]
    if (isSafeThemeValue(v)) tokens[key] = v
  }
  return tokens
}

export function readPalette(raw: unknown): TerminalPalette {
  const palette: TerminalPalette = {}
  if (!isObj(raw)) return palette
  for (const key of TERMINAL_KEYS) {
    const v = raw[key]
    if (isSafeThemeValue(v)) palette[key] = v
  }
  return palette
}

/** The definitions from `id` up through what it extends, the base first. */
function chain(themes: readonly ThemeDefinition[], id: string): ThemeDefinition[] {
  const byId = new Map(themes.map((t) => [t.id, t]))
  const out: ThemeDefinition[] = []
  let next: string | undefined = id
  while (next !== undefined && out.length <= MAX_EXTENDS) {
    const def = byId.get(next)
    if (!def || out.includes(def)) break
    out.unshift(def)
    next = def.extends
  }
  return out
}

function hexRgb(c: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim())
  if (!m?.[1]) return null
  const h = m[1].length === 3 ? m[1].replace(/./g, (d) => d + d) : m[1]
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

/**
 * `a` mixed into `b` by `amount` (0 to 1), for #hex colors. xterm can't parse
 * color-mix(), so anything else gives `a` unchanged.
 */
export function mixHex(a: string, b: string, amount: number): string {
  const x = hexRgb(a)
  const y = hexRgb(b)
  if (!x || !y) return a
  const hex = x.map((v, i) => Math.round(v * amount + (y[i] ?? 0) * (1 - amount)))
  return '#' + hex.map((v) => v.toString(16).padStart(2, '0')).join('')
}

/** The terminal palette with the theme's colors where the theme left gaps. */
function palette(t: Theme, own: TerminalPalette): Required<TerminalPalette> {
  const derived: Required<TerminalPalette> = {
    background: t.bg,
    foreground: t.fg,
    cursor: t.fg,
    cursorAccent: t.bg,
    selectionBackground: mixHex(t.accent, t.bg, 0.35),
    selectionForeground: t.fg,
    black: t.colorScheme === 'light' ? t.fg : t.bgRaised,
    red: t.red,
    green: t.green,
    yellow: t.yellow,
    blue: t.blue,
    magenta: t.magenta,
    cyan: t.cyan,
    white: t.colorScheme === 'light' ? t.bgRaised : t.fg,
    brightBlack: t.muted,
    brightRed: t.red,
    brightGreen: t.green,
    brightYellow: t.yellow,
    brightBlue: t.blue,
    brightMagenta: t.magenta,
    brightCyan: t.cyan,
    brightWhite: t.colorScheme === 'light' ? t.bg : t.fg
  }
  return { ...derived, ...own }
}

/**
 * The theme `id` with what it extends and the user's overrides applied. An
 * unknown id falls back to the default theme.
 */
export function resolveTheme(
  themes: readonly ThemeDefinition[],
  id: string,
  overrides: ThemeOverrides,
  terminalFont: string
): ResolvedTheme {
  let defs = chain(themes, id)
  if (defs.length === 0) defs = chain(themes, DEFAULT_THEME_ID)
  const tokens: Theme = { ...DEFAULT_THEME, fontMono: terminalFont }
  let own: TerminalPalette = {}
  for (const def of defs) {
    Object.assign(tokens, readTokens(def.tokens))
    own = { ...own, ...readPalette(def.terminal) }
  }
  Object.assign(tokens, readTokens(overrides))
  const top = defs[defs.length - 1]
  return {
    id: top?.id ?? DEFAULT_THEME_ID,
    name: top?.name ?? DEFAULT_THEME_ID,
    tokens,
    terminal: palette(tokens, own),
    css: defs.flatMap((d) => (d.css ? [d.css] : []))
  }
}

const cssName = (key: string): string => '--' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())

/** { '--bg': '#1e1f24', '--bg-raised': ... } */
export function themeVars(theme: Theme): Record<string, string> {
  return Object.fromEntries(THEME_KEYS.map((k) => [cssName(k), theme[k]]))
}

export function themeCss(vars: Record<string, string>): string {
  const body = Object.entries(vars)
    .filter(([, v]) => isSafeThemeValue(v))
    .map(([k, v]) => `${k}: ${v};`)
    .join(' ')
  return `:root { ${body} }`
}
